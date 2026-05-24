/**
 * Headless v=2 feed-summary execution.
 *
 * Runs the no-tools `FeedSummaryAgent` in-process via the TypeScript
 * orchestrator (no Python backend, no conversation file) and returns the
 * generated summary text. Used by `app/api/feed-summary/route.ts`.
 */
import 'server-only';
import { Orchestrator } from '@/orchestrator/orchestrator';
import type { AssistantMessage, TextContent } from '@/orchestrator/llm';
import { FeedSummaryAgent } from '@/agents/feed-summary/feed-summary-agent';
import type { RemoteAnalystContext } from '@/agents/analyst/types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

export async function runFeedSummaryV2(
  appState: unknown,
  user: EffectiveUser,
  agentName?: string,
): Promise<string> {
  const orch = new Orchestrator([FeedSummaryAgent]);
  const ctx: RemoteAnalystContext = {
    userId: String(user.userId ?? user.email),
    mode: user.mode === 'tutorial' ? 'tutorial' : 'org',
    effectiveUser: user,
    appState,
    agentName,
  };
  const agent = new FeedSummaryAgent(orch, { userMessage: 'Generate a feed summary.' }, ctx);

  const stream = orch.run(agent);
  for await (const ev of stream) {
    if ((ev as { type?: string }).type === 'error') {
      console.error('[v2/feed-summary] orchestrator error event:', (ev as { error?: { errorMessage?: string } }).error?.errorMessage);
    }
  }
  const final = (await stream.result()) as AssistantMessage;

  const summary = final.content
    .filter((c): c is TextContent => c.type === 'text')
    .map((c) => c.text)
    .join('')
    .trim();

  console.log(`[v2/feed-summary] generated summary (${summary.length} chars):\n${summary}`);
  return summary;
}
