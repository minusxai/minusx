import { Type, type Tool } from '@mariozechner/pi-ai';
import { MXTool, type ToolResponse } from '@/orchestrator/types';
import { getSchemaSource, getSqlExecutor } from './sources';
import type { BenchmarkAnalystContext } from './types';

const ListDBConnectionsParams = Type.Object({});

export class ListDBConnections extends MXTool<typeof ListDBConnectionsParams, BenchmarkAnalystContext> {
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

export class SearchDBSchema extends MXTool<typeof SearchDBSchemaParams, BenchmarkAnalystContext> {
  static readonly schema: Tool<typeof SearchDBSchemaParams> = {
    name: 'SearchDBSchema',
    description: 'Search a connection\'s schema by keyword. Returns matching tables and their columns. Use ListDBConnections first to see available connection names.',
    parameters: SearchDBSchemaParams,
  };

  async run(): Promise<ToolResponse> {
    const hits = await getSchemaSource().search(this.parameters.query, this.parameters.connection);
    // Per-run whitelist (set by chat-v2 from a context file) filters hits
    // before they reach the LLM. Match either bare table name or a qualified
    // `schema.table` form so context whitelists in either shape work.
    const whitelist = this.context.whitelistedTables;
    const filtered = whitelist
      ? hits.filter((h) => {
          if (whitelist.includes(h.table)) return true;
          // Some schema sources return `{schema, table}`; others just `{table}`.
          // The qualified `schema.table` form is checked when the source
          // exposes a schema field on the hit.
          const schema = (h as { schema?: unknown }).schema;
          return typeof schema === 'string' && whitelist.includes(`${schema}.${h.table}`);
        })
      : hits;
    return {
      content: [{ type: 'text', text: JSON.stringify(filtered) }],
      isError: false,
    };
  }
}

const ExecuteSQLParams = Type.Object({
  connection: Type.String(),
  sql: Type.String(),
});

export class ExecuteSQL extends MXTool<typeof ExecuteSQLParams, BenchmarkAnalystContext> {
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
