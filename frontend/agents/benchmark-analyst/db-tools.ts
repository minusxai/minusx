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

/**
 * Shape emitted in `details` so the legacy `ExecuteSQLDisplay` (compact +
 * detail card) can render a proper data table. Mirrors `ExecuteQueryDetails`
 * in `frontend/lib/types.ts` — kept loose-typed here because this module is
 * deliberately standalone and must not import from `lib/types`.
 */
interface ExecuteSqlDetails extends Record<string, unknown> {
  success: boolean;
  queryResult?: { columns: string[]; types: string[]; rows: Record<string, unknown>[] };
  error?: string;
  executionMs?: number;
  finalQuery?: string;
}

export class ExecuteSQL extends MXTool<typeof ExecuteSQLParams, BenchmarkAnalystContext, ExecuteSqlDetails> {
  static readonly schema: Tool<typeof ExecuteSQLParams> = {
    name: 'ExecuteSQL',
    description: 'Execute a SQL query against a named connection. Returns rows or an error. Use ListDBConnections first to see available connection names.',
    parameters: ExecuteSQLParams,
  };

  async run(): Promise<ToolResponse<ExecuteSqlDetails>> {
    const result = await getSqlExecutor().execute(
      this.parameters.sql,
      this.parameters.connection,
      this.context,
    );
    if (result.error) {
      return {
        content: [{ type: 'text', text: result.error }],
        isError: true,
        details: { success: false, error: result.error, executionMs: result.executionMs },
      };
    }
    // Derive columns/types from rows when the executor didn't supply them
    // (benchmark stubs return rows only). Empty result → empty arrays.
    const columns = result.columns ?? (result.rows[0] ? Object.keys(result.rows[0]) : []);
    const types = result.types ?? columns.map(() => 'unknown');
    return {
      content: [{ type: 'text', text: JSON.stringify(result.rows) }],
      isError: false,
      details: {
        success: true,
        queryResult: { columns, types, rows: result.rows },
        finalQuery: result.finalQuery,
        executionMs: result.executionMs,
      },
    };
  }
}
