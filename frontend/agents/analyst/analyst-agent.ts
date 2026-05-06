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
import { renderPrompt } from '@/orchestrator/prompts';
import { getSchemaSource, getSqlExecutor } from './sources';
import { getAnalystModel } from './model-config';
import { ReadFiles, SearchFiles } from './file-tools';
export { ReadFiles, SearchFiles } from './file-tools';

export const fauxRegistration = registerFauxProvider({
  api: 'faux-analyst-api',
  provider: 'faux-analyst',
  models: [{ id: 'stub-analyst' }],
});
const FAUX_MODEL = fauxRegistration.getModel();

const ListDBConnectionsParams = Type.Object({});

export class ListDBConnections extends MXTool<typeof ListDBConnectionsParams> {
  static readonly schema: Tool<typeof ListDBConnectionsParams> = {
    name: 'ListDBConnections',
    description: 'List database connections available to this agent. Returns an array of {name, dialect, description?}.',
    parameters: ListDBConnectionsParams,
  };

  async run(): Promise<ToolResponse> {
    return {
      content: [{ type: 'text', text: JSON.stringify(this.context.connections ?? []) }],
      isError: false,
    };
  }
}

const SearchDBSchemaParams = Type.Object({
  connection: Type.String(),
  query: Type.String(),
});

export class SearchDBSchema extends MXTool<typeof SearchDBSchemaParams> {
  static readonly schema: Tool<typeof SearchDBSchemaParams> = {
    name: 'SearchDBSchema',
    description: 'Search a connection\'s schema by keyword. Returns matching tables and their columns. Use ListDBConnections first to see available connection names.',
    parameters: SearchDBSchemaParams,
  };

  async run(): Promise<ToolResponse> {
    const hits = await getSchemaSource().search(this.parameters.query, this.parameters.connection);
    return {
      content: [{ type: 'text', text: JSON.stringify(hits) }],
      isError: false,
    };
  }
}

const ExecuteSQLParams = Type.Object({
  connection: Type.String(),
  sql: Type.String(),
});

export class ExecuteSQL extends MXTool<typeof ExecuteSQLParams> {
  static readonly schema: Tool<typeof ExecuteSQLParams> = {
    name: 'ExecuteSQL',
    description: 'Execute a SQL query against a named connection. Returns rows or an error. Use ListDBConnections first to see available connection names.',
    parameters: ExecuteSQLParams,
  };

  async run(): Promise<ToolResponse> {
    const result = await getSqlExecutor().execute(this.parameters.sql, this.parameters.connection);
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
    ListDBConnections.schema,
    SearchDBSchema.schema,
    ExecuteSQL.schema,
    ReadFiles.schema,
    SearchFiles.schema,
  ];
  static model = getAnalystModel() ?? FAUX_MODEL;

  protected getSystemPrompt(): string {
    return renderPrompt('default.system', {
      agent_name: 'AnalystAgent',
      max_steps: '40',
      allowed_viz_types: '',
      role: '',
      schema: '',
      context: '',
      skills_catalog: '',
      connection_id: this.context.connectionId ?? '',
      home_folder: '',
      preloaded_skills: '',
    });
  }
}
