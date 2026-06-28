/**
 * Headless v=2 micro-task execution.
 *
 * Runs the no-tools `MicroAgent` for a named task (title/description/summary/…)
 * in-process via the TypeScript orchestrator (no conversation file) and returns
 * the generated text. Token usage + the raw response are tracked out-of-band via
 * `recordHeadlessLlmCalls` (tagged by task, no conversationId — see
 * `lib/chat-orchestration-v2.server.ts`).
 */
import 'server-only';
import { Orchestrator } from '@/orchestrator/orchestrator';
import type { AssistantMessage, TextContent } from '@/orchestrator/llm';
import { MicroAgent } from '@/agents/micro/micro-agent';
import { getMicroTask } from '@/agents/micro/micro-tasks';
import type { MicroAgentContext } from '@/agents/micro/types';
import { recordHeadlessLlmCalls } from '@/lib/chat-orchestration-v2.server';
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
): Promise<string> {
  // Validate the task up-front so an unknown key throws before any LLM call.
  getMicroTask(taskKey);

  const orch = new Orchestrator([MicroAgent]);
  const ctx: MicroAgentContext = {
    userId: String(user.userId ?? user.email),
    mode: user.mode === 'tutorial' ? 'tutorial' : 'org',
    effectiveUser: user,
    taskKey,
    vars,
  };
  const agent = new MicroAgent(orch, { userMessage: `Run micro-task: ${taskKey}` }, ctx);

  const stream = orch.run(agent);
  for await (const ev of stream) {
    if ((ev as { type?: string }).type === 'error') {
      console.error('[v2/micro-task] orchestrator error event:', (ev as { error?: { errorMessage?: string } }).error?.errorMessage);
    }
  }
  const final = (await stream.result()) as AssistantMessage;

  await recordHeadlessLlmCalls(orch.log, user, taskKey);

  return final.content
    .filter((c): c is TextContent => c.type === 'text')
    .map((c) => c.text)
    .join('')
    .trim();
}
