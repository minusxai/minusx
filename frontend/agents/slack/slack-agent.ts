import { Type } from 'typebox';
import type { Tool } from '@/orchestrator/llm';
import { registerFauxProvider } from '@/orchestrator/llm/testing';
import { renderPrompt } from '@/orchestrator/prompts';
import { RemoteAnalystAgent } from '@/agents/analyst/analyst-agent';
import { getAgentModelOrTestFallback } from '@/agents/analyst/model-config';
import { formatContextDocsSection } from '@/lib/sql/context-docs';
import { renderSchemaForPrompt } from '@/lib/chat/render-schema-prompt';
import { PAGE_SKILL_MAP, buildPreloadedSkillsContent } from '@/agents/analyst/skills';
import { PROMPTS } from '@/orchestrator/prompts';

export const fauxRegistration = registerFauxProvider({
  api: 'faux-slack-api',
  provider: 'faux-slack',
  models: [{ id: 'stub-slack' }],
});
const FAUX_MODEL = fauxRegistration.getModel();

const SlackAgentParams = Type.Object({
  userMessage: Type.String(),
});

export class SlackAgent extends RemoteAnalystAgent {
  static readonly schema: Tool<typeof SlackAgentParams> = {
    name: 'SlackAgent',
    description: 'Answers data questions in Slack threads.',
    parameters: SlackAgentParams,
  };
  // Inherits tool set (DB tools + file tools) from RemoteAnalystAgent.
  static model = getAgentModelOrTestFallback(FAUX_MODEL);

  protected getSystemPrompt(): string {
    // Impersonate the invoking user: their allowed viz types, role, whitelisted
    // schema, context docs, connection, and home folder all flow from the context
    // the shared orchestration core resolved for that user (see setupOrchestration
    // in lib/chat/orchestration-core.server.ts).
    const ctx = this.context;
    const base = renderPrompt('default.system', {
      agent_name: 'SlackAgent',
      max_steps: '40',
      allowed_viz_types: ctx.allowedVizTypes?.length ? ctx.allowedVizTypes.join(', ') : 'all',
      role: ctx.role ?? '',
      schema: renderSchemaForPrompt(ctx.schema),
      // Same shared formatter as the web prompt + docs sidebar, so Slack sees the
      // user's Default Context Docs + on-demand Context Library identically.
      context: formatContextDocsSection(ctx.resolvedContextDocs ?? { docs: [] }),
      // Slack stays otherwise skill-minimal (no catalog, and — unlike the
      // analyst's getPreloadedSkillNames — no nav/UI skill appended; the
      // slack_addendum carries its own guidance). The preloaded set comes from
      // PAGE_SKILL_MAP['slack'], which includes `questions` — the home of the
      // `<viz>` envelope grammar (Vega-Lite specs, shipped recipes, table/pivot
      // sources) the agent needs to chart ExecuteQuery results in Slack.
      skills_catalog: '',
      connection_id: ctx.connectionId ?? '',
      home_folder: ctx.homeFolder ?? '',
      preloaded_skills: buildPreloadedSkillsContent({
        tree: PROMPTS,
        skillNames: PAGE_SKILL_MAP['slack'] ?? [],
        selected: [],
      }),
    });
    const addendum = renderPrompt('slack_addendum', {});
    return `${base}\n\n${addendum}`;
  }
}
