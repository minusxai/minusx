import { Type } from 'typebox';
import type { TSchema } from 'typebox';
import type { ImageContent, TextContent, Tool } from '@/orchestrator/llm';
import { registerFauxProvider } from '@/orchestrator/llm/testing';
import { renderPrompt, PROMPTS } from '@/orchestrator/prompts';
import {
  getPreloadedSkillNames,
  buildSkillsCatalog,
  buildPreloadedSkillsContent,
} from './skills';
import { getAnalystModel } from './model-config';
import { ReadFiles, SearchFiles } from './file-tools';
import { BenchmarkAnalystAgent } from '@/agents/benchmark-analyst/benchmark-analyst';
import { ListDBConnections } from '@/agents/benchmark-analyst/db-tools';
import {
  SearchDBSchema,
  ExecuteQuery,
} from '@/agents/benchmark-analyst/db-tools.server';
import type { RemoteAnalystContext, AgentAttachment } from './types';

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
  // Hard cap on the agentic loop, enforced by MXAgent.run(). Matches Python's
  // MAX_STEPS_LOWER_LEVEL (config.py); the prompt hint below is maxSteps − 5.
  static readonly maxSteps = 35;

  protected getSystemPrompt(): string {
    const ctor = this.constructor as typeof RemoteAnalystAgent;
    const selected = this.context.selectedSkills ?? [];
    const userCatalog = this.context.userSkillCatalog ?? [];
    const preloadedNames = getPreloadedSkillNames({
      pageType: this.context.pageType ?? null,
      selected,
      unrestrictedMode: this.context.unrestrictedMode ?? false,
    });
    return renderPrompt('default.system', {
      // Branding name the agent introduces itself as (Python: agent_args.agent_name, default "MinusX").
      agent_name: this.context.agentName ?? 'MinusX',
      // Prompt hint = maxSteps − 5 (matches Python: MAX_STEPS_LOWER_LEVEL − 5).
      max_steps: String(ctor.maxSteps - 5),
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
      // LoadSkill catalog: skills available to fetch on demand (system + user,
      // minus already-preloaded). Matches Python's _build_skills_catalog.
      skills_catalog: buildSkillsCatalog({
        tree: PROMPTS,
        preloaded: new Set(preloadedNames),
        selected,
        userCatalog,
      }),
      connection_id: this.context.connectionId ?? '',
      home_folder: this.context.homeFolder ?? '',
      // Full content of page-relevant + selected skills, injected upfront.
      // Matches Python's _build_preloaded_skills_content.
      preloaded_skills: buildPreloadedSkillsContent({
        tree: PROMPTS,
        skillNames: preloadedNames,
        selected,
      }),
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

    const msgImages = items.filter((c): c is ImageContent => c.type === 'image');
    const goal = items
      .filter((c): c is TextContent => c.type === 'text')
      .map((c) => c.text)
      .join('\n');

    // Attachments (server-normalized): images → ImageContent (base64), text →
    // <Attachment …> blocks appended to the context block. Mirrors Python's
    // _get_image_content_blocks + _format_attachments.
    const attachments = this.context.attachments ?? [];
    const attachmentImages: ImageContent[] = attachments
      .filter((a): a is Extract<AgentAttachment, { type: 'image' }> => a.type === 'image')
      .map((a) => (a.url ? { type: 'image', url: a.url } : { type: 'image', data: a.data, mimeType: a.mimeType }));
    const textAttachments = attachments
      .filter((a): a is Extract<AgentAttachment, { type: 'text' }> => a.type === 'text')
      .map((a) => {
        const header = `[${a.name ?? 'attachment'}]` + (a.pages ? ` (${a.pages} pages)` : '');
        return `<Attachment ${header}>\n${a.content}\n</Attachment>`;
      })
      .join('\n');

    const appStateJson =
      this.context.appState !== undefined ? JSON.stringify(this.context.appState) : 'null';
    const date = new Date().toISOString().slice(0, 10);
    const contextText =
      `<AppState>${appStateJson}</AppState>\n<CurrentDate>${date}</CurrentDate>` +
      (textAttachments ? `\n${textAttachments}` : '');

    // Goal is a raw text block (no <Question> wrapper) — matches Python's
    // _get_user_message, whose goal block is the bare text.
    return [
      { type: 'text', text: contextText },
      ...msgImages,
      ...attachmentImages,
      { type: 'text', text: goal },
    ];
  }
}

// Backward-compat alias. Pre-existing call sites (faux specs with
// `agent: 'AnalystAgent'`, slack tests, file-tools tests, etc.) keep working.
export const AnalystAgent = RemoteAnalystAgent;
