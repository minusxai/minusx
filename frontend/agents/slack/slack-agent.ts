import {
  Type,
  registerFauxProvider,
  type Tool,
  type TSchema,
} from '@mariozechner/pi-ai';
import { MXAgent } from '@/orchestrator/types';
import { renderPrompt } from '@/orchestrator/prompts';
import { ExecuteSQL, SearchDBSchema } from '@/agents/analyst/analyst-agent';

export const fauxRegistration = registerFauxProvider({
  api: 'faux-slack-api',
  provider: 'faux-slack',
  models: [{ id: 'stub-slack' }],
});
const FAUX_MODEL = fauxRegistration.getModel();

const SlackAgentParams = Type.Object({
  userMessage: Type.String(),
});

export class SlackAgent extends MXAgent<typeof SlackAgentParams> {
  static readonly schema: Tool<typeof SlackAgentParams> = {
    name: 'SlackAgent',
    description: 'Answers data questions in Slack threads.',
    parameters: SlackAgentParams,
  };
  static readonly tools: Tool<TSchema>[] = [
    SearchDBSchema.schema,
    ExecuteSQL.schema,
  ];
  static model = FAUX_MODEL;

  protected getPromptVariables(): Record<string, string> {
    return {
      agent_name: 'SlackAgent',
      max_steps: '40',
      allowed_viz_types: '',
      role: '',
      schema: '',
      context: '',
      skills_catalog: '',
      connection_id: this.context.connectionId ?? '',
      home_folder: '',
      preloaded_skills: '',
    };
  }

  protected getSystemPrompt(): string {
    const base = renderPrompt('default.system', this.getPromptVariables());
    const addendum = renderPrompt('slack_addendum', {});
    return `${base}\n\n${addendum}`;
  }
}
