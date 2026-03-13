import 'server-only';
import * as path from 'path';
import * as fs from 'fs';
import { withDuckDbConnection } from '@/lib/connections/duckdb-registry';

// Schema for per-company analytics database
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
  timestamp         TIMESTAMP NOT NULL DEFAULT current_timestamp
);

CREATE INDEX IF NOT EXISTS idx_llm_conv ON llm_call_events(conversation_id);
CREATE INDEX IF NOT EXISTS idx_llm_ts   ON llm_call_events(timestamp);
`;

// Track which absolute paths have already had initSchema run (idempotent guard)
const initializedPaths = new Set<string>();

// Convert legacy ? placeholders to $1, $2, ... (DuckDB prepared statement syntax)
function toPositional(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

function getAnalyticsDbDir(): string {
  if (process.env.ANALYTICS_DB_DIR) return process.env.ANALYTICS_DB_DIR;
  const base = process.env.BASE_DUCKDB_DATA_PATH || '.';
  return path.join(base, 'data', 'analytics');
}

/**
 * Check whether the analytics DuckDB file already exists for a given company.
 * Used by read-side queries to avoid creating a DB just for a read.
 */
export function analyticsDbExists(companyId: number): boolean {
  const dir = getAnalyticsDbDir();
  const dbPath = path.join(dir, `${companyId}.duckdb`);
  return fs.existsSync(dbPath);
}

/**
 * Resolve the absolute DB path for a company, ensuring the directory exists.
 */
function getAnalyticsDbPath(companyId: number): string {
  const dir = getAnalyticsDbDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, `${companyId}.duckdb`);
}

/**
 * Ensure schema is initialized for a given path (once per process).
 */
async function ensureSchema(dbPath: string): Promise<void> {
  if (initializedPaths.has(dbPath)) return;
  await withDuckDbConnection(dbPath, 'READ_WRITE', async (conn) => {
    for (const stmt of SCHEMA_SQL.split(';').map(s => s.trim()).filter(Boolean)) {
      await conn.run(stmt);
    }
  });
  initializedPaths.add(dbPath);
}

/**
 * Run a parameterized write statement (INSERT/UPDATE/DELETE).
 * Serialized via the per-file mutex in duckdb-registry.
 */
export async function runStatement(companyId: number, sql: string, params: unknown[]): Promise<void> {
  const dbPath = getAnalyticsDbPath(companyId);
  await ensureSchema(dbPath);
  await withDuckDbConnection(dbPath, 'READ_WRITE', async (conn) => {
    await conn.run(toPositional(sql), params as never);
  });
}

/**
 * Run a parameterized read query and return all rows as plain JS objects.
 * Serialized via the per-file mutex in duckdb-registry.
 */
export async function runQuery<T = Record<string, unknown>>(companyId: number, sql: string, params: unknown[]): Promise<T[]> {
  const dbPath = getAnalyticsDbPath(companyId);
  await ensureSchema(dbPath);
  return withDuckDbConnection(dbPath, 'READ_WRITE', async (conn) => {
    const result = await conn.run(toPositional(sql), params as never);
    return await result.getRowObjectsJS() as T[];
  });
}
