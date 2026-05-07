import { Type, type Tool } from '@mariozechner/pi-ai';
import { MXTool, type ToolResponse } from '@/orchestrator/types';
import { getSchemaSource, getSqlExecutor } from './sources';
import type { BenchmarkAnalystContext } from './types';
import { compressQueryResult, TOOL_DEFAULT_LIMIT_CHARS, TOOL_MAX_LIMIT_CHARS } from '@/lib/api/compress-augmented';

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
  query: Type.Optional(Type.String({
    description: 'Search term. Empty / omitted → return full schema (no filter). String without `$` prefix → keyword match across schema/table/column names. String starting with `$` → JSONPath query (matches Python ExecuteQuery semantics).',
  })),
});

interface SearchDBSchemaDetails extends Record<string, unknown> {
  success: boolean;
  queryType: 'none' | 'string' | 'jsonpath';
  tableCount: number;
  schema?: unknown[];
  results?: unknown[];
}

export class SearchDBSchema extends MXTool<typeof SearchDBSchemaParams, BenchmarkAnalystContext, SearchDBSchemaDetails> {
  static readonly schema: Tool<typeof SearchDBSchemaParams> = {
    name: 'SearchDBSchema',
    description: 'Search a connection\'s schema. Empty query returns full schema; non-empty does keyword match (or JSONPath when prefixed with `$`). Returns {success, queryType, tableCount, schema|results}. Use ListDBConnections first to see available connection names.',
    parameters: SearchDBSchemaParams,
  };

  async run(): Promise<ToolResponse<SearchDBSchemaDetails>> {
    const query = this.parameters.query ?? '';
    const hits = await getSchemaSource().search(query, this.parameters.connection, this.context);
    // Per-run whitelist (set by chat-v2 from a context file) filters hits
    // before they reach the LLM. Match either bare table name or a qualified
    // `schema.table` form so context whitelists in either shape work.
    const whitelist = this.context.whitelistedTables;
    const filtered = whitelist
      ? hits.filter((h) => {
          if (whitelist.includes(h.table)) return true;
          const schema = (h as { schema?: unknown }).schema;
          return typeof schema === 'string' && whitelist.includes(`${schema}.${h.table}`);
        })
      : hits;
    const queryType: 'none' | 'string' | 'jsonpath' =
      !query ? 'none' : query.startsWith('$') ? 'jsonpath' : 'string';
    const payload: SearchDBSchemaDetails = queryType === 'none'
      ? { success: true, queryType, tableCount: filtered.length, schema: filtered }
      : { success: true, queryType, tableCount: filtered.length, results: filtered };
    return {
      content: [{ type: 'text', text: JSON.stringify(payload) }],
      isError: false,
      details: payload,
    };
  }
}

const ExecuteSQLParams = Type.Object({
  connection: Type.String(),
  sql: Type.String(),
  maxChars: Type.Optional(Type.Number({
    description: 'Max characters of the markdown table returned to the LLM (default 10,000, max 100,000). Increase only if you need to see more rows in text form. Use OFFSET in SQL to page through large results instead.',
  })),
});

/**
 * Shape emitted in `details` so the legacy `ExecuteSQLDisplay` (compact +
 * detail card) can render a proper data table with full untruncated rows.
 * Mirrors `ExecuteQueryDetails` in `frontend/lib/types.ts` — kept loose-typed
 * here because this module is deliberately standalone and must not import
 * from `lib/types`.
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
    description: 'Execute a SQL query against a named connection. Returns a JSON object with: data (GFM markdown of the first shownRows), totalRows (full row count), shownRows (rows in data), truncated (true when shownRows < totalRows), columns, types. Increase maxChars (up to 100,000) or OFFSET in SQL to page through large results.',
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
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: result.error }) }],
        isError: true,
        details: { success: false, error: result.error, executionMs: result.executionMs },
      };
    }
    // Derive columns/types from rows when the executor didn't supply them
    // (benchmark stubs return rows only). Empty result → empty arrays.
    const columns = result.columns ?? (result.rows[0] ? Object.keys(result.rows[0]) : []);
    const types = result.types ?? columns.map(() => 'unknown');

    // Compress for LLM-visible content: markdown table + truncation metadata.
    // Reuses the same helper that `/api/chat`'s ExecuteQuery handler uses, so
    // v=2 ExecuteSQL emits the same wire shape as v=1 ExecuteQuery.
    const maxChars = Math.min(
      this.parameters.maxChars ?? TOOL_DEFAULT_LIMIT_CHARS,
      TOOL_MAX_LIMIT_CHARS,
    );
    const compressed = compressQueryResult(
      { columns, types, rows: result.rows },
      maxChars,
    );

    return {
      // LLM sees: { columns, types, data: markdown, totalRows, shownRows, truncated }.
      content: [{ type: 'text', text: JSON.stringify({ success: true, ...compressed }) }],
      isError: false,
      // UI display reads `details.queryResult.{columns,types,rows}` — full
      // untruncated rows, separate from what the LLM sees.
      details: {
        success: true,
        queryResult: { columns, types, rows: result.rows },
        finalQuery: result.finalQuery,
        executionMs: result.executionMs,
      },
    };
  }
}
