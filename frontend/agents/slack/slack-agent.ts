import { Type } from 'typebox';
import type { Tool } from '@/orchestrator/llm';
import { registerFauxProvider } from '@/orchestrator/llm/testing';
import { renderPrompt } from '@/orchestrator/prompts';
import { RemoteAnalystAgent } from '@/agents/analyst/analyst-agent';
import { getAgentModelOrTestFallback } from '@/agents/analyst/model-config';

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
    const base = renderPrompt('default.system', {
      agent_name: 'SlackAgent',
      max_steps: '40',
      allowed_viz_types: '',
      role: '',
      schema: '',
      context: '',
      // Slack keeps the system prompt minimal (no inline context docs); preserve
      // that — render no Context Library either.
      context_docs_catalog: 'No additional context documents are available.',
      skills_catalog: '',
      connection_id: this.context.connectionId ?? '',
      home_folder: '',
      preloaded_skills: '',
    });
    const addendum = renderPrompt('slack_addendum', {});
    return `${base}\n\n${addendum}`;
  }
}
