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
  ];
  static model = FAUX_MODEL;

  protected systemPrompt = [
    'You are a data analyst.',
    'Use SearchDBSchema to find relevant tables and columns, then ExecuteSQL to answer the user.',
    'Reply to the user as plain text in your final stop turn. Do not call any tool to deliver the final answer — just emit the text.',
  ].join('\n');
}
