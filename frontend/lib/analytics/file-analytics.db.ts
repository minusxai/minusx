import 'server-only';
import * as path from 'path';
import * as fs from 'fs';
import { DuckDBInstance } from '@duckdb/node-api';
import { getOrCreateDuckDbInstance } from '@/lib/connections/duckdb-registry';
import { BASE_DUCKDB_DATA_PATH } from '@/lib/config';

// Schema for per-org analytics database
const SCHEMA_SQL = `
CREATE SEQUENCE IF NOT EXISTS file_events_id_seq;

CREATE TABLE IF NOT EXISTS file_events (
  id          BIGINT    DEFAULT nextval('file_events_id_seq') PRIMARY KEY,
  event_type  VARCHAR   NOT NULL,
  file_id     INTEGER   NOT NULL,
  file_type   VARCHAR,
  file_path   VARCHAR,
  file_name   VARCHAR,
  user_id     INTEGER,
  user_email  VARCHAR,
  user_role   VARCHAR,
  referenced_by_file_id   INTEGER,
  referenced_by_file_type VARCHAR,
  timestamp   TIMESTAMP NOT NULL DEFAULT current_timestamp
);

CREATE INDEX IF NOT EXISTS idx_fe_file_id ON file_events(file_id);
CREATE INDEX IF NOT EXISTS idx_fe_user    ON file_events(user_email);
CREATE INDEX IF NOT EXISTS idx_fe_ts      ON file_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_fe_type    ON file_events(event_type, file_id);

CREATE SEQUENCE IF NOT EXISTS llm_call_events_id_seq;

CREATE TABLE IF NOT EXISTS llm_call_events (
  id                BIGINT    DEFAULT nextval('llm_call_events_id_seq') PRIMARY KEY,
  conversation_id   INTEGER   NOT NULL,
  llm_call_id       VARCHAR,
  model             VARCHAR   NOT NULL,
  total_tokens      BIGINT    NOT NULL DEFAULT 0,
  prompt_tokens     BIGINT    NOT NULL DEFAULT 0,
  completion_tokens BIGINT    NOT NULL DEFAULT 0,
  cost              FLOAT8    NOT NULL DEFAULT 0,
  duration_s        FLOAT8    NOT NULL DEFAULT 0,
  finish_reason     VARCHAR,
  trigger           VARCHAR,
  user_id           INTEGER,
  user_email        VARCHAR,
  user_role         VARCHAR,
  timestamp         TIMESTAMP NOT NULL DEFAULT current_timestamp
);

CREATE INDEX IF NOT EXISTS idx_llm_conv ON llm_call_events(conversation_id);
CREATE INDEX IF NOT EXISTS idx_llm_ts   ON llm_call_events(timestamp);

ALTER TABLE llm_call_events ADD COLUMN IF NOT EXISTS trigger VARCHAR;
ALTER TABLE llm_call_events ADD COLUMN IF NOT EXISTS user_id INTEGER;
ALTER TABLE llm_call_events ADD COLUMN IF NOT EXISTS user_email VARCHAR;
ALTER TABLE llm_call_events ADD COLUMN IF NOT EXISTS user_role VARCHAR;

CREATE SEQUENCE IF NOT EXISTS query_execution_events_id_seq;

CREATE TABLE IF NOT EXISTS query_execution_events (
  id            BIGINT    DEFAULT nextval('query_execution_events_id_seq') PRIMARY KEY,
  query_hash    VARCHAR   NOT NULL,
  connection_name VARCHAR,
  duration_ms   INTEGER   NOT NULL DEFAULT 0,
  row_count     INTEGER   NOT NULL DEFAULT 0,
  was_cache_hit BOOLEAN   NOT NULL DEFAULT false,
  user_email    VARCHAR,
  timestamp     TIMESTAMP NOT NULL DEFAULT current_timestamp
);

CREATE INDEX IF NOT EXISTS idx_qee_hash ON query_execution_events(query_hash);
CREATE INDEX IF NOT EXISTS idx_qee_ts   ON query_execution_events(timestamp);

ALTER TABLE query_execution_events ADD COLUMN IF NOT EXISTS query_hash    VARCHAR;
ALTER TABLE query_execution_events ADD COLUMN IF NOT EXISTS connection_name VARCHAR;
ALTER TABLE query_execution_events ADD COLUMN IF NOT EXISTS duration_ms   INTEGER;
ALTER TABLE query_execution_events ADD COLUMN IF NOT EXISTS row_count     INTEGER;
ALTER TABLE query_execution_events ADD COLUMN IF NOT EXISTS was_cache_hit BOOLEAN;
ALTER TABLE query_execution_events ADD COLUMN IF NOT EXISTS user_email    VARCHAR;
`;

// Track which absolute paths have already had initSchema run (idempotent guard)
// eslint-disable-next-line no-restricted-syntax -- keyed by absolute file path (unique per org by directory layout)
const initializedPaths = new Set<string>();

// Convert legacy ? placeholders to $1, $2, ... (DuckDB prepared statement syntax)
function toPositional(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

function getAnalyticsDbDir(): string {
  // Read at call time (not import time) so tests can override via process.env.ANALYTICS_DB_DIR
  // eslint-disable-next-line no-restricted-syntax
  const dir = process.env.ANALYTICS_DB_DIR;
  if (dir) return dir;
  return path.join(BASE_DUCKDB_DATA_PATH, 'data', 'analytics');
}

async function initSchema(instance: DuckDBInstance): Promise<void> {
  const conn = await instance.connect();
  try {
    // Run each statement individually — @duckdb/node-api run() handles one statement at a time
    for (const stmt of SCHEMA_SQL.split(';').map(s => s.trim()).filter(Boolean)) {
      await conn.run(stmt);
    }
    // Flush WAL to the main DB file so a process kill after this point leaves
    // no WAL to replay on next startup (avoids ALTER TABLE WAL replay bug in DuckDB).
    await conn.run('CHECKPOINT');
  } finally {
    conn.closeSync();
  }
}

/**
 * Check whether the analytics DuckDB file already exists.
 * Used by read-side queries to avoid creating a DB just for a read.
 */
export function analyticsDbExists(): boolean {
  const dir = getAnalyticsDbDir();
  const dbPath = path.join(dir, 'analytics.duckdb');
  return fs.existsSync(dbPath);
}

/**
 * Returns the shared DuckDBInstance for analytics, creating it on first access.
 * Uses the shared duckdb-registry so the analytics DB and any user-configured
 * DuckDB connection pointing at the same file share a single instance (no lock conflict).
 */
export async function getAnalyticsDb(): Promise<DuckDBInstance> {
  const dir = getAnalyticsDbDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const dbPath = path.join(dir, 'analytics.duckdb');

  // Proactively delete stale WAL before the first open in this process.
  // initSchema always ends with CHECKPOINT so the WAL is empty after a clean shutdown.
  // After an unclean shutdown the WAL may contain a few unsaved analytics events — acceptable loss.
  // The duckdb-registry already handles the reactive case (deletes WAL on open error + retries),
  // but proactive deletion avoids paying the cost of a failed open attempt.
  if (!initializedPaths.has(dbPath)) {
    const walPath = `${dbPath}.wal`;
    if (fs.existsSync(walPath)) {
      try { fs.unlinkSync(walPath); } catch { /* race with another request or already deleted */ }
    }
  }

  const instance = await getOrCreateDuckDbInstance(dbPath);

  // Run schema init once per path (all CREATE IF NOT EXISTS — safe to repeat, but skip for perf)
  if (!initializedPaths.has(dbPath)) {
    await initSchema(instance);
    initializedPaths.add(dbPath);
  }

  return instance;
}

/**
 * Run a parameterized write statement (INSERT/UPDATE/DELETE).
 * Creates a short-lived connection and closes it after use.
 */
export async function runStatement(db: DuckDBInstance, sql: string, params: unknown[]): Promise<void> {
  const conn = await db.connect();
  try {
    await conn.run(toPositional(sql), params as never);
  } finally {
    conn.closeSync();
  }
}

/**
 * Run a parameterized read query and return all rows as plain JS objects.
 */
export async function runQuery<T = Record<string, unknown>>(db: DuckDBInstance, sql: string, params: unknown[]): Promise<T[]> {
  const conn = await db.connect();
  try {
    const result = await conn.run(toPositional(sql), params as never);
    return await result.getRowObjectsJS() as T[];
  } finally {
    conn.closeSync();
  }
}
