/**
 * Out-of-band LLM-usage tracking for HEADLESS runs (micro-tasks, eval, feed-summary) — no
 * conversation row. Extracted from `chat-orchestration-v2.server.ts` so lightweight callers
 * (e.g. `runMicroTask`) can record usage WITHOUT importing the full V2 registrables hub, which
 * would create an import cycle (registrables → tools → judge → runMicroTask → tracking).
 *
 * The conversation-bound recorder (`recordLlmCalls`) still lives in the big file and reuses
 * `buildLlmCallDetail` from here.
 */
import 'server-only';
import type { ConversationLogEntry as PiLogEntry } from '@/orchestrator/types';
import type { AssistantMessage } from '@/orchestrator/llm';
import type { LLMCallDetail } from '@/lib/chat-orchestration';
import { recordLlmResponse } from '@/lib/analytics/file-analytics.db';
import { appEventRegistry, AppEvents } from '@/lib/app-event-registry';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

/**
 * Recover the call id + `LLMCallDetail` for one log entry, or `null` if it isn't a recordable
 * assistant message. The engine stamps `_lllmCallId` / `_duration` onto the message (or its
 * first tool-call block); we mirror that lookup. Shared by the conversation-bound recorder
 * and the headless recorder below.
 */
export function buildLlmCallDetail(msg: AssistantMessage): { callId: string; detail: LLMCallDetail } | null {
  if (msg.role !== 'assistant') return null;
  const firstTool = msg.content?.find((c) => (c as { type?: string }).type === 'toolCall') as Record<string, unknown> | undefined;
  const meta = (firstTool ?? msg) as unknown as Record<string, unknown>;
  const callId = meta['_lllmCallId'] as string | undefined;
  if (!callId) return null;

  const u = msg.usage;
  const duration = typeof meta['_duration'] === 'number' ? (meta['_duration'] as number) : 0;
  return {
    callId,
    detail: {
      llm_call_id: callId,
      provider: msg.provider,
      model: msg.model,
      duration,
      total_tokens: u?.totalTokens ?? 0,
      prompt_tokens: u?.input ?? 0,
      completion_tokens: u?.output ?? 0,
      cached_tokens: u?.cacheRead ?? 0,
      cache_creation_tokens: u?.cacheWrite ?? 0,
      cost: u?.cost?.total ?? 0,
      stream: true,
      finish_reason: msg.stopReason,
    },
  };
}

/**
 * Record a headless run's LLM calls out-of-band: fill the `llm_logs` response blob (the
 * request row was already written by the global `setLlmCallRecorder`) and publish
 * `AppEvents.LLM_CALL` (tagged by `task`, no conversationId) for the central stats forward.
 * Best-effort: never throws into the caller.
 */
export async function recordHeadlessLlmCalls(piDiff: PiLogEntry[], user: EffectiveUser, task: string): Promise<void> {
  try {
    const userId = typeof user.userId === 'number' ? user.userId : null;
    const llmCalls: Record<string, LLMCallDetail> = {};
    for (const entry of piDiff) {
      const msg = entry as unknown as AssistantMessage;
      const built = buildLlmCallDetail(msg);
      if (!built) continue;
      const { callId, detail } = built;
      llmCalls[callId] = detail;

      try {
        await recordLlmResponse({
          callId,
          userId,
          provider: msg.provider,
          model: msg.model,
          responseJson: JSON.stringify(msg),
          error: msg.stopReason === 'error' ? (msg.errorMessage ?? 'error') : null,
        });
      } catch (e) {
        console.error('[v2/headless] failed to write llm_logs response:', e);
      }
    }
    if (Object.keys(llmCalls).length === 0) return;
    appEventRegistry.publish(AppEvents.LLM_CALL, {
      mode: user.mode,
      task,
      llmCalls,
      userId: userId ?? undefined,
      userEmail: user.email,
      userRole: user.role,
    });
  } catch (e) {
    console.error('[v2/headless] failed to record LLM calls:', e);
  }
}
