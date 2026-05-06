import {
  Type,
  registerFauxProvider,
  type ImageContent,
  type TextContent,
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
import type { AnalystAgentContext } from './types';
export { ReadFiles, SearchFiles } from './file-tools';
export type { AnalystAgentContext, ConnectionInfo } from './types';

export const fauxRegistration = registerFauxProvider({
  api: 'faux-analyst-api',
  provider: 'faux-analyst',
  models: [{ id: 'stub-analyst' }],
});
const FAUX_MODEL = fauxRegistration.getModel();

const ListDBConnectionsParams = Type.Object({});

export class ListDBConnections extends MXTool<typeof ListDBConnectionsParams, AnalystAgentContext> {
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

export class SearchDBSchema extends MXTool<typeof SearchDBSchemaParams, AnalystAgentContext> {
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

export class ExecuteSQL extends MXTool<typeof ExecuteSQLParams, AnalystAgentContext> {
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

export class AnalystAgent extends MXAgent<typeof AnalystAgentParams, AnalystAgentContext> {
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
