// FeedSummaryAgent (v=2 port of the Python FeedSummaryAgent).
//
// A leaf agent with NO tools: a single LLM call that turns recent-file app
// state into a 2-3 sentence home-feed summary. Renders the same prompts as the
// Python agent (`feed_summary.system` / `feed_summary.user`, already in
// `orchestrator/prompts/prompts.json`). Runs headless via `runFeedSummaryV2`.
import 'server-only';
import { Type } from 'typebox';
import type { Tool, TextContent, ImageContent } from '@/orchestrator/llm';
import { renderPrompt } from '@/orchestrator/prompts';
import { registerFauxProvider } from '@/orchestrator/llm/testing';
import { RemoteAnalystAgent } from '@/agents/analyst/analyst-agent';
import { getAnalystModel } from '@/agents/analyst/model-config';

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
  // No tools — one LLM turn, returns text (mirrors Python's tool_choice="none").
  static override readonly tools: Tool<typeof FeedSummaryAgentParams>[] = [];
  static override model = getAnalystModel() ?? FAUX_MODEL;

  protected override getSystemPrompt(): string {
    return renderPrompt('feed_summary.system', {
      agent_name: this.context.agentName ?? 'MinusX',
    });
  }

  protected override buildUserContent(): (TextContent | ImageContent)[] {
    const appStateJson =
      this.context.appState !== undefined ? JSON.stringify(this.context.appState, null, 2) : 'null';
    const text = renderPrompt('feed_summary.user', {
      app_state: appStateJson,
      current_date: new Date().toISOString().slice(0, 10),
    });
    return [{ type: 'text', text }];
  }
}
