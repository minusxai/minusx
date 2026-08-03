/**
 * The ONE sanctioned way to construct an `Orchestrator` for a production LLM run.
 *
 * Every orchestrator that can reach an LLM must be built through
 * `createTrackedOrchestrator`, which pre-wires the three per-run obligations that
 * were previously hand-copied (and forgotten) at each call site:
 *
 *   1. credit gate      — `beforeLlmCall = creditEnforcer(user)`
 *   2. model plan       — `resolveLlmPlan = buildLlmPlanResolver(...)` (DB-backed
 *                          Settings → Models config; unconfigured → MinusX gateway)
 *   3. usage recording  — `recordUsage(entries?)` writes `llm_call_events` +
 *                          `llm_logs` and publishes `AppEvents.LLM_CALL`
 *
 * A bare `new Orchestrator(...)` outside this module is a lint error in app code
 * (see eslint.config.mjs) — allowed only in `orchestrator/**` itself, tests,
 * benchmarks, and the explicitly exempted non-LLM constructions
 * (remote-session-engine, tool-inspector).
 *
 * This is a LEAF module by design: it must not import the registrables hub
 * (`orchestration-core.server.ts`), so lightweight callers (micro-tasks, eval,
 * report) can use it without the hub's import cycle
 * (registrables → tools → judge → runMicroTask → tracking).
 */
import 'server-only';
import { Orchestrator } from '@/orchestrator/orchestrator';
import type { ConversationLogEntry, RegistrableClass } from '@/orchestrator/types';
import type { LLMCallDetail } from '@/lib/chat/chat-types';
import { collectLlmCallDetails, recordHeadlessLlmCalls } from '@/lib/chat/headless-llm-tracking.server';
import { recordLlmCallEvent, recordLlmResponse } from '@/lib/analytics/file-analytics.db';
import { creditEnforcer } from '@/lib/analytics/credit-usage.server';
import { buildLlmPlanResolver } from '@/lib/llm/llm-plan.server';
import { UNKNOWN_TRIGGER } from '@/lib/analytics/credits.types';
import { appEventRegistry, AppEvents } from '@/lib/app-event-registry';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { LlmAgentKey, LlmGrade } from '@/lib/llm/llm-config-types';

/**
 * Where this run's LLM usage is attributed:
 * - conversation-bound turns (chat / Slack) carry the conversation id plus the
 *   surface that triggered them (`source` → the ledger's `trigger` column;
 *   empty/absent normalizes to 'unknown');
 * - headless one-shot runs (micro-tasks, report, eval, feed-summary) carry a
 *   `task` tag instead (ledger `conversation_id` = 0 sentinel, `trigger` = task).
 */
export type UsageTracking =
  | { conversationId: number; source?: string | null }
  | { task: string };

export interface TrackedOrchestratorOptions {
  registrables: RegistrableClass[];
  /** Saved conversation log to resume from (chat). Omit for fresh headless runs. */
  savedLog?: ConversationLogEntry[];
  /** Drives credit gating + usage attribution (user id, mode, email/role on the app event). */
  user: EffectiveUser;
  tracking: UsageTracking;
  /** Forwarded to `buildLlmPlanResolver` — a custom agent's default grade pick. */
  gradeOverride?: LlmGrade;
  /**
   * Pin EVERY call in the run to one agent policy, overriding each agent class's
   * own `llmAgent` static. Used by report, whose LLM calls come from a dispatched
   * analyst sub-agent but must resolve under the `report` policy. Omit to let each
   * agent's own key drive resolution (the normal case).
   */
  llmAgent?: LlmAgentKey;
}

export interface TrackedOrchestrator {
  orch: Orchestrator;
  /**
   * Record this run's LLM usage out-of-band: per-call stats into `llm_call_events`
   * (awaited — durable before the caller returns), the response blob into
   * `llm_logs`, and one best-effort `AppEvents.LLM_CALL` publish. Defaults to the
   * orchestrator's full log; conversation turns pass just the turn's new entries.
   * Best-effort: never throws into the caller.
   */
  recordUsage: (entries?: ConversationLogEntry[]) => Promise<void>;
}

export function createTrackedOrchestrator(opts: TrackedOrchestratorOptions): TrackedOrchestrator {
  const { registrables, savedLog, user, tracking, gradeOverride, llmAgent } = opts;
  const orch = savedLog ? new Orchestrator(registrables, savedLog) : new Orchestrator(registrables);

  // 1. Credit gate, deep at the universal LLM call site: an over-limit enforced
  // user spends ZERO credits on any path — chat, sub-agents, headless runs alike.
  orch.beforeLlmCall = creditEnforcer(user);

  // 2. DB-backed model config (Settings → Models), resolved on every call.
  // Without this hook a run falls back to the agent's static MinusX-gateway
  // handle and ignores the workspace's configured providers.
  const resolve = buildLlmPlanResolver(gradeOverride);
  orch.resolveLlmPlan = llmAgent
    ? (selector) => resolve({ ...selector, agent: llmAgent })
    : resolve;

  // 3. Usage recording, bound to the run's attribution at construction time.
  const recordUsage = async (entries?: ConversationLogEntry[]): Promise<void> => {
    const log = entries ?? (orch.log as ConversationLogEntry[]);
    if ('task' in tracking) {
      await recordHeadlessLlmCalls(log, user, tracking.task);
    } else {
      await recordLlmCalls(log, tracking.conversationId, user, tracking.source);
    }
  };

  return { orch, recordUsage };
}

/**
 * Record a conversation turn's LLM calls out-of-band, from the turn's new log
 * entries: write per-call stats to `llm_call_events` and fill the response into
 * the `llm_logs` row whose request was already written when the call was made
 * (LOCAL only — never forwarded), then publish `AppEvents.LLM_CALL` for the
 * best-effort central stats forward. The call id + duration are the ones the
 * engine already stamps onto each message. Best-effort — never throws.
 *
 * Prefer `createTrackedOrchestrator().recordUsage`; this is the underlying
 * conversation-bound recorder (the headless sibling is `recordHeadlessLlmCalls`).
 */
export async function recordLlmCalls(
  piDiff: ConversationLogEntry[],
  conversationId: number,
  user: EffectiveUser,
  source?: string | null,
): Promise<void> {
  try {
    const userId = typeof user.userId === 'number' ? user.userId : null;
    const llmCalls: Record<string, LLMCallDetail> = {};
    for (const { callId, detail, msg } of collectLlmCallDetails(piDiff)) {
      llmCalls[callId] = detail;

      // LOCAL writes are AWAITED so they persist before the handler returns
      // (a standalone prod build won't keep fire-and-forget promises alive).
      await recordLlmCallEvent({
        conversationId,
        llmCallId: callId,
        provider: detail.provider,
        model: detail.model,
        mode: user.mode,
        totalTokens: detail.total_tokens,
        promptTokens: detail.prompt_tokens,
        completionTokens: detail.completion_tokens,
        cachedTokens: detail.cached_tokens,
        cacheCreationTokens: detail.cache_creation_tokens,
        cost: detail.cost,
        durationS: detail.duration,
        stream: true,
        finishReason: detail.finish_reason,
        // Never empty — a conversation surface (explore/question/…), else 'unknown'.
        trigger: source && source.length > 0 ? source : UNKNOWN_TRIGGER,
        userId,
        grade: detail.grade,
        agent: detail.agent,
      });

      // The request row was written when the call was made; fill in the
      // response (or the error message + error column for a failed call).
      await recordLlmResponse({
        callId,
        userId,
        provider: msg.provider,
        model: msg.model,
        responseJson: JSON.stringify(msg),
        error: msg.stopReason === 'error' ? (msg.errorMessage ?? 'error') : null,
      });
    }
    if (Object.keys(llmCalls).length === 0) return;
    // Best-effort central forward: the app-event registry stores it in `app_events` and fans
    // it to matching webhooks. Fire-and-forget — `publish` returns void and never throws.
    appEventRegistry.publish(AppEvents.LLM_CALL, {
      mode: user.mode,
      conversationId,
      llmCalls,
      userId: userId ?? undefined,
      userEmail: user.email,
      userRole: user.role,
    });
  } catch (e) {
    console.error('[v2/chat] failed to record LLM calls:', e);
  }
}
