import { Type } from 'typebox';
import type { TSchema } from 'typebox';
import type { ImageContent, Message, TextContent, Tool } from '@/orchestrator/llm';
import { registerFauxProvider } from '@/orchestrator/llm/testing';
import { renderPrompt, PROMPTS } from '@/orchestrator/prompts';
import {
  getPreloadedSkillNames,
  buildSkillsCatalog,
  buildPreloadedSkillsContent,
} from './skills';
import { getAgentModelOrTestFallback } from './model-config';
import { ReadFiles, SearchFiles } from './file-tools';
import { BenchmarkAnalystAgent } from '@/agents/benchmark-analyst/benchmark-analyst';
import { ListDBConnections } from '@/agents/benchmark-analyst/db-tools';
import {
  SearchDBSchema,
  ExecuteQuery,
} from '@/agents/benchmark-analyst/db-tools.server';
import { LoadContext } from '@/agents/web-analyst/web-tools';
import { formatContextDocsSection } from '@/lib/sql/context-docs';
import { renderSchemaForPrompt } from '@/lib/chat/render-schema-prompt';
import type { RemoteAnalystContext, AgentAttachment } from './types';
import type { AppState } from '@/lib/appState';
import { projectMessages, type WithAppState } from '@/lib/projection/messages';

// Re-exports kept for backward compatibility with downstream test/agent imports.
export { ReadFiles, SearchFiles } from './file-tools';
export { ListDBConnections } from '@/agents/benchmark-analyst/db-tools';
export {
  SearchDBSchema,
  ExecuteQuery,
} from '@/agents/benchmark-analyst/db-tools.server';
export type { RemoteAnalystContext } from './types';

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
 * tools (ReadFiles, SearchFiles) and the production system-prompt rendering. App
 * state, markup, and the frozen <CurrentTime> are rendered by the single projection
 * pass in buildMessages (see lib/projection), not inline here.
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
    LoadContext.schema,
  ];
  static model = getAgentModelOrTestFallback(FAUX_MODEL);
  // Hard cap on the agentic loop, enforced by MXAgent.run(); the prompt hint
  // below is maxSteps − 5.
  // Typed `number` (not the literal 35) so subclasses can set their own cap
  // (e.g. the onboarding agents use a lower limit for latency).
  static readonly maxSteps: number = 35;

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
      // Branding name the agent introduces itself as (default "MinusX").
      agent_name: this.context.agentName ?? 'MinusX',
      // Prompt hint = maxSteps − 5.
      max_steps: String(ctor.maxSteps - 5),
      // Comma-joined list, or "all" when unspecified.
      allowed_viz_types: this.context.allowedVizTypes?.length
        ? this.context.allowedVizTypes.join(', ')
        : 'all',
      role: this.context.role ?? '',
      // Whitelisted table list (client-resolved), capped to a char budget so a
      // huge/rogue DB can't blow the context — overflow points at SearchDBSchema.
      schema: renderSchemaForPrompt(this.context.schema),
      // Fully-formatted "## Context" body: alwaysInclude docs + Schema Notes under
      // "Default Context Docs", then the lazy-loadable catalog (title + description,
      // fetched on demand via LoadContext) under "Context Library". Built by the
      // shared formatter so the prompt and the docs sidebar render identically.
      // (Resolved server-side via lib/chat/conversation-turn.server.ts → setupOrchestration
      // in lib/chat/orchestration-core.server.ts.)
      context: formatContextDocsSection(this.context.resolvedContextDocs ?? { docs: [] }),
      // LoadSkill catalog: skills available to fetch on demand (system + user,
      // minus already-preloaded).
      skills_catalog: buildSkillsCatalog({
        tree: PROMPTS,
        preloaded: new Set(preloadedNames),
        selected,
        userCatalog,
      }),
      connection_id: this.context.connectionId ?? '',
      home_folder: this.context.homeFolder ?? '',
      // Full content of page-relevant + selected skills, injected upfront.
      preloaded_skills: buildPreloadedSkillsContent({
        tree: PROMPTS,
        skillNames: preloadedNames,
        selected,
      }),
    });
  }

  /**
   * Builds the NON-app-state part of the user turn: text `<Attachment>` blocks, message +
   * attachment images, and the bare goal text. The `<AppState>` block and the frozen `<CurrentTime>`
   * are attached as markers in {@link buildMessages} and rendered by the single `projectMessages`
   * pass (CurrentTime right after the AppState).
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
    // <Attachment …> blocks.
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

    const blocks: (TextContent | ImageContent)[] = [];
    if (textAttachments) blocks.push({ type: 'text', text: textAttachments });
    blocks.push(...msgImages, ...attachmentImages, { type: 'text', text: goal });
    return blocks;
  }

  /**
   * Assemble the LLM messages, then run the single projection pass. The current user turn is
   * tagged with its page context (`_appState`); prior turns are tagged by the orchestrator
   * (`projectRootThreadHistory`) and tool results carry `details.__augmented`. `projectMessages`
   * walks the whole array through one FacetMemo, so app state (re-sent every turn) and repeated
   * file/query state collapse to `{unchanged:true}` while only changes are re-emitted in full.
   */
  buildMessages(): Message[] {
    const msgs = super.buildMessages();
    const idx = this.threadHistory.length; // the current user message
    const cur = msgs[idx];
    if (cur?.role === 'user') {
      const ctx = this.context as { currentTime?: string; viewport?: string };
      msgs[idx] = {
        ...cur,
        ...(this.context.appState !== undefined ? { _appState: this.context.appState as AppState } : {}),
        ...(ctx.currentTime !== undefined ? { _currentTime: ctx.currentTime } : {}),
        ...(ctx.viewport !== undefined ? { _viewport: ctx.viewport } : {}),
      } as Message & WithAppState;
    }
    return projectMessages(msgs);
  }
}
