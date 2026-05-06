import {
  Type,
  registerFauxProvider,
  type Tool,
  type TSchema,
} from '@mariozechner/pi-ai';
import {
  MXAgent,
  MXTool,
  type ToolResponse,
} from '@/orchestrator/types';
import { getSchemaSource, getSqlExecutor } from './sources';

export const fauxRegistration = registerFauxProvider({
  api: 'faux-analyst-api',
  provider: 'faux-analyst',
  models: [{ id: 'stub-analyst' }],
});
const FAUX_MODEL = fauxRegistration.getModel();

const SearchDBSchemaParams = Type.Object({
  query: Type.String(),
});

export class SearchDBSchema extends MXTool<typeof SearchDBSchemaParams> {
  static readonly schema: Tool<typeof SearchDBSchemaParams> = {
    name: 'SearchDBSchema',
    description: 'Search the database schema by keyword. Returns matching tables and their columns.',
    parameters: SearchDBSchemaParams,
  };

  async run(): Promise<ToolResponse> {
    const hits = await getSchemaSource().search(this.parameters.query);
    return {
      content: [{ type: 'text', text: JSON.stringify(hits) }],
      isError: false,
    };
  }
}

const ExecuteSQLParams = Type.Object({
  sql: Type.String(),
});

export class ExecuteSQL extends MXTool<typeof ExecuteSQLParams> {
  static readonly schema: Tool<typeof ExecuteSQLParams> = {
    name: 'ExecuteSQL',
    description: 'Execute a SQL query against the active connection. Returns rows or an error.',
    parameters: ExecuteSQLParams,
  };

  async run(): Promise<ToolResponse> {
    const result = await getSqlExecutor().execute(this.parameters.sql);
    if (result.error) {
      return {
        content: [{ type: 'text', text: result.error }],
        isError: true,
      };
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(result.rows) }],
      isError: false,
    };
  }
}

const TalkToUserParams = Type.Object({
  text: Type.String(),
});

export class TalkToUser extends MXTool<typeof TalkToUserParams> {
  static readonly schema: Tool<typeof TalkToUserParams> = {
    name: 'TalkToUser',
    description: 'Send a message to the user. Use this to communicate findings or progress.',
    parameters: TalkToUserParams,
  };

  async run(): Promise<ToolResponse> {
    return {
      content: [{ type: 'text', text: this.parameters.text }],
      isError: false,
    };
  }
}

const AnalystAgentParams = Type.Object({
  userMessage: Type.String(),
});

export class AnalystAgent extends MXAgent<typeof AnalystAgentParams> {
  static readonly schema: Tool<typeof AnalystAgentParams> = {
    name: 'AnalystAgent',
    description: 'Answers data questions by searching the schema and running SQL.',
    parameters: AnalystAgentParams,
  };
  static readonly tools: Tool<TSchema>[] = [
    SearchDBSchema.schema,
    ExecuteSQL.schema,
    TalkToUser.schema,
  ];
  static model = FAUX_MODEL;

  protected systemPrompt = [
    'You are a data analyst.',
    'Use SearchDBSchema to find relevant tables and columns, then ExecuteSQL to answer the user.',
    'Use TalkToUser to communicate findings or to ask clarifying questions.',
    'When you have answered the user\'s question, end your turn with a stop message containing the answer.',
  ].join('\n');
}
