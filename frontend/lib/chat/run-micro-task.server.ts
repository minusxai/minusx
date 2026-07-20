/**
 * Headless v=2 micro-task execution.
 *
 * Runs the no-tools `MicroAgent` for a named task (title/description/summary/…)
 * in-process via the TypeScript orchestrator (no conversation file) and returns
 * the generated text. Token usage + the raw response are tracked out-of-band via
 * `recordHeadlessLlmCalls` (tagged by task, no conversationId — see
 * `lib/chat/orchestration-core.server.ts`).
 */
import 'server-only';
import { Orchestrator } from '@/orchestrator/orchestrator';
import { creditEnforcer } from '@/lib/analytics/credit-usage.server';
import type { AssistantMessage, TextContent, ImageContent } from '@/orchestrator/llm';
import { MicroAgent } from '@/agents/micro/micro-agent';
import { getMicroTask } from '@/agents/micro/micro-tasks';
import type { MicroAgentContext } from '@/agents/micro/types';
import { recordHeadlessLlmCalls } from '@/lib/chat/headless-llm-tracking.server';
import { buildLlmPlanResolver } from '@/lib/llm/llm-plan.server';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

/**
 * Run a single-turn micro-task and return the model's text reply.
 *
 * @param taskKey - a key in `MICRO_TASKS` (e.g. 'title', 'description', 'summary').
 * @param vars    - template variables for the task's prompts (e.g. `{ input }`).
 * @param user    - the effective user (drives mode + usage attribution).
 */
export async function runMicroTask(
  taskKey: string,
  vars: Record<string, string>,
  user: EffectiveUser,
  images?: ImageContent[],
): Promise<string> {
  // Validate the task up-front so an unknown key throws before any LLM call.
  getMicroTask(taskKey);

  const orch = new Orchestrator([MicroAgent]);
  // Enforce per-user credit limits here too (no-op unless enforced): an over-limit
  // user spends ZERO credits anywhere — micro-tasks included, no exempt path.
  orch.beforeLlmCall = creditEnforcer(user);
  // DB-backed model config (Settings → Models): resolve the per-use-case plan on
  // every call — same wiring as chat turns (see orchestration-core). Without it,
  // micro-tasks run on MicroAgent's static MinusX-gateway model, which has no key.
  orch.resolveLlmPlan = buildLlmPlanResolver();
  const ctx: MicroAgentContext = {
    userId: String(user.userId ?? user.email),
    mode: user.mode === 'tutorial' ? 'tutorial' : 'org',
    effectiveUser: user,
    taskKey,
    vars,
    ...(images && images.length ? { images } : {}),
  };
  const agent = new MicroAgent(orch, { userMessage: `Run micro-task: ${taskKey}` }, ctx);

  const stream = orch.run(agent);
  // Keep the FIRST error event's message: it carries the actual cause (a missing API key, an
  // unconfigured use-case model, a provider/rate-limit error). Without it the throw below could
  // only say "produced no result", so a 500 reached the browser with the reason stranded in the
  // server console — undiagnosable from the client. The cause travels with the error now.
  let causeMessage: string | undefined;
  for await (const ev of stream) {
    if ((ev as { type?: string }).type === 'error') {
      const msg = (ev as { error?: { errorMessage?: string } }).error?.errorMessage;
      causeMessage ??= msg;
      console.error('[v2/micro-task] orchestrator error event:', msg);
    }
  }
  // On an LLM failure the run emits an error event and `result()` resolves to
  // null (see Orchestrator.run). Record usage either way, then fail loudly rather
  // than returning an empty string the caller would silently write as a title.
  const final = (await stream.result()) as AssistantMessage | null;

  await recordHeadlessLlmCalls(orch.log, user, taskKey);

  const text = (final?.content ?? [])
    .filter((c): c is TextContent => c.type === 'text')
    .map((c) => c.text)
    .join('')
    .trim();

  if (!text) {
    // An empty reply with NO error event is a genuinely empty completion; anything else is the
    // underlying failure and must be reported as such.
    throw new Error(
      causeMessage
        ? `Micro-task '${taskKey}' failed: ${causeMessage}`
        : `Micro-task '${taskKey}' produced no result (the model returned an empty reply)`,
    );
  }
  return text;
}
