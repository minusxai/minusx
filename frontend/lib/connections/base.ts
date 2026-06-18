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
   * Get database schema.
   * Returns array of { schema, tables[] }.
   */
  abstract getSchema(): Promise<SchemaEntry[]>;
}
