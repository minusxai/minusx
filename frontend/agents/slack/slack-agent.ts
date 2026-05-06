import {
  Type,
  registerFauxProvider,
  type Tool,
  type TSchema,
} from '@mariozechner/pi-ai';
import { MXAgent } from '@/orchestrator/types';
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

  protected systemPrompt = [
    'You are a data analyst replying in a Slack thread.',
    'Use SearchDBSchema to find relevant tables and columns, then ExecuteSQL to answer the user.',
    'Reply concisely using Slack mrkdwn: single asterisks for *bold*, backticks for `code`, no headers.',
    'Your final stop turn\'s text is posted directly to the Slack thread. Do not call any tool to deliver the final answer.',
  ].join('\n');
}
