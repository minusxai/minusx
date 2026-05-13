// CLI-safe DB tools. NO server-only imports — this module is loaded by
// `npm run benchmark:dab` (Node CLI) as well as by the v=2 server agent
// path. Production variants (which need `runQuery` / `loadConnectionSchema`
// → server-only chain into NextAuth) live in `db-tools.server.ts` and
// extend the `Base*` classes here.

import { Type, type Tool } from '@mariozechner/pi-ai';
import { MXTool, type ToolResponse } from '@/orchestrator/types';
import { type BenchmarkAnalystContext, publicConnectionMetadata } from './types';
import { compressQueryResult, TOOL_DEFAULT_LIMIT_CHARS, TOOL_MAX_LIMIT_CHARS } from '@/lib/api/compress-augmented';
import { searchDatabaseSchema } from '@/lib/search/schema-search';
import { enforceQueryLimit } from '@/lib/sql/limit-enforcer';
import { getOrCreateBenchmarkConnector } from './shared-duckdb';
import type { NodeConnector, QueryResult, SchemaEntry } from '@/lib/connections/base';

// ─── Schema cache ─────────────────────────────────────────────────────────
//
// `connector.getSchema()` reads from the DB on every call. Within a single
// benchmark/chat-continuation run we have many SearchDBSchema invocations
// across rows/turns — all hitting the same set of connections — so we
// memoise the introspection promise process-wide, keyed by connection name.
//
// Safe to cache process-wide because every concurrent session uses the same
// schema for a given name (each session creates its own connector instances,
// but the underlying schema is stable for the lifetime of the process). The
// cache is on Promises so concurrent first-callers share the in-flight
// introspection request.
// eslint-disable-next-line no-restricted-syntax -- server-only; benchmark process cache keyed by connection name
const schemaCache = new Map<string, Promise<SchemaEntry[]>>();

function cachedConnectorSchema(name: string, connector: NodeConnector): Promise<SchemaEntry[]> {
  const cached = schemaCache.get(name);
  if (cached) return cached;
  const p = connector.getSchema();
  schemaCache.set(name, p);
  return p;
}

// ─── ListDBConnections ────────────────────────────────────────────────────

const ListDBConnectionsParams = Type.Object({});

export class ListDBConnections extends MXTool<typeof ListDBConnectionsParams, BenchmarkAnalystContext> {
  static readonly schema: Tool<typeof ListDBConnectionsParams> = {
    name: 'ListDBConnections',
    description: 'List database connections available to this agent. Returns an array of {name, dialect, description?}.',
    parameters: ListDBConnectionsParams,
  };

  async run(): Promise<ToolResponse> {
    return {
      content: [{ type: 'text', text: JSON.stringify(publicConnectionMetadata(this.context.connections)) }],
      isError: false,
    };
  }
}

// ─── SearchDBSchema (Base) ────────────────────────────────────────────────

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

const SEARCH_DB_SCHEMA_SCHEMA: Tool<typeof SearchDBSchemaParams> = {
  name: 'SearchDBSchema',
  description: 'Search a connection\'s schema. Empty query returns full schema; non-empty does keyword match (or JSONPath when prefixed with `$`). Returns {success, queryType, tableCount, schema|results}. Use ListDBConnections first to see available connection names.',
  parameters: SearchDBSchemaParams,
};

/**
 * Base SearchDBSchema variant — instantiates connectors from
 * `ctx.connections[*].config` and reads their schemas directly (cached
 * process-wide per connection name). Used by `BenchmarkAnalystAgent` and
 * by benchmark chat-continuation: both paths arrive with full
 * connector configs in agent context.
 *
 * When the LLM asks about a name that isn't in `ctx.connections`, falls
 * through to `_loadSchemaFallback` (default: empty schema). Production
 * subclasses override this hook to look up the schema via the server-side
 * `loadConnectionSchema(name, user)` helper.
 */
export class BaseSearchDBSchema extends MXTool<typeof SearchDBSchemaParams, BenchmarkAnalystContext, SearchDBSchemaDetails> {
  static readonly schema = SEARCH_DB_SCHEMA_SCHEMA;

  protected connectors = new Map<string, NodeConnector>();

  /**
   * Lazy initialisation invoked at the top of `run()`. Reads
   * `ctx.connections` (JSON, may include `config`) and builds a
   * `NodeConnector` per entry that has a `config`. Idempotent — repeated
   * invocations on the same instance do nothing after the first; the
   * underlying `BenchmarkSharedDuckdb.ensureAttached` is also idempotent
   * across instances.
   *
   * Production tools override this to a no-op (see `db-tools.server.ts`),
   * so their `run()` always falls through to `_loadSchemaFallback`.
   */
  protected async _initialiseConnectors(): Promise<void> {
    for (const entry of this.context.connections ?? []) {
      if (!entry.config) continue;
      if (this.connectors.has(entry.name)) continue;
      const c = await getOrCreateBenchmarkConnector(entry.name, entry.dialect, entry.config);
      this.connectors.set(entry.name, c);
    }
  }

  /**
   * Hook for production subclasses (`db-tools.server.ts::SearchDBSchema`)
   * to plug in `loadConnectionSchema(name, user)`. Default returns empty
   * schemas — fine for benchmark/CLI where every queryable connection
   * should already be in `ctx.connections`.
   */
  protected async _loadSchemaFallback(_connection: string): Promise<SchemaEntry[]> {
    return [];
  }

  async run(): Promise<ToolResponse<SearchDBSchemaDetails>> {
    await this._initialiseConnectors();

    const query = this.parameters.query ?? '';
    const local = this.connectors.get(this.parameters.connection);
    const schemas: SchemaEntry[] = local
      ? await cachedConnectorSchema(this.parameters.connection, local)
      : await this._loadSchemaFallback(this.parameters.connection);

    // Per-run whitelist (set by chat-v2 from a context file) filters schemas
    // before they reach the LLM. Same logic as production tool-handlers.server.ts.
    const whitelist = this.context.whitelistedTables;
    const filteredSchemas = whitelist
      ? schemas.map((s) => ({
          ...s,
          tables: (s.tables || []).filter((t) =>
            whitelist.includes(t.table) ||
            (s.schema && whitelist.includes(`${s.schema}.${t.table}`)),
          ),
        })).filter((s) => s.tables.length > 0)
      : schemas;

    const payload = await searchDatabaseSchema(filteredSchemas, query || undefined) as SearchDBSchemaDetails;
    return {
      content: [{ type: 'text', text: JSON.stringify(payload) }],
      isError: false,
      details: payload,
    };
  }
}

// ─── ExecuteQuery (Base) ──────────────────────────────────────────────────

const ExecuteQueryParams = Type.Object({
  connectionId: Type.String(),
  query: Type.String(),
  maxChars: Type.Optional(Type.Number({
    description: 'Max characters of the markdown table returned to the LLM (default 10,000, max 100,000). Increase only if you need to see more rows in text form. Use OFFSET in SQL to page through large results instead.',
  })),
});

interface ExecuteQueryDetails extends Record<string, unknown> {
  success: boolean;
  queryResult?: { columns: string[]; types: string[]; rows: Record<string, unknown>[] };
  error?: string;
  executionMs?: number;
  finalQuery?: string;
}

const EXECUTE_QUERY_SCHEMA: Tool<typeof ExecuteQueryParams> = {
  name: 'ExecuteQuery',
  description: 'Execute a query against a named connection. The `query` is interpreted per the connection\'s dialect (SQL for relational connectors; for mongo, currently routed via QueryLeaf as SQL). A default LIMIT of 1000 rows is applied when your query has no LIMIT clause, and any explicit LIMIT above 10000 is capped at 10000 — use COUNT/SUM/GROUP BY for cardinality questions and explicit LIMIT/OFFSET to page through large tables. Returns JSON: data (GFM markdown of first shownRows), totalRows, shownRows, truncated, columns, types, finalQuery (SQL with parameters inlined). Increase maxChars (up to 100,000) to see more rows in the text response.',
  parameters: ExecuteQueryParams,
};

/**
 * Base ExecuteQuery variant — instantiates connectors from
 * `ctx.connections[*].config` and routes queries directly to them.
 * Used by `BenchmarkAnalystAgent` and by benchmark chat-continuation.
 *
 * sqlite/duckdb connections are routed through the process-wide
 * `BenchmarkSharedDuckdb` singleton (one in-memory DuckDBInstance with
 * all dataset files ATTACHed); other dialects use the regular
 * `getNodeConnector` factory.
 *
 * When the LLM asks about a name that isn't in `ctx.connections`, falls
 * through to `_executeFallback` (default: throws). Production subclasses
 * override this hook to route via the server-side `runQuery` helper.
 */
export class BaseExecuteQuery extends MXTool<typeof ExecuteQueryParams, BenchmarkAnalystContext, ExecuteQueryDetails> {
  static readonly schema = EXECUTE_QUERY_SCHEMA;

  protected connectors = new Map<string, NodeConnector>();
  protected dialects = new Map<string, string>();

  protected async _initialiseConnectors(): Promise<void> {
    for (const entry of this.context.connections ?? []) {
      if (!entry.config) continue;
      if (this.connectors.has(entry.name)) continue;
      const c = await getOrCreateBenchmarkConnector(entry.name, entry.dialect, entry.config);
      this.connectors.set(entry.name, c);
      this.dialects.set(entry.name, entry.dialect);
    }
  }

  /**
   * Hook for production subclasses (`db-tools.server.ts::ExecuteQuery`)
   * to plug in `runQuery`. Default throws — fine for benchmark/CLI where
   * every queryable connection should already be in `ctx.connections`.
   */
  protected async _executeFallback(
    connectionId: string,
    _query: string,
    _params: Record<string, string | number>,
  ): Promise<QueryResult> {
    throw new Error(
      `Connection '${connectionId}' is not in this agent's context. Use ListDBConnections to see available connection names.`,
    );
  }

  async run(): Promise<ToolResponse<ExecuteQueryDetails>> {
    await this._initialiseConnectors();

    const { connectionId, query: rawQuery } = this.parameters;
    const maxChars = Math.min(
      this.parameters.maxChars ?? TOOL_DEFAULT_LIMIT_CHARS,
      TOOL_MAX_LIMIT_CHARS,
    );

    const start = Date.now();
    let result: QueryResult;
    try {
      const local = this.connectors.get(connectionId);
      if (local) {
        const dialect = this.dialects.get(connectionId) ?? 'duckdb';
        const cappedSql = await enforceQueryLimit(rawQuery, { dialect });
        result = await local.query(cappedSql);
      } else {
        result = await this._executeFallback(connectionId, rawQuery, {});
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: errMsg }) }],
        isError: true,
        details: { success: false, error: errMsg, executionMs: Date.now() - start },
      };
    }
    const executionMs = Date.now() - start;

    const columns = result.columns ?? (result.rows[0] ? Object.keys(result.rows[0]) : []);
    const types = result.types ?? columns.map(() => 'unknown');

    const compressed = compressQueryResult(
      { columns, types, rows: result.rows },
      maxChars,
    );

    return {
      // LLM sees: { columns, types, data: markdown, totalRows, shownRows,
      // truncated, finalQuery }.
      content: [{
        type: 'text',
        text: JSON.stringify({ success: true, ...compressed, finalQuery: result.finalQuery }),
      }],
      isError: false,
      // UI display reads `details.queryResult.{columns,types,rows}` — full
      // untruncated rows, separate from what the LLM sees.
      details: {
        success: true,
        queryResult: { columns, types, rows: result.rows },
        finalQuery: result.finalQuery,
        executionMs,
      },
    };
  }
}

