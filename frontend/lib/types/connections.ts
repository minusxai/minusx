// ============================================================================
// Connections domain types — split out of lib/types.ts (thin barrel there
// re-exports everything here; see lib/types.ts for the barrel).
// ============================================================================

import type { BaseEntity, BaseFileContent } from './files';
import type { JobSchedule } from './jobs';

/**
 * Database connection entity
 * Extends BaseEntity with connection-specific fields
 */
export interface DatabaseConnection extends BaseEntity {
  name: string;
  type: 'duckdb' | 'bigquery' | 'postgresql' | 'csv' | 'google-sheets' | 'athena' | 'sqlite' | 'internal_db' | 'clickhouse';
  config: Record<string, any>;  // Safe config fields only (no sensitive data)
}


export interface DatabaseSchema {
  schemas: Array<{
    schema: string;
    tables: Array<{
      table: string;
      columns: Array<{
        name: string;
        type: string;
      }>;
    }>;
  }>;
  updated_at: string;  // ISO timestamp - when schema was last fetched (required)
}

export interface DatabaseWithSchema {
  databaseName: string;
  schemas: DatabaseSchema['schemas'];
  updated_at?: string;  // ISO timestamp - optional for backward compatibility during transition
}

export interface TestConnectionResult {
  success: boolean;
  message: string;
  schema?: DatabaseSchema | null;  // Optional schema returned on successful test
}

// CSV / remote-file metadata stored in a CSV connection config
export interface CsvFileInfo {
  filename: string;
  table_name: string;
  schema_name: string;         // DuckDB schema, e.g. "public" or "mxfood"
  s3_key: string;              // S3 object key, org-scoped
  file_format: 'csv' | 'parquet';
  row_count: number;
  columns: { name: string; type: string }[];
  // Source tracking (used by the static connection to distinguish CSV vs Google Sheets imports)
  source_type?: 'csv' | 'google_sheets';
  spreadsheet_url?: string;    // For google_sheets: the source spreadsheet URL
  spreadsheet_id?: string;     // For google_sheets: Google spreadsheet ID (groups sheets from the same doc)
  /**
   * Agentic import: the agent-authored DuckDB transform that produced this table from the
   * spreadsheet's raw grids (see lib/sheets-import). Presence marks the table as agentically
   * imported — on resync the raw grids are re-extracted and this SQL re-runs, so refreshed
   * sheet data flows through the same cleaning (table detection / unpivot / value cleaning).
   */
  transform?: import('@/lib/sheets-import/types').SheetTransform;
}

// CSV connection config — pure S3-backed, no local files
export interface CsvConnectionConfig {
  files: CsvFileInfo[];
}

// Connection file content type (stored as file in /database/)
export interface ConnectionContent extends BaseFileContent {
  type: 'duckdb' | 'bigquery' | 'postgresql' | 'csv' | 'google-sheets' | 'athena' | 'sqlite' | 'internal_db' | 'clickhouse';
  config: Record<string, any>;
  description?: string;
  schema?: DatabaseSchema;  // Added by connection loader via introspection
  autoSync?: JobSchedule;   // Google Sheets auto-sync schedule (sheets_sync job)
  lastSyncedAt?: string;    // Last successful sync
  lastSyncError?: string;   // Most recent sync error; cleared on full success
}

// Connector (Meltano/Singer pipeline) types (stored as file in /connectors/)
export interface TapFacebookConfig {
  access_token: string;
  account_id: string;
  start_date?: string;
  end_date?: string;
  include_deleted?: boolean;
  insights_buffer_days?: number;
}

export interface TargetConfig {
  connection_name: string;  // Reference to existing connection
  schema?: string;          // Target schema (default: "facebook")
}

export interface PipelineConfig {
  tap: {
    name: 'tap-facebook';
    config: TapFacebookConfig;
  };
  target: TargetConfig;
}

export interface PipelineRunResult {
  execution_id: string;
  status: 'queued' | 'running' | 'success' | 'failed';
  started_at?: string;
  completed_at?: string;
  records_processed: number;
  duration_seconds?: number;
  error?: string;
  logs?: {
    tap_stderr?: string;
    target_stdout?: string;
    target_stderr?: string;
  };
}

export interface ConnectorContent extends BaseFileContent {
  pipelineConfig: PipelineConfig;
  description?: string;
  enabled?: boolean;
  lastRun?: PipelineRunResult;
}

// ============================================================================
// FullQuery — canonical query carrier type
// Propagated through the stack so dialect is always known alongside connection.
// ============================================================================

/** Maps DatabaseConnection.type to sqlglot dialect string. Mirrors backend _get_dialect_for_connection(). */
export function connectionTypeToDialect(type: string): string {
  const map: Record<string, string> = {
    duckdb: 'duckdb',
    bigquery: 'bigquery',
    postgresql: 'postgres',
    csv: 'duckdb',
    'google-sheets': 'duckdb',
    athena: 'presto',
    sqlite: 'sqlite',
    clickhouse: 'clickhouse',
  };
  return map[type] ?? 'duckdb';
}

/**
 * Canonical query carrier. Use Pick<FullQuery, ...> at call sites that only need a subset.
 * Never pass connection_name without dialect — always derive dialect when you have a connection.
 */
export type FullQuery = {
  connection_name: string;
  dialect: string;
  query: string;
  params: Record<string, string | number | null | undefined>;
};
