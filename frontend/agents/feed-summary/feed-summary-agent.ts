// FeedSummaryAgent.
//
// A leaf agent with NO tools: a single LLM call that turns recent-file app
// state into a 2-3 sentence home-feed summary. Renders the `feed_summary.system`
// / `feed_summary.user` prompts (in `orchestrator/prompts/prompts.yaml`). Runs
// headless via `runFeedSummaryV2`.
import 'server-only';
import { todayISO } from '@/lib/utils/today';
import { Type } from 'typebox';
import type { Tool, TextContent, ImageContent } from '@/orchestrator/llm';
import { renderPrompt } from '@/orchestrator/prompts';
import { registerFauxProvider } from '@/orchestrator/llm/testing';
import { RemoteAnalystAgent } from '@/agents/analyst/analyst-agent';
import { getAgentModelOrTestFallback } from '@/agents/analyst/model-config';
import { appStateForLlm, type AppState } from '@/lib/appState';

export const fauxRegistration = registerFauxProvider({
  api: 'faux-feed-summary-api',
  provider: 'faux-feed-summary',
  models: [{ id: 'stub-feed-summary' }],
});
const FAUX_MODEL = fauxRegistration.getModel();

const FeedSummaryAgentParams = Type.Object({
  userMessage: Type.String(),
});

export class FeedSummaryAgent extends RemoteAnalystAgent {
  static readonly schema: Tool<typeof FeedSummaryAgentParams> = {
    name: 'FeedSummaryAgent',
    description: 'Generates a short home-feed summary from recent-file app state. No tools, single LLM call.',
    parameters: FeedSummaryAgentParams,
  };
  // No tools — one LLM turn, returns text.
  static override readonly tools: Tool<typeof FeedSummaryAgentParams>[] = [];
  static override model = getAgentModelOrTestFallback(FAUX_MODEL);

  protected override getSystemPrompt(): string {
    return renderPrompt('feed_summary.system', {
      agent_name: this.context.agentName ?? 'MinusX',
    });
  }

  protected override buildUserContent(): (TextContent | ImageContent)[] {
    const appStateJson =
      this.context.appState !== undefined ? JSON.stringify(appStateForLlm(this.context.appState as AppState), null, 2) : 'null';
    const text = renderPrompt('feed_summary.user', {
      app_state: appStateJson,
      current_date: todayISO(),
    });
    return [{ type: 'text', text }];
  }
}
