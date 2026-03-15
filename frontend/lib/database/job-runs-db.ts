/**
 * JobRunsDB - CRUD operations for the job_runs table
 * Tracks lifecycle, deduplication, and status of scheduled/manual job executions.
 */
import { JobRun, JobRunStatus, JobRunSource } from '../types';
import { getAdapter } from './adapter/factory';
import { getDbType } from './db-config';

// Raw row returned from the DB before JSON parsing
interface JobRunRow {
  id: number;
  created_at: string;
  completed_at: string | null;
  job_id: string;
  job_type: string;
  company_id: number;
  output_file_id: number | null;
  output_file_type: string | null;
  status: string;
  error: string | null;
  timeout: number;
  source: string;
}

function rowToJobRun(row: JobRunRow): JobRun {
  return {
    id: row.id,
    created_at: row.created_at,
    completed_at: row.completed_at,
    job_id: row.job_id,
    job_type: row.job_type,
    company_id: row.company_id,
    output_file_id: row.output_file_id,
    output_file_type: row.output_file_type,
    status: row.status as JobRunStatus,
    error: row.error,
    timeout: row.timeout,
    source: row.source as JobRunSource,
  };
}

const SQLITE_DDL = `
  CREATE TABLE IF NOT EXISTS job_runs (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at     TIMESTAMP NULL,
    job_id           TEXT NOT NULL,
    job_type         TEXT NOT NULL,
    company_id       INTEGER NOT NULL,
    output_file_id   INTEGER NULL,
    output_file_type TEXT NULL,
    status           TEXT NOT NULL DEFAULT 'RUNNING',
    error            TEXT NULL,
    timeout          INTEGER NOT NULL DEFAULT 30,
    source           TEXT NOT NULL DEFAULT 'manual',
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_job_runs_company_job ON job_runs(company_id, job_id, job_type);
  CREATE INDEX IF NOT EXISTS idx_job_runs_created_at ON job_runs(created_at DESC);
`;

const POSTGRES_DDL = `
  CREATE TABLE IF NOT EXISTS job_runs (
    id               SERIAL PRIMARY KEY,
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at     TIMESTAMP NULL,
    job_id           TEXT NOT NULL,
    job_type         TEXT NOT NULL,
    company_id       INTEGER NOT NULL,
    output_file_id   INTEGER NULL,
    output_file_type TEXT NULL,
    status           TEXT NOT NULL DEFAULT 'RUNNING',
    error            TEXT NULL,
    timeout          INTEGER NOT NULL DEFAULT 30,
    source           TEXT NOT NULL DEFAULT 'manual',
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_job_runs_company_job ON job_runs(company_id, job_id, job_type);
  CREATE INDEX IF NOT EXISTS idx_job_runs_created_at ON job_runs(created_at DESC);
`;

export class JobRunsDB {
  /**
   * Ensure the job_runs table exists (safe to call on every request).
   * New DBs already have the table from schema.ts; this handles existing DBs.
   */
  static async ensureTable(): Promise<void> {
    const db = await getAdapter();
    const ddl = getDbType() === 'postgres' ? POSTGRES_DDL : SQLITE_DDL;
    await db.exec(ddl);
  }

  /**
   * Force-create a new job run (no window dedup — for manual triggers).
   * Returns the new run ID.
   */
  static async create(params: {
    job_id: string;
    job_type: string;
    company_id: number;
    timeout?: number;
    source?: JobRunSource;
  }): Promise<number> {
    const db = await getAdapter();
    const { job_id, job_type, company_id, timeout = 30, source = 'manual' } = params;

    // Use a read-only CTE so the query starts with WITH — the SQLite adapter
    // detects WITH as a SELECT and calls .all(), which respects the RETURNING clause.
    const result = await db.query<{ id: number }>(
      `WITH row_data AS (
         SELECT $1 AS job_id, $2 AS job_type, $3 AS company_id, $4 AS timeout, $5 AS source
       )
       INSERT INTO job_runs (job_id, job_type, company_id, timeout, source, status)
       SELECT job_id, job_type, company_id, timeout, source, 'RUNNING'
       FROM row_data
       RETURNING id`,
      [job_id, job_type, company_id, timeout, source]
    );
    return result.rows[0].id;
  }

  /**
   * Atomic find-or-create within a time window (prevents duplicate cron runs).
   * Returns { runId, action, isNewRun }.
   */
  static async findOrCreate(params: {
    job_id: string;
    job_type: string;
    company_id: number;
    window_start: Date;
    window_end: Date;
    timeout?: number;
    source?: JobRunSource;
  }): Promise<{ runId: number; action: string; isNewRun: boolean }> {
    const db = await getAdapter();
    const { job_id, job_type, company_id, window_start, window_end, timeout = 30, source = 'cron' } = params;

    // SQLite stores CURRENT_TIMESTAMP as 'YYYY-MM-DD HH:MM:SS' (no T, no Z).
    // ISO strings use 'YYYY-MM-DDTHH:MM:SS.mmmZ', and string comparison
    // would fail because space (ASCII 32) < 'T' (ASCII 84).
    // Normalize bounds to SQLite format when running on SQLite.
    const toWindowBound = (d: Date): string =>
      getDbType() === 'sqlite'
        ? d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '')
        : d.toISOString();

    return db.transaction(async (tx) => {
      // Check for existing run within the window
      const existing = await tx.query<{ id: number }>(
        `SELECT id FROM job_runs
         WHERE job_id = $1 AND job_type = $2 AND company_id = $3
           AND created_at >= $4 AND created_at <= $5
         LIMIT 1`,
        [job_id, job_type, company_id, toWindowBound(window_start), toWindowBound(window_end)]
      );

      if (existing.rows.length > 0) {
        return { runId: existing.rows[0].id, action: 'found', isNewRun: false };
      }

      const inserted = await tx.query<{ id: number }>(
        `WITH row_data AS (
           SELECT $1 AS job_id, $2 AS job_type, $3 AS company_id, $4 AS timeout, $5 AS source
         )
         INSERT INTO job_runs (job_id, job_type, company_id, timeout, source, status)
         SELECT job_id, job_type, company_id, timeout, source, 'RUNNING'
         FROM row_data
         RETURNING id`,
        [job_id, job_type, company_id, timeout, source]
      );
      return { runId: inserted.rows[0].id, action: 'created', isNewRun: true };
    });
  }

  /**
   * Mark a job run as complete and optionally record the result file ID.
   */
  static async complete(
    runId: number,
    status: 'SUCCESS' | 'FAILURE' | 'TIMEOUT',
    output_file_id?: number,
    output_file_type?: string,
    error?: string
  ): Promise<void> {
    const db = await getAdapter();
    await db.query(
      `UPDATE job_runs
       SET status = $1, completed_at = CURRENT_TIMESTAMP,
           output_file_id = $2, output_file_type = $3, error = $4
       WHERE id = $5`,
      [
        status,
        output_file_id ?? null,
        output_file_type ?? null,
        error ?? null,
        runId,
      ]
    );
  }

  /**
   * Get recent runs for a specific job (most recent first).
   */
  static async getByJobId(
    job_id: string,
    job_type: string,
    company_id: number,
    limit = 20
  ): Promise<JobRun[]> {
    const db = await getAdapter();
    const result = await db.query<JobRunRow>(
      `SELECT * FROM job_runs
       WHERE job_id = $1 AND job_type = $2 AND company_id = $3
       ORDER BY created_at DESC
       LIMIT $4`,
      [job_id, job_type, company_id, limit]
    );
    return result.rows.map(rowToJobRun);
  }
}
