import { Type } from 'typebox';
import type { TSchema } from 'typebox';
import type { ImageContent, TextContent, Tool } from '@/orchestrator/llm';
import { registerFauxProvider } from '@/orchestrator/llm/testing';
import { renderPrompt } from '@/orchestrator/prompts';
import { getAnalystModel } from './model-config';
import { ReadFiles, SearchFiles } from './file-tools';
import { BenchmarkAnalystAgent } from '@/agents/benchmark-analyst/benchmark-analyst';
import { ListDBConnections } from '@/agents/benchmark-analyst/db-tools';
import {
  SearchDBSchema,
  ExecuteQuery,
} from '@/agents/benchmark-analyst/db-tools.server';
import type { RemoteAnalystContext } from './types';

// Re-exports kept for backward compatibility with downstream test/agent imports.
export { ReadFiles, SearchFiles } from './file-tools';
export { ListDBConnections } from '@/agents/benchmark-analyst/db-tools';
export {
  SearchDBSchema,
  ExecuteQuery,
} from '@/agents/benchmark-analyst/db-tools.server';
export type { AnalystAgentContext, ConnectionInfo, RemoteAnalystContext } from './types';

export const fauxRegistration = registerFauxProvider({
  api: 'faux-analyst-api',
  provider: 'faux-analyst',
  models: [{ id: 'stub-analyst' }],
});
const FAUX_MODEL = fauxRegistration.getModel();

const RemoteAnalystAgentParams = Type.Object({
  userMessage: Type.String(),
});

/**
 * Production analyst agent. Extends BenchmarkAnalystAgent (DB tools) with file
 * tools (ReadFiles, SearchFiles), the production system-prompt rendering with
 * connectionId/home_folder, and the `<AppState>` / `<CurrentDate>` /
 * `<Question>` user-content wrap that the production prompts.yaml expects.
 */
export class RemoteAnalystAgent extends BenchmarkAnalystAgent<RemoteAnalystContext> {
  static readonly schema: Tool<typeof RemoteAnalystAgentParams> = {
    name: 'AnalystAgent',
    description: 'Answers data questions by searching the schema and running SQL.',
    parameters: RemoteAnalystAgentParams,
  };
  static readonly tools: Tool<TSchema>[] = [
    ListDBConnections.schema,
    SearchDBSchema.schema,
    ExecuteQuery.schema,
    ReadFiles.schema,
    SearchFiles.schema,
  ];
  static model = getAnalystModel() ?? FAUX_MODEL;

  protected getSystemPrompt(): string {
    return renderPrompt('default.system', {
      // Branding name the agent introduces itself as (Python: agent_args.agent_name, default "MinusX").
      agent_name: this.context.agentName ?? 'MinusX',
      // Matches Python's prompt value: MAX_STEPS_LOWER_LEVEL (35) − 5.
      max_steps: '30',
      // Matches Python: comma-joined list, or "all" when unspecified.
      allowed_viz_types: this.context.allowedVizTypes?.length
        ? this.context.allowedVizTypes.join(', ')
        : 'all',
      role: this.context.role ?? '',
      // Whitelisted table list (client-resolved), like Python's agent_args.schema.
      schema: this.context.schema ? JSON.stringify(this.context.schema) : '',
      // Markdown context docs from the chat's bound `type: 'context'` file
      // (resolved server-side in /api/chat/v2 → shared.ts → setupOrchestration).
      context: this.context.contextDocs ?? '',
      skills_catalog: '',
      connection_id: this.context.connectionId ?? '',
      home_folder: this.context.homeFolder ?? '',
      preloaded_skills: '',
    });
  }

  /**
   * Wraps the user message in the `<AppState>` / `<CurrentDate>` / `<Question>`
   * blocks the production prompts.yaml `default.user` template expects. This is
   * an analyst/MinusX convention — the orchestrator base just emits a single
   * text block by default.
   */
  protected buildUserContent(): (TextContent | ImageContent)[] {
    const raw = this.userMessage;
    const items: (TextContent | ImageContent)[] =
      typeof raw === 'string' ? [{ type: 'text', text: raw }] : raw;

    const images = items.filter((c): c is ImageContent => c.type === 'image');
    const goal = items
      .filter((c): c is TextContent => c.type === 'text')
      .map((c) => c.text)
      .join('\n');

    const appStateJson =
      this.context.appState !== undefined ? JSON.stringify(this.context.appState) : 'null';
    const date = new Date().toISOString().slice(0, 10);

    return [
      { type: 'text', text: `<AppState>${appStateJson}</AppState>\n<CurrentDate>${date}</CurrentDate>` },
      ...images,
      { type: 'text', text: `<Question>${goal}</Question>` },
    ];
  }
}

// Backward-compat alias. Pre-existing call sites (faux specs with
// `agent: 'AnalystAgent'`, slack tests, file-tools tests, etc.) keep working.
export const AnalystAgent = RemoteAnalystAgent;
