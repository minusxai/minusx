import 'server-only';

export interface ColumnMeta {
  description?: string;
  category?: 'categorical' | 'numeric' | 'temporal' | 'text' | 'other';
  nullCount?: number;
  /** Only for categorical columns */
  nDistinct?: number;
  topValues?: Array<{ value: string | number | boolean; count: number; fraction: number }>;
  /** Only for numeric columns */
  min?: number | string;
  max?: number | string;
  avg?: number;
  /** Only for temporal columns */
  minDate?: string;
  maxDate?: string;
}

export interface SchemaColumn {
  name: string;
  type: string;
  meta?: ColumnMeta;
}

/**
 * One index on a table. `columns` lists the indexed columns/expressions in
 * order. Surfaced to the agent via `SearchDBSchema` so it can prefer
 * filtering/joining on indexed columns. Populated by connectors that can
 * introspect indexes (Postgres, SQLite, DuckDB, benchmark DuckDB-attached
 * SQLite); left `undefined` by connectors with no index concept (BigQuery,
 * Athena, CSV) — an honest absence rather than a fabricated empty list.
 */
export interface TableIndex {
  name: string;
  columns: string[];
  unique: boolean;
}

export interface SchemaTable {
  table: string;
  columns: SchemaColumn[];
  /** Indexes on this table, when the connector can introspect them. */
  indexes?: TableIndex[];
}

export interface SchemaEntry {
  schema: string;
  tables: SchemaTable[];
}

export interface QueryResult {
  columns: string[];
  types: string[];
  rows: Record<string, unknown>[];
  /** The query the engine effectively ran. For SQL connectors: the SQL with
   *  `:name` placeholders replaced by their inlined literal values via
   *  `lib/sql/inline-params.ts`. For MongoDB: the JSON `{collection, pipeline}`
   *  actually executed (with the row-cap `$limit` applied). Useful for
   *  display, logging, and surfacing to LLMs. */
  finalQuery: string;
}

/**
 * Streaming query result — the STREAMING-FIRST contract. The column metadata
 * (`columns`/`types`/`finalQuery`) is known up front (drivers expose it as soon
 * as the query starts), then `rows` is an async iterable that yields row objects
 * lazily as the driver produces them. Peak memory is one batch, never the whole
 * result — so the cache-write/response path can pipe straight through to the
 * object store + client without ever materializing.
 *
 * `query()` is the materialized convenience built on top of this via
 * {@link drainQueryStream}; every execution flows through `queryStream()`.
 */
export interface QueryStream {
  columns: string[];
  types: string[];
  finalQuery: string;
  /** Lazily-yielded, already-JSON-safe row objects. */
  rows: AsyncIterable<Record<string, unknown>>;
}

/** Drain a streaming result fully into a materialized QueryResult (for consumers that need every row). */
export async function drainQueryStream(stream: QueryStream): Promise<QueryResult> {
  const rows: Record<string, unknown>[] = [];
  for await (const row of stream.rows) rows.push(row);
  return { columns: stream.columns, types: stream.types, finalQuery: stream.finalQuery, rows };
}

export interface BoundedDrainOptions {
  /** Stop after this many rows (secondary ceiling). */
  maxRows?: number;
  /** Stop once accumulated row JSON reaches this many bytes (primary RAM bound). */
  maxBytes?: number;
}

export type BoundedQueryResult = QueryResult & {
  /** True when the source had MORE rows than were drained (budget hit). */
  truncated: boolean;
};

/**
 * Drain only until a row/byte budget is hit, then STOP pulling. Because the stream is pull-based
 * with backpressure, stopping here also stops the connector cursor — so peak server RAM is bounded
 * by the budget regardless of how many rows the query would produce. For agent/text consumers that
 * truncate to a character budget anyway: keeping the whole result in RAM to then throw most of it
 * away is wasteful and an OOM risk on a huge/uncapped result. `truncated` tells the caller the set
 * was clipped (exact total is unknown without a full drain — read it from the cache row when cached).
 */
export async function drainQueryStreamBounded(
  stream: QueryStream,
  { maxRows = Infinity, maxBytes = Infinity }: BoundedDrainOptions = {},
): Promise<BoundedQueryResult> {
  const rows: Record<string, unknown>[] = [];
  let bytes = 0;
  let truncated = false;
  for await (const row of stream.rows) {
    if (rows.length >= maxRows) { truncated = true; break; }
    // Measure this row's JSON size; stop BEFORE exceeding the byte budget (but always keep ≥1 row).
    bytes += Buffer.byteLength(JSON.stringify(row), 'utf8');
    rows.push(row);
    if (bytes >= maxBytes) { truncated = true; break; }
  }
  return { columns: stream.columns, types: stream.types, finalQuery: stream.finalQuery, rows, truncated };
}

/** Wrap a materialized QueryResult as a one-shot QueryStream (the base-class fallback for unconverted connectors). */
export function queryResultToStream(result: QueryResult): QueryStream {
  async function* gen(): AsyncGenerator<Record<string, unknown>> {
    for (const row of result.rows) yield row;
  }
  return { columns: result.columns, types: result.types, finalQuery: result.finalQuery, rows: gen() };
}

export interface TestConnectionResult {
  success: boolean;
  message: string;
  schema?: { schemas: SchemaEntry[] } | null;
}

// ─── Per-dialect config shapes ──────────────────────────────────────────────

export interface DuckDbConfig { file_path: string }
export interface SqliteConfig { file_path: string }
export interface PostgresConfig {
  host?: string;
  port?: number;
  database: string;
  username: string;
  password?: string;
  ssl?: Record<string, unknown>;
}
export interface BigQueryConfig {
  project_id: string;
  service_account_json: string;
}
export interface AthenaConfig {
  region_name?: string;
  s3_staging_dir: string;
  aws_access_key_id?: string;
  aws_secret_access_key?: string;
  work_group?: string;
}
export interface CsvConfig {
  files: Array<{
    table_name: string;
    schema_name: string;
    s3_key: string;
    file_format: 'csv' | 'parquet';
    row_count: number;
    columns: Array<{ name: string; type: string }>;
  }>;
}
export interface MongoConfig {
  host: string;
  port: number;
  database: string;
  username?: string;
  password?: string;
}
export interface ClickHouseConfig {
  host: string;
  port?: number;
  /** Default database for unqualified table names; schema discovery spans all databases. */
  database?: string;
  username: string;
  password?: string;
  /** Transport for the HTTP interface. Default 'https'. The playground uses https:443. */
  protocol?: 'http' | 'https';
}

/** Maps dialect string → config shape. */
export interface ConnectorConfigMap {
  duckdb: DuckDbConfig;
  sqlite: SqliteConfig;
  postgresql: PostgresConfig;
  bigquery: BigQueryConfig;
  athena: AthenaConfig;
  csv: CsvConfig;
  'google-sheets': CsvConfig;
  internal_db: Record<string, unknown>;
  mongo: MongoConfig;
  clickhouse: ClickHouseConfig;
}

export type ConnectorDialect = keyof ConnectorConfigMap;

/**
 * Abstract base class for Node.js database connectors.
 * The async database connector interface.
 */
export abstract class NodeConnector {
  constructor(
    protected readonly name: string,
    protected readonly config: Record<string, any>
  ) {}

  /**
   * Test if the connection is valid.
   * Returns { success, message, schema? }
   */
  abstract testConnection(includeSchema?: boolean): Promise<TestConnectionResult>;

  /**
   * Execute a query and return results.
   *
   * `query` is a dialect-specific query string: SQL for relational
   * connectors; for MongoDB, a JSON string `{collection, pipeline}` (a
   * native aggregation pipeline).
   *
   * `params` is `:name` substitution for SQL connectors (ignored by Mongo).
   * `timeoutMs` is a best-effort cancellation hint: connectors that can
   * interrupt / time-bound an in-flight query (DuckDB, SQLite-via-DuckDB,
   * Postgres, Mongo via `maxTimeMS`) honour it; others currently ignore it.
   */
  abstract query(
    query: string,
    params?: Record<string, string | number>,
    timeoutMs?: number,
  ): Promise<QueryResult>;

  /**
   * Execute a query and STREAM the result (streaming-first contract).
   *
   * Default implementation wraps {@link query} as a one-shot stream — correct,
   * but materializes. Connectors override this with a driver-native cursor
   * (DuckDB chunk reader, pg-query-stream, BigQuery createQueryStream, …) so the
   * server never holds the whole result; their `query()` then just drains this
   * via {@link drainQueryStream}.
   */
  async queryStream(
    query: string,
    params?: Record<string, string | number>,
    timeoutMs?: number,
    // Declared logical param types ('text' | 'number' | 'date'), keyed by name.
    // Optional + advisory: only connectors that need explicit param typing read
    // it (e.g. BigQuery types a `date` param as DATE so date comparisons compile).
    // The default wrapper ignores it.
    _paramTypes?: Record<string, string>,
  ): Promise<QueryStream> {
    return queryResultToStream(await this.query(query, params, timeoutMs));
  }

  /**
   * Get database schema.
   * Returns array of { schema, tables[] }.
   */
  abstract getSchema(): Promise<SchemaEntry[]>;
}
