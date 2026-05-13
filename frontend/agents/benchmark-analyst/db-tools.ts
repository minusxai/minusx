import { Type, type Tool } from '@mariozechner/pi-ai';
import { MXTool, type ToolResponse } from '@/orchestrator/types';
import type { BenchmarkAnalystContext, ConnectionInfo } from './types';
import { compressQueryResult, TOOL_DEFAULT_LIMIT_CHARS, TOOL_MAX_LIMIT_CHARS } from '@/lib/api/compress-augmented';
import { searchDatabaseSchema } from '@/lib/search/schema-search';
import { runQuery } from '@/lib/connections/run-query';
import { loadConnectionSchema } from '@/lib/connections/load-schema';
import { enforceQueryLimit } from '@/lib/sql/limit-enforcer';
import { getOrCreateBenchmarkConnector } from './shared-duckdb';
import type { NodeConnector, SchemaEntry } from '@/lib/connections/base';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

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
    // Strip `config` (which may contain credentials) before surfacing to the LLM.
    const visible = (this.context.connections ?? []).map(({ name, dialect, description }) =>
      ({ name, dialect, description }),
    );
    return {
      content: [{ type: 'text', text: JSON.stringify(visible) }],
      isError: false,
    };
  }
}

// ─── SearchDBSchema ───────────────────────────────────────────────────────

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
 * Falls back to `loadConnectionSchema(name, user)` (production path, reads
 * the connection file's cached schema) when no local config is present
 * — useful so the LLM gets a sensible answer if it asks about a name
 * that wasn't pre-loaded into `ctx.connections`.
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
   * Production tools override this to a no-op (see `SearchDBSchema`
   * below), so their `run()` always falls through to `loadConnectionSchema`.
   */
  protected async _initialiseConnectors(): Promise<void> {
    for (const entry of this.context.connections ?? []) {
      if (!entry.config) continue;
      if (this.connectors.has(entry.name)) continue;
      const c = await getOrCreateBenchmarkConnector(entry.name, entry.dialect, entry.config);
      this.connectors.set(entry.name, c);
    }
  }

  async run(): Promise<ToolResponse<SearchDBSchemaDetails>> {
    await this._initialiseConnectors();

    const query = this.parameters.query ?? '';
    const local = this.connectors.get(this.parameters.connection);
    const schemas: SchemaEntry[] = local
      ? await cachedConnectorSchema(this.parameters.connection, local)
      : await loadConnectionSchema(
          this.parameters.connection,
          (this.context as { effectiveUser?: EffectiveUser }).effectiveUser as EffectiveUser,
        );

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

    // Use production searchDatabaseSchema for identical result shape
    const payload = await searchDatabaseSchema(filteredSchemas, query || undefined) as SearchDBSchemaDetails;
    return {
      content: [{ type: 'text', text: JSON.stringify(payload) }],
      isError: false,
      details: payload,
    };
  }
}

/**
 * Production SearchDBSchema variant. Overrides `_initialiseConnectors`
 * to a no-op so `run()` always falls through to `loadConnectionSchema`,
 * reading the cached schema from the connection file via FilesAPI. Used
 * by `RemoteAnalystAgent` / `WebAnalystAgent`. Shares `schema.name`
 * with `BaseSearchDBSchema` so the LLM sees one tool name.
 */
export class SearchDBSchema extends BaseSearchDBSchema {
  static readonly schema = SEARCH_DB_SCHEMA_SCHEMA;

  protected override async _initialiseConnectors(): Promise<void> {
    // Production: never use embedded connectors. context.connections is
    // metadata-only here (no `config`), and connections resolve via
    // ConnectionsAPI inside runQuery / loadConnectionSchema.
  }
}

// ─── ExecuteQuery ─────────────────────────────────────────────────────────

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
 * Falls back to `runQuery` (production path) when no local config is
 * present for the requested name — useful belt-and-suspenders so the
 * LLM gets a sensible error message rather than a TypeError.
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

  async run(): Promise<ToolResponse<ExecuteQueryDetails>> {
    await this._initialiseConnectors();

    const { connectionId, query: rawQuery } = this.parameters;
    const maxChars = Math.min(
      this.parameters.maxChars ?? TOOL_DEFAULT_LIMIT_CHARS,
      TOOL_MAX_LIMIT_CHARS,
    );

    const start = Date.now();
    let result: { columns?: string[]; types?: string[]; rows: Record<string, unknown>[]; finalQuery?: string };
    try {
      const local = this.connectors.get(connectionId);
      if (local) {
        const dialect = this.dialects.get(connectionId) ?? 'duckdb';
        const cappedSql = await enforceQueryLimit(rawQuery, { dialect });
        result = await local.query(cappedSql);
      } else {
        result = await runQuery(
          connectionId,
          rawQuery,
          {},
          (this.context as { effectiveUser?: EffectiveUser }).effectiveUser as EffectiveUser,
        );
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

    // Derive columns/types from rows when the executor didn't supply them.
    // Empty result → empty arrays.
    const columns = result.columns ?? (result.rows[0] ? Object.keys(result.rows[0]) : []);
    const types = result.types ?? columns.map(() => 'unknown');

    // Compress for LLM-visible content: markdown table + truncation metadata.
    const compressed = compressQueryResult(
      { columns, types, rows: result.rows },
      maxChars,
    );

    return {
      // LLM sees: { columns, types, data: markdown, totalRows, shownRows,
      // truncated, finalQuery }. `finalQuery` is the SQL with `:name`
      // parameters inlined as literals — the closest readable form of what
      // the engine actually saw (see lib/sql/inline-params.ts).
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

/**
 * Production ExecuteQuery variant. Overrides `_initialiseConnectors`
 * to a no-op so `run()` always falls through to `runQuery`, which
 * routes via `ConnectionsAPI.getRawByName` + `getNodeConnector` (the
 * standard production seam). Used by `RemoteAnalystAgent` /
 * `WebAnalystAgent`. Shares `schema.name` with `BaseExecuteQuery`.
 */
export class ExecuteQuery extends BaseExecuteQuery {
  static readonly schema = EXECUTE_QUERY_SCHEMA;

  protected override async _initialiseConnectors(): Promise<void> {
    // Production: never use embedded connectors. context.connections is
    // metadata-only here (no `config`); query execution goes through
    // runQuery → ConnectionsAPI.getRawByName as usual.
  }
}

// Backward-compatible alias for legacy type imports that may still
// reference `ConnectionInfo` re-exported from this module.
export type { ConnectionInfo };
