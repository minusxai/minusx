// CLI-safe DB tools. NO server-only imports — this module is loaded by
// `npm run benchmark:dab` (Node CLI) as well as by the v=2 server agent
// path. Production variants (which need `runQuery` / `loadConnectionSchema`
// → server-only chain into NextAuth) live in `db-tools.server.ts` and
// extend the `Base*` classes here.

import { Type } from 'typebox';
import type { TSchema } from 'typebox';
import type { Tool } from '@/orchestrator/llm';
import { MXTool, type ToolResponse } from '@/orchestrator/types';
import { type BenchmarkAnalystContext, type ConnectionInfo, publicConnectionMetadata } from './types';
import { compressQueryResult, TOOL_DEFAULT_LIMIT_CHARS, TOOL_MAX_LIMIT_CHARS } from '@/lib/api/compress-augmented';
import { searchDatabaseSchema } from '@/lib/search/schema-search';
import { enforceQueryLimit } from '@/lib/sql/limit-enforcer';
import { getOrCreateBenchmarkConnector } from './shared-duckdb';
import type { NodeConnector, QueryResult, SchemaEntry } from '@/lib/connections/base';
import { fuzzyMatch } from '@/lib/connections/fuzzy-search';
import { ExploreDataset } from './explore-dataset';
import {
  interpolateRefs,
  interpolateMongoRefs,
  mergeWithSessionLabels,
  recordSessionLabel,
  findUnresolvedMongoLabelRefs,
} from './v2/query-refs';
import { storeHandle, qualifyHandleRefs } from './v2/handle-store';
import { computeResultStats } from './v2/result-stats';
import { getCatalogStore } from './v2/catalog';
import type { ResultEntry } from './result-shapes';

// ─── Shared connector wiring ──────────────────────────────────────────────
//
// `BaseExecuteQuery` and `BaseSearchDBSchema` both lazily build a per-tool
// connector map from `ctx.connections[*].config` at the top of `run()`.
// The loop is identical apart from `BaseExecuteQuery` also tracking each
// entry's dialect (for `enforceQueryLimit`). One helper, both call sites.
async function buildConnectorsFromContext(
  connections: ConnectionInfo[] | undefined,
  connectors: Map<string, NodeConnector>,
  dialects?: Map<string, string>,
  datasetKey?: string,
): Promise<void> {
  for (const entry of connections ?? []) {
    if (!entry.config) continue;
    if (connectors.has(entry.name)) continue;
    const c = await getOrCreateBenchmarkConnector(
      entry.name, entry.dialect, entry.config, { datasetKey },
    );
    connectors.set(entry.name, c);
    dialects?.set(entry.name, entry.dialect);
  }
}

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
  connection_id: Type.String(),
  query: Type.Optional(Type.String({
    description: 'Search term. Empty / omitted → return full schema (no filter). String without `$` prefix → keyword match across schema/table/column names. String starting with `$` → JSONPath query.',
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
  description: 'Search a connection\'s schema. Empty query returns full schema; non-empty does keyword match (or JSONPath when prefixed with `$`). Returns {success, queryType, tableCount, schema|results}. Always inspect a table/collection here before querying it — do not guess column or field names. Each table includes `indexes: [{name, columns, unique}]` when the connection supports index introspection (Postgres, SQLite, DuckDB) — prefer filtering and joining on indexed columns; a leading-wildcard `LIKE \'%x%\'` cannot use a B-tree index and forces a full scan regardless. Use ListDBConnections first to see available connection names.',
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
   * Lazy initialisation invoked at the top of `run()`. See
   * `buildConnectorsFromContext` above for the shared logic.
   *
   * Production tools override this to a no-op (see `db-tools.server.ts`),
   * so their `run()` always falls through to `_loadSchemaFallback`.
   */
  protected async _initialiseConnectors(): Promise<void> {
    await buildConnectorsFromContext(
      this.context.connections, this.connectors, undefined, this.context.datasetKey,
    );
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
    const local = this.connectors.get(this.parameters.connection_id);
    const schemas: SchemaEntry[] = local
      ? await cachedConnectorSchema(this.parameters.connection_id, local)
      : await this._loadSchemaFallback(this.parameters.connection_id);

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

// Fields common to the benchmark and production ExecuteQuery schemas.
// Kept separate so the production variant (`db-tools.server.ts`) can build
// a schema WITHOUT the benchmark-only `timeout` param — the timeout is only
// honoured on the benchmark path today; wiring it through the production
// `_executeFallback` → `runQuery` chain is a tracked follow-up (Tasks.md).
const EXECUTE_QUERY_BASE_FIELDS = {
  connectionId: Type.String(),
  query: Type.String(),
  parameters: Type.Optional(Type.Record(Type.String(), Type.Unknown(), {
    description: 'Query parameters as key-value pairs, substituted for `:name` placeholders in the SQL.',
  })),
  vizSettings: Type.Optional(Type.Unknown({
    description: 'Optional chart settings to visualize the result (same shape as a question\'s vizSettings). Rendered in the UI; full-fidelity (never truncated).',
  })),
  maxChars: Type.Optional(Type.Number({
    description: 'Max characters of the markdown table returned to the LLM (default 10,000, max 100,000). Increase only if you need to see more rows in text form. Use OFFSET in SQL to page through large results instead.',
  })),
} as const;

const ExecuteQueryParams = Type.Object({
  ...EXECUTE_QUERY_BASE_FIELDS,
  timeout: Type.Optional(Type.Number({
    description: 'Query timeout in seconds (default 30, max 150). Set this to 90-150 UP FRONT for a query that will scan a large table (full-table aggregation, citation/graph traversal, JSON extraction over all rows) — do not eat a 30s kill and then retry. For ordinary queries leave it at the default and rewrite anything that times out (add filters, use an indexed column, avoid leading-wildcard LIKE).',
  })),
});

/**
 * Production ExecuteQuery params — same as `ExecuteQueryParams` minus
 * `timeout`. Consumed by `db-tools.server.ts::ExecuteQuery`, which routes
 * through `_executeFallback` → `runQuery` (a path that does not yet honour
 * the timeout — see Tasks.md). Hiding the param keeps the production tool
 * from advertising a capability it doesn't deliver.
 */
export const ExecuteQueryParamsNoTimeout = Type.Object(EXECUTE_QUERY_BASE_FIELDS);

/** Default query timeout when the agent doesn't specify one. */
export const DEFAULT_QUERY_TIMEOUT_SEC = 30;
/** Hard ceiling on the agent-supplied query timeout. */
export const MAX_QUERY_TIMEOUT_SEC = 150;

/**
 * Clamp the agent-supplied `timeout` (seconds) into `[1, MAX_QUERY_TIMEOUT_SEC]`,
 * falling back to `DEFAULT_QUERY_TIMEOUT_SEC` when unset or non-finite.
 */
export function clampQueryTimeoutSeconds(raw?: number): number {
  if (raw == null || !Number.isFinite(raw)) return DEFAULT_QUERY_TIMEOUT_SEC;
  return Math.min(Math.max(Math.floor(raw), 1), MAX_QUERY_TIMEOUT_SEC);
}

interface ExecuteQueryDetails extends Record<string, unknown> {
  success: boolean;
  queryResult?: { columns: string[]; types: string[]; rows: Record<string, unknown>[] };
  error?: string;
  executionMs?: number;
  finalQuery?: string;
}

/**
 * Base ExecuteQuery description — shared verbatim by the benchmark and
 * production schemas. The benchmark schema appends `EXECUTE_QUERY_TIMEOUT_NOTE`;
 * the production schema (no timeout support yet) uses this as-is.
 */
export const EXECUTE_QUERY_DESCRIPTION =
  'Execute a query against a named connection. The `query` is interpreted per the connection\'s dialect: for SQL connectors it is SQL; for a MongoDB connection it is a JSON string `{"collection": "...", "pipeline": [...aggregation stages]}` — a native aggregation pipeline, not SQL. A default row cap of 1000 is applied when the query has none, and an explicit cap above 10000 is reduced to 10000 (SQL: `LIMIT`; Mongo: a trailing `$limit` stage) — use COUNT/SUM/GROUP BY (Mongo: `$count`/`$group`) for cardinality questions and LIMIT/OFFSET (Mongo: `$limit`/`$skip`) to page through large results. Before querying a table/collection, confirm its real columns with SearchDBSchema — never reference a column you have not seen in its schema output. A leading-wildcard `LIKE \'%x%\'` forces a full-table scan — prefer equality/range filters on indexed columns (SearchDBSchema reports each table\'s `indexes`), and use FuzzySearch for approximate/typo-tolerant text matching. Returns JSON: data (GFM markdown of first shownRows), totalRows, shownRows, truncated, columns, types, finalQuery (the query as actually run). Increase maxChars (up to 100,000) to see more rows in the text response.';

const EXECUTE_QUERY_TIMEOUT_NOTE =
  ' A query that exceeds its `timeout` (default 30s, max 150s) is cancelled and returns an error — rewrite an expensive query rather than just raising the timeout.';

const EXECUTE_QUERY_SCHEMA: Tool<typeof ExecuteQueryParams> = {
  name: 'ExecuteQuery',
  description: EXECUTE_QUERY_DESCRIPTION + EXECUTE_QUERY_TIMEOUT_NOTE,
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
  // Typed as the loose `Tool<TSchema>` (not the inferred specific type) so
  // the production subclass in `db-tools.server.ts` can override `schema`
  // with a no-`timeout` variant. Matches `MXTool`'s own declaration.
  static readonly schema: Tool<TSchema> = EXECUTE_QUERY_SCHEMA;

  protected connectors = new Map<string, NodeConnector>();
  protected dialects = new Map<string, string>();

  protected async _initialiseConnectors(): Promise<void> {
    await buildConnectorsFromContext(
      this.context.connections, this.connectors, this.dialects, this.context.datasetKey,
    );
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
    const queryParams = (this.parameters.parameters ?? {}) as Record<string, string | number>;
    const maxChars = Math.min(
      this.parameters.maxChars ?? TOOL_DEFAULT_LIMIT_CHARS,
      TOOL_MAX_LIMIT_CHARS,
    );

    const timeoutMs = clampQueryTimeoutSeconds(this.parameters.timeout) * 1000;

    const start = Date.now();
    let result: QueryResult;
    try {
      const local = this.connectors.get(connectionId);
      if (local) {
        const dialect = this.dialects.get(connectionId) ?? 'duckdb';
        // MongoDB queries are JSON `{collection,pipeline}` strings, not SQL —
        // `enforceQueryLimit` is a SQL-AST parser, so skip it. MongoConnector
        // applies its own `enforceMongoLimit` to the pipeline internally.
        const cappedQuery = dialect === 'mongo'
          ? rawQuery
          : await enforceQueryLimit(rawQuery, { dialect });
        result = await local.query(cappedQuery, queryParams, timeoutMs);
      } else {
        result = await this._executeFallback(connectionId, rawQuery, queryParams);
      }
    } catch (err) {
      let errMsg = err instanceof Error ? err.message : String(err);
      // Make a timeout actionable at the point of failure: a cancelled
      // query returns NO rows (not partial), so the agent must either
      // raise the timeout or narrow the query — and narrowing risks
      // dropping rows the question needs.
      if (/exceeded the \d+s timeout/i.test(errMsg)) {
        errMsg += ` No rows were returned. Either retry with a higher \`timeout\` (up to ${MAX_QUERY_TIMEOUT_SEC}s), or narrow the query — but if you narrow it, beware you may exclude rows the question needs.`;
      }
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

const FuzzyMatchParams = Type.Object({
  connection: Type.String({ description: 'Database connection name' }),
  table: Type.String({ description: 'Table name to search' }),
  columns: Type.Array(Type.String(), { description: 'Text/categorical columns to search in. Searches all columns and returns matches grouped by column.' }),
  search_term: Type.String({ description: 'Short keyword(s) to fuzzy-match. Use 1-3 specific words, not full phrases.' }),
  schema: Type.Optional(Type.String({ description: "Schema name (default: 'main')" })),
  limit: Type.Optional(Type.Number({ description: 'Max results to return per column (default: 10)' })),
  semantic_expansion: Type.Optional(Type.Boolean({ description: 'Automatically expand search using semantically similar terms found in the column (default: true). Set to false for pure lexical matching only.' })),
  return_columns: Type.Optional(Type.Array(Type.String(), { description: 'Additional columns to include in each match result for identification (e.g. ["name", "category", "product_subcategory"]). Without this, only the matched column value and similarity score are returned.' })),
});

export class FuzzyMatch extends MXTool<typeof FuzzyMatchParams, BenchmarkAnalystContext> {
  static readonly schema: Tool<typeof FuzzyMatchParams> = {
    name: 'FuzzyMatch',
    description: 'Match a known term against stored values in one or more text/categorical columns (typo/casing/spacing correction). Use 1-3 short, specific keywords. Searches all specified columns and returns matches grouped by column. Use return_columns to include identifying columns (e.g. name, category) in results. When semantic_expansion is enabled (default: true), if no lexical matches are found for a column, it automatically finds semantically similar terms and retries.',
    parameters: FuzzyMatchParams,
  };

  protected connectors = new Map<string, NodeConnector>();
  protected dialects = new Map<string, string>();

  async run(): Promise<ToolResponse> {
    await buildConnectorsFromContext(this.context.connections, this.connectors, this.dialects);

    const { connection, table, columns, search_term, schema: schemaName, limit, semantic_expansion, return_columns } = this.parameters;
    const dialect = this.dialects.get(connection) ?? 'duckdb';
    const returnColumns = return_columns ?? [];

    const connector = this.connectors.get(connection);
    if (!connector) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: `Connection '${connection}' not found. Use ListDBConnections to see available connections.` }) }],
        isError: true,
      };
    }

    // Validate column categories — FuzzyMatch only works on text/categorical columns
    const schemas = await cachedConnectorSchema(connection, connector);
    const targetSchema = schemas.find((s) => s.schema === (schemaName ?? 'main'));
    const targetTable = targetSchema?.tables?.find((t) => t.table === table);
    const invalidColumns: string[] = [];
    for (const col of columns) {
      const targetColumn = targetTable?.columns?.find((c) => c.name === col);
      const category = (targetColumn as any)?.meta?.category as string | undefined;
      if (category && category !== 'text' && category !== 'categorical') {
        invalidColumns.push(`"${col}" (${category})`);
      }
    }
    if (invalidColumns.length > 0) {
      return {
        content: [{ type: 'text', text: JSON.stringify({
          success: false,
          error: `FuzzyMatch is only for text or categorical columns. Invalid columns: ${invalidColumns.join(', ')}. Use exact filters (=, >, <, BETWEEN) for these columns instead.`,
        }) }],
        isError: true,
      };
    }

    const queryFn = async (sql: string) => connector.query(sql);

    try {
      const result = await fuzzyMatch(dialect, queryFn, {
        table, columns, searchTerm: search_term, schema: schemaName, limit, returnColumns,
      });

      // Semantic expansion: find semantically similar terms and fuzzy-match
      // those to augment results (catches synonyms, different vocabulary, etc.).
      const shouldExpand = semantic_expansion !== false;
      if (shouldExpand) {
        const expandedTerms = await this.getSemanticTerms(connection, table, columns, search_term, schemaName);
        if (expandedTerms.length > 0) {
          const combinedSearch = expandedTerms.join(' ');
          const expandedResult = await fuzzyMatch(dialect, queryFn, { table, columns, searchTerm: combinedSearch, schema: schemaName, limit, returnColumns });
          return {
            content: [{ type: 'text', text: JSON.stringify({
              searchTerm: search_term,
              results: result.results,
              note: result.allEmpty ? `No matches found for "${search_term}". Focus on the semantically similar terms.` : undefined,
              expandedTerms: expandedTerms,
              expandedResults: expandedResult.results,
            }) }],
            isError: false,
          };
        }
      }

      return {
        content: [{ type: 'text', text: JSON.stringify({ ...result }) }],
        isError: false,
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: JSON.stringify({error: err instanceof Error ? err.message : String(err) }) }],
        isError: true,
      };
    }
  }

  /**
   * Use ExploreDataset to find semantically similar terms across columns.
   * Returns a list of individual terms (empty array on failure).
   */
  private async getSemanticTerms(
    connection: string,
    table: string,
    columns: string[],
    searchTerm: string,
    schemaName?: string,
  ): Promise<string[]> {
    const q = (name: string) => `"${name.replace(/"/g, '""')}"`;
    const qualTable = schemaName ? `${q(schemaName)}.${q(table)}` : q(table);

    // Sample distinct values from all searched columns
    const columnUnions = columns.map(col =>
      `SELECT DISTINCT ${q(col)} AS value FROM ${qualTable} WHERE ${q(col)} IS NOT NULL LIMIT 500`,
    );
    const query = columnUnions.length === 1 ? columnUnions[0] + ' LIMIT 1000' : `${columnUnions.join(' UNION ALL ')} LIMIT 1000`;

    const explore = new ExploreDataset(
      this.orchestrator,
      {
        queries: [{
          connection,
          query,
          label: 'values',
        }],
        prompt: `The user searched for "${searchTerm}" but no lexical matches were found in columns [${columns.join(', ')}]. Identify which terms from the data are semantically related to "${searchTerm}" — they may be synonyms, plural or misspelt words, or different terminology. Return ONLY the terms, one per line (each term is just 1-2 words max), no bullets, no numbering, no extra text.`,
      },
      this.context,
      this.id,
    );

    try {
      const response = await explore.run();
      const text = response.content?.[0];
      if (!text || text.type !== 'text') return [];
      const raw = (() => {
        try {
          const parsed = JSON.parse(text.text);
          return String(parsed.analysis ?? parsed.error ?? text.text);
        } catch {
          return text.text;
        }
      })();
      return raw
        .split('\n')
        .map((line) => line.replace(/^[\s\-\*\d.)+]+/, '').trim())
        .filter((t) => t.length > 0);
    } catch {
      return [];
    }
  }

}

// ─── CatalogSearchDBSchema (V1 benchmark) ─────────────────────────────────
//
// V1 benchmark's SearchDBSchema, ported from V2's primitives. Distinct
// from `BaseSearchDBSchema` (kept untouched for production).
//
// The agent writes SQL against a synthetic in-memory catalog spanning
// every connection in `ctx.connections`. Catalog tables:
//   connections, schemas, tables, columns, indexes, column_stats
// (No `sample_rows` / `sample_notes` — V1 explicitly excludes sampling.)
//
// Each query in the batch is independent. Per-query failures sit in
// their slot — the whole-batch-fail rule applies to ChainedExecuteQuery
// (pipeline) but NOT to SearchDBSchema (independent reads).

const CatalogQuerySpec = Type.Object({
  query: Type.String({ description: 'SQL query against the synthetic catalog' }),
});

const CatalogSearchDBSchemaParams = Type.Object({
  queries: Type.Array(CatalogQuerySpec, {
    description: 'One or more SQL queries against the catalog tables (connections, schemas, tables, columns, indexes, column_stats). Independent reads — failures don\'t cascade.',
    minItems: 1,
  }),
  maxChars: Type.Optional(Type.Number({
    description: 'Max characters of inline preview rows per result (default ~10,000). Use fetchHandle to paginate large results.',
  })),
});

interface CatalogSearchDBSchemaDetails extends Record<string, unknown> {
  queryCount: number;
}

const CATALOG_SEARCH_DB_SCHEMA_DESCRIPTION = `Query the synthetic schema catalog using SQL. The catalog is a small set of tables built from your connections' real schemas — query it to discover tables, columns, indexes, and statistics across ALL your connections at once.

CATALOG TABLES:
- connections(connection_name)
- schemas(connection_name, schema_name)
- tables(connection_name, schema_name, table_name, row_count)
- columns(connection_name, schema_name, table_name, column_name, data_type)
- indexes(connection_name, schema_name, table_name, index_name, columns, is_unique)
- column_stats(connection_name, schema_name, table_name, column_name, category, n_distinct, null_count, min_value, max_value, avg_value, min_date, max_date, top_values)

EXAMPLES:
- List every table: SELECT * FROM tables
- Find columns whose name contains 'user': SELECT * FROM columns WHERE column_name LIKE '%user%'
- Find categorical columns: SELECT * FROM column_stats WHERE category = 'categorical'
- Tables with at least one index: SELECT DISTINCT connection_name, table_name FROM indexes

Each result is returned as {preview, handle, stats}. Per-query failures appear as {error} in the slot — independent reads, the rest of the batch still runs.`;

const CATALOG_SEARCH_DB_SCHEMA_SCHEMA: Tool<typeof CatalogSearchDBSchemaParams> = {
  name: 'SearchDBSchema',
  description: CATALOG_SEARCH_DB_SCHEMA_DESCRIPTION,
  parameters: CatalogSearchDBSchemaParams,
};

/**
 * V1 benchmark SearchDBSchema — catalog-SQL variant.
 */
export class CatalogSearchDBSchema extends MXTool<
  typeof CatalogSearchDBSchemaParams,
  BenchmarkAnalystContext,
  CatalogSearchDBSchemaDetails
> {
  static readonly schema: Tool<TSchema> = CATALOG_SEARCH_DB_SCHEMA_SCHEMA;

  async run(): Promise<ToolResponse<CatalogSearchDBSchemaDetails>> {
    const { queries, maxChars } = this.parameters;
    const previewMaxChars = Math.min(maxChars ?? TOOL_DEFAULT_LIMIT_CHARS, TOOL_MAX_LIMIT_CHARS);

    if (!Array.isArray(queries) || queries.length === 0) {
      const err = 'SearchDBSchema requires at least one query in `queries`.';
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: err }) }],
        isError: true,
        details: { queryCount: 0 },
      };
    }

    // Build the catalog once (cached per datasetKey/catalogKey). V1 omits
    // sampling, so `sampleConfig` is undefined — sample_rows / sample_notes
    // tables stay empty in the catalog (not surfaced in the tool description).
    const { conn } = await getCatalogStore(
      this.context.connections,
      'default',                 // V1 has no catalogKey (DoubleCheck slot) yet
      undefined,                  // no sampling
      this.context.datasetKey,
    );

    type ResultSlot = ResultEntry;
    const results: ResultSlot[] = [];

    // Independent queries — failures sit in their slot, don't abort the batch.
    for (const spec of queries) {
      try {
        const result = await conn.run(spec.query);
        const cc = result.columnCount;
        const columns: string[] = [];
        const types: string[] = [];
        for (let i = 0; i < cc; i++) {
          columns.push(result.columnName(i));
          types.push(result.columnType(i).toString());
        }
        const rows = await result.getRowObjectsJS() as Record<string, unknown>[];
        const queryResult: QueryResult = { columns, types, rows, finalQuery: spec.query };

        const stored = await storeHandle(queryResult);
        const stats = computeResultStats(queryResult, Math.min(rows.length, 100));
        const preview = compressQueryResult(queryResult, previewMaxChars).data;
        results.push(
          stored.error
            ? { preview, stats, handle_error: stored.error }
            : { preview, handle: stored.handleId, stats },
        );
      } catch (err) {
        results.push({ error: err instanceof Error ? err.message : String(err) });
      }
    }

    return {
      content: [{ type: 'text', text: JSON.stringify({ results }) }],
      isError: false,
      details: { queryCount: queries.length },
    };
  }
}

// ─── ChainedExecuteQuery (V1 benchmark) ───────────────────────────────────
//
// The V1 benchmark agent's ExecuteQuery, ported from V2's primitives.
// Distinct from `BaseExecuteQuery` (kept untouched for production), this
// variant:
//   - takes `queries: [{connection, query, label?}]` instead of one query
//   - is ALWAYS sequential — runs the queries in order as a pipeline
//   - REQUIRES queries[1..n] to reference an earlier label via $label.col
//   - returns ONLY the final query's `{preview, handle, stats}` (single, not
//     an array) — intermediate queries are setup, not output
//   - on any error (validation, execution, interpolation) returns `{error}`
//     and aborts (whole-batch fail) — no partial results
//   - supports all V2's cross-DB primitives: SQL→Mongo $label.column,
//     `FROM handle_xyz` via the shared DuckDB, session-scoped labels
//     persisting across calls
//
// Internals reused as-is from V2: `interpolateRefs` / `interpolateMongoRefs`
// (./v2/query-refs.ts), `storeHandle` / `qualifyHandleRefs`
// (./v2/handle-store.ts), `computeResultStats` (./v2/result-stats.ts).

const ChainedQuerySpec = Type.Object({
  connection: Type.String({ description: 'Database connection name' }),
  query: Type.String({
    description: 'SQL query, OR for Mongo connections a JSON {"collection":"...","pipeline":[...]} string. Use $label.column to reference rows from an earlier query in this pipeline (or from a previous ExecuteQuery call).',
  }),
  label: Type.Optional(Type.String({
    description: 'Optional name for this query\'s rows. Later queries can reference them as $label.column. Labels persist across calls in the same session.',
  })),
});

const ChainedExecuteQueryParams = Type.Object({
  queries: Type.Array(ChainedQuerySpec, {
    description: 'Pipeline of queries to run sequentially. The 2nd+ query MUST contain a $label.column reference to an earlier query (in this call OR a previous one).',
    minItems: 1,
  }),
  timeout: Type.Optional(Type.Number({
    description: 'Per-query timeout in seconds (default 30, max 150). Set up front (90–150) for big-scan queries — don\'t retry on a default-kill.',
  })),
  maxChars: Type.Optional(Type.Number({
    description: 'Max characters of inline preview rows (default ~10,000). Increase only if you genuinely need to see more rows inline; otherwise use fetchHandle for pagination.',
  })),
});

interface ChainedExecuteQueryDetails extends Record<string, unknown> {
  success: boolean;
  queryCount: number;
  error?: string;
  finalQuery?: string;
}

const CHAINED_EXECUTE_QUERY_DESCRIPTION = `Run a pipeline of queries against your data connections. The pipeline returns ONE result — the final query's output as {preview, handle, stats}.

PIPELINE SEMANTICS:
- Queries run sequentially in the order given.
- The 2nd+ query MUST reference an earlier query's label via $label.column. The reference inlines the earlier rows' column values: in SQL it becomes a literal comma-separated list (e.g. WHERE id IN ($top.product_id) → WHERE id IN (4233, 5281, 10838)); inside a Mongo pipeline JSON it becomes a real JSON array (e.g. {"$in": "$top.product_id"} → {"$in": [4233, 5281, 10838]}). Universal cross-DB chaining — works SQL→SQL across engines, SQL→Mongo, Mongo→SQL.
- Labels persist across ExecuteQuery calls in the same session. If query 1 of call A labels its rows "top", query 1 of call B can reference $top.column.
- Whole-batch fail: if any query in the pipeline errors (validation, execution, interpolation), the call returns {error} and aborts. Independent queries should be issued as SEPARATE ExecuteQuery tool calls — the orchestrator dispatches parallel tool calls in parallel automatically.

HANDLES (returned with every successful result):
- The agent gets a handle ID for the final query's output. Use fetchHandle({handle, offset, length}) to paginate through more rows.
- For chaining across connections, always use $label.column — it works on every connection type uniformly. Some connection types additionally allow JOINing a handle back as a table inline (FROM handle_xyz); if that syntax is supported for a given connection, its per-dialect notes mention it. When unsure, prefer $label.column — it always works.
- A built-in connection named "_scratch" is always available as a workspace for combining results across connections via handle joins. When chaining via $label.column is enough, you do not need _scratch.

MONGO: queries against a Mongo connection are JSON strings of the form {"collection":"...","pipeline":[stages]}. Common stages: $match, $group, $project, $sort, $limit, $lookup, $unwind. Cross-DB chains use $label.column inside the JSON — the interpolator emits a JSON array. Heads-up: if you put "$x.y" inside $in/$nin and x isn't a defined label (this batch OR a previous call), the tool returns an explicit "unknown label" error listing the labels you DO have — much easier to act on than MongoDB's raw "$in needs an array" message.

TIMEOUT (default 30s, max 150s): per-query budget. Bump UP FRONT for large-scan queries; don't eat a default-kill and retry.

MAXCHARS (default ~10,000): caps inline preview text. Use fetchHandle for pagination over a handle rather than raising maxChars.`;

const CHAINED_EXECUTE_QUERY_SCHEMA: Tool<typeof ChainedExecuteQueryParams> = {
  name: 'ExecuteQuery',
  description: CHAINED_EXECUTE_QUERY_DESCRIPTION,
  parameters: ChainedExecuteQueryParams,
};

/**
 * V1 benchmark ExecuteQuery — chained-pipeline variant.
 *
 * Distinct class from `BaseExecuteQuery` (which production extends in
 * `db-tools.server.ts`). V1 benchmark registers THIS class instead.
 */
export class ChainedExecuteQuery extends MXTool<
  typeof ChainedExecuteQueryParams,
  BenchmarkAnalystContext,
  ChainedExecuteQueryDetails
> {
  static readonly schema: Tool<TSchema> = CHAINED_EXECUTE_QUERY_SCHEMA;

  protected connectors = new Map<string, NodeConnector>();
  protected dialects = new Map<string, string>();

  protected async _initialiseConnectors(): Promise<void> {
    await buildConnectorsFromContext(
      this.context.connections, this.connectors, this.dialects, this.context.datasetKey,
    );
    // Always make the built-in `_scratch` DuckDB available — gives the
    // agent a place to run `FROM handle_xyz` JOINs even in datasets that
    // declare only Mongo / Postgres source connections.
    if (!this.connectors.has('_scratch')) {
      const scratch = await getOrCreateBenchmarkConnector('_scratch', 'duckdb', {});
      this.connectors.set('_scratch', scratch);
      this.dialects.set('_scratch', 'duckdb');
    }
  }

  async run(): Promise<ToolResponse<ChainedExecuteQueryDetails>> {
    const { queries, timeout, maxChars } = this.parameters;
    const previewMaxChars = Math.min(maxChars ?? TOOL_DEFAULT_LIMIT_CHARS, TOOL_MAX_LIMIT_CHARS);
    const timeoutMs = clampQueryTimeoutSeconds(timeout) * 1000;

    // Validation: at least one query.
    if (!Array.isArray(queries) || queries.length === 0) {
      return errorResponse('ExecuteQuery requires at least one query in `queries`.', queries?.length ?? 0);
    }

    // Validation: 2nd+ queries must reference an earlier label via $label.col.
    const LABEL_REF_RE = /\$[a-zA-Z_]\w*\.\w+/;
    for (let i = 1; i < queries.length; i++) {
      if (!LABEL_REF_RE.test(queries[i].query)) {
        return errorResponse(
          `Query #${i + 1} in this pipeline does not reference an earlier label via $label.column. ExecuteQuery is always sequential — every query after the first must chain off a labeled earlier result. If your queries are independent, issue them as separate ExecuteQuery tool calls in parallel.`,
          queries.length,
        );
      }
    }

    await this._initialiseConnectors();

    const labeledResults = new Map<string, Record<string, unknown>[]>();
    let lastResult: QueryResult | null = null;

    for (let i = 0; i < queries.length; i++) {
      const spec = queries[i];
      const connector = this.connectors.get(spec.connection);
      if (!connector) {
        return errorResponse(
          `Connection '${spec.connection}' not found. Available: ${[...this.connectors.keys()].join(', ')}`,
          queries.length,
        );
      }
      const dialect = this.dialects.get(spec.connection) ?? 'duckdb';
      const isMongo = dialect === 'mongo';

      // Interpolate $label.col against per-call labels (set by earlier
      // queries in this batch) merged with session-scoped labels (set by
      // previous ExecuteQuery calls in the same agent run).
      const availableLabels = mergeWithSessionLabels(labeledResults);

      // Preflight: on Mongo, catch `$in: "$x.y"` references to unknown
      // labels BEFORE we send to the engine — its raw error ("$in needs
      // an array") doesn't mention the missing label.
      if (isMongo) {
        const unknown = findUnresolvedMongoLabelRefs(spec.query, availableLabels);
        if (unknown.length > 0) {
          const knownList = [...availableLabels.keys()].join(', ') || '(none)';
          return errorResponse(
            `Query #${i + 1} (Mongo) references label(s) [${unknown.join(', ')}] inside $in/$nin, but no such label is defined. Available labels in this session: [${knownList}]. Either earlier-label one of the queries in this batch (or a prior call) with that name, or fix the typo.`,
            queries.length,
          );
        }
      }

      const interpolated = availableLabels.size > 0
        ? (isMongo
          ? interpolateMongoRefs(spec.query, availableLabels)
          : interpolateRefs(spec.query, availableLabels))
        : spec.query;

      let finalQuery: string;
      try {
        // For SQL queries, rewrite `FROM handle_xyz` → `memory.main."handle_xyz"`
        // so the reference resolves to the shared-DuckDB handle table. Block
        // handle refs on Mongo (handles are SQL tables; can't query from Mongo).
        if (isMongo) {
          finalQuery = interpolated;
        } else {
          const { sql, referencedHandles } = await qualifyHandleRefs(interpolated);
          if (referencedHandles.length > 0 && dialect !== 'duckdb' && dialect !== 'sqlite') {
            return errorResponse(
              `Query #${i + 1} references labelled query result(s) (${referencedHandles.join(', ')}) on a '${dialect}' connection. To use a prior labelled result here, chain via \`sequential: true\` + \`$label.column\` instead of \`FROM handle_xyz\`.`,
              queries.length,
            );
          }
          finalQuery = await enforceQueryLimit(sql, { dialect });
        }
      } catch (err) {
        return errorResponse(
          `Query #${i + 1} failed before execution: ${err instanceof Error ? err.message : String(err)}`,
          queries.length,
        );
      }

      let result: QueryResult;
      try {
        result = await connector.query(finalQuery, undefined, timeoutMs);
      } catch (err) {
        return errorResponse(
          `Query #${i + 1} failed: ${err instanceof Error ? err.message : String(err)}`,
          queries.length,
        );
      }

      if (spec.label) {
        labeledResults.set(spec.label, result.rows);
        recordSessionLabel(spec.label, result.rows);
      }
      lastResult = result;
    }

    // Whole pipeline succeeded — return the FINAL query's result only.
    if (!lastResult) {
      return errorResponse('Pipeline produced no result (internal error).', queries.length);
    }

    const stored = await storeHandle(lastResult);
    const stats = computeResultStats(lastResult, Math.min(lastResult.rows.length, 100));
    const compressed = compressQueryResult(lastResult, previewMaxChars);
    const entry: ResultEntry = stored.error
      ? { preview: compressed.data, stats, handle_error: stored.error }
      : { preview: compressed.data, handle: stored.handleId, stats };

    return {
      content: [{ type: 'text', text: JSON.stringify(entry) }],
      isError: false,
      details: { success: true, queryCount: queries.length, finalQuery: lastResult.finalQuery },
    };

    function errorResponse(msg: string, qCount: number): ToolResponse<ChainedExecuteQueryDetails> {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: msg }) }],
        isError: true,
        details: { success: false, queryCount: qCount, error: msg },
      };
    }
  }
}
