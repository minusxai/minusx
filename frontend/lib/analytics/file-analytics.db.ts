import 'server-only';
import * as path from 'path';
import * as fs from 'fs';

// Native DuckDB (not WASM) — excluded from Next.js bundle via serverExternalPackages
// eslint-disable-next-line @typescript-eslint/no-require-imports
const duckdb = require('duckdb');

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
`;

// Module-level pool: one Database per companyId, persists for process lifetime
const pool = new Map<number, any>();
// Tracks in-progress initializations to prevent concurrent init for same company
const initPromises = new Map<number, Promise<any>>();

function getAnalyticsDbDir(): string {
  if (process.env.ANALYTICS_DB_DIR) return process.env.ANALYTICS_DB_DIR;
  const base = process.env.BASE_DUCKDB_DATA_PATH || '.';
  return path.join(base, 'data', 'analytics');
}

function initSchema(db: any): Promise<void> {
  return new Promise((resolve, reject) => {
    const conn = db.connect();
    conn.exec(SCHEMA_SQL, (err: Error | null) => {
      conn.close();
      if (err) reject(err);
      else resolve();
    });
  });
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
 * Returns the DuckDB Database for the given company, creating it on first access.
 * Thread-safe: deduplicates concurrent init calls via initPromises.
 */
export async function getAnalyticsDb(companyId: number): Promise<any> {
  if (pool.has(companyId)) {
    return pool.get(companyId);
  }

  if (initPromises.has(companyId)) {
    return initPromises.get(companyId);
  }

  const initPromise = (async () => {
    const dir = getAnalyticsDbDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const dbPath = path.join(dir, `${companyId}.duckdb`);
    const db = new duckdb.Database(dbPath);

    await initSchema(db);

    pool.set(companyId, db);
    initPromises.delete(companyId);
    return db;
  })();

  initPromises.set(companyId, initPromise);
  return initPromise;
}

/**
 * Run a parameterized write statement (INSERT/UPDATE/DELETE).
 * Creates a short-lived connection and closes it after use.
 */
export function runStatement(db: any, sql: string, params: any[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const conn = db.connect();
    const args = [...params, (err: Error | null) => {
      conn.close();
      if (err) reject(err);
      else resolve();
    }];
    conn.run(sql, ...args);
  });
}

/**
 * Run a parameterized read query and return all rows.
 */
export function runQuery<T = Record<string, unknown>>(db: any, sql: string, params: any[]): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const conn = db.connect();
    const args = [...params, (err: Error | null, rows: T[]) => {
      conn.close();
      if (err) reject(err);
      else resolve(rows);
    }];
    conn.all(sql, ...args);
  });
}
