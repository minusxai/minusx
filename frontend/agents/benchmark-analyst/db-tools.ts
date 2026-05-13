import { Type, type Tool } from '@mariozechner/pi-ai';
import { MXTool, type ToolResponse } from '@/orchestrator/types';
import { getSchemaSource, getSqlExecutor } from './sources';
import type { BenchmarkAnalystContext } from './types';
import { compressQueryResult, TOOL_DEFAULT_LIMIT_CHARS, TOOL_MAX_LIMIT_CHARS } from '@/lib/api/compress-augmented';
import { searchDatabaseSchema } from '@/lib/search/schema-search';

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
    const schemas = await (this.context.schemaSource ?? getSchemaSource()).getSchema(this.parameters.connection, this.context);

    // Per-run whitelist (set by chat-v2 from a context file) filters schemas
    // before they reach the LLM. Same logic as production tool-handlers.server.ts.
    const whitelist = this.context.whitelistedTables;
    const filteredSchemas = whitelist
      ? schemas.map((s: any) => ({
          ...s,
          tables: (s.tables || []).filter((t: any) =>
            whitelist.includes(t.table) ||
            (s.schema && whitelist.includes(`${s.schema}.${t.table}`)),
          ),
        })).filter((s: any) => s.tables.length > 0)
      : schemas;

    // Use production searchDatabaseSchema for identical result shape
    const payload = await searchDatabaseSchema(filteredSchemas, query || undefined) as SearchDBSchemaDetails;
    return {
      content: [{ type: 'text', text: JSON.stringify(payload) }],
      isError: false,
      details: payload,
    };
  }
}

const ExecuteQueryParams = Type.Object({
  connectionId: Type.String(),
  query: Type.String(),
  maxChars: Type.Optional(Type.Number({
    description: 'Max characters of the markdown table returned to the LLM (default 10,000, max 100,000). Increase only if you need to see more rows in text form. Use OFFSET in SQL to page through large results instead.',
  })),
});

/**
 * Shape emitted in `details` so the chat UI display can render a proper
 * data table with full untruncated rows. Mirrors `ExecuteQueryDetails` in
 * `frontend/lib/types.ts` — kept loose-typed here because this module is
 * deliberately standalone and must not import from `lib/types`.
 */
interface ExecuteQueryDetails extends Record<string, unknown> {
  success: boolean;
  queryResult?: { columns: string[]; types: string[]; rows: Record<string, unknown>[] };
  error?: string;
  executionMs?: number;
  finalQuery?: string;
}

export class ExecuteQuery extends MXTool<typeof ExecuteQueryParams, BenchmarkAnalystContext, ExecuteQueryDetails> {
  static readonly schema: Tool<typeof ExecuteQueryParams> = {
    name: 'ExecuteQuery',
    description: 'Execute a query against a named connection. The `query` is interpreted per the connection\'s dialect (SQL for relational connectors; for mongo, currently routed via QueryLeaf as SQL). Returns JSON: data (GFM markdown of first shownRows), totalRows, shownRows, truncated, columns, types. Increase maxChars (up to 100,000) or OFFSET in SQL to page large results.',
    parameters: ExecuteQueryParams,
  };

  async run(): Promise<ToolResponse<ExecuteQueryDetails>> {
    const result = await (this.context.sqlExecutor ?? getSqlExecutor()).execute(
      this.parameters.query,
      this.parameters.connectionId,
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
    // Same helper as the legacy /api/chat ExecuteQuery path, so the wire
    // shape on the LLM side matches.
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
