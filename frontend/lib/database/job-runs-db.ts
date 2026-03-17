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

/**
 * SQLite stores CURRENT_TIMESTAMP as 'YYYY-MM-DD HH:MM:SS' (UTC, no timezone marker).
 * JavaScript's Date constructor treats this as *local* time, which is wrong.
 * Normalize to ISO 8601 with explicit 'Z' so Date.parse always treats it as UTC.
 * Postgres timestamps already include timezone info and pass through unchanged.
 */
function normalizeTimestamp(ts: string): string {
  // Match exact SQLite format: 'YYYY-MM-DD HH:MM:SS' (no T, no timezone)
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(ts)) {
    return ts.replace(' ', 'T') + 'Z';
  }
  return ts;
}

function rowToJobRun(row: JobRunRow): JobRun {
  return {
    id: row.id,
    created_at: normalizeTimestamp(row.created_at),
    completed_at: row.completed_at ? normalizeTimestamp(row.completed_at) : null,
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
   * Force-create a new job run with the output file linked upfront.
   * output_file_id and output_file_type are set immediately since the run file
   * is created before execution starts. Returns the new run ID.
   */
  static async create(params: {
    job_id: string;
    job_type: string;
    company_id: number;
    output_file_id: number;
    output_file_type: string;
    timeout?: number;
    source?: JobRunSource;
  }): Promise<number> {
    const db = await getAdapter();
    const { job_id, job_type, company_id, output_file_id, output_file_type, timeout = 30, source = 'manual' } = params;

    const result = await db.query<{ id: number }>(
      `INSERT INTO job_runs (job_id, job_type, company_id, output_file_id, output_file_type, timeout, source, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'RUNNING')
       RETURNING id`,
      [job_id, job_type, company_id, output_file_id, output_file_type, timeout, source]
    );
    return result.rows[0].id;
  }

  /**
   * Atomic find-or-create within a time window (cron dedup).
   *
   * Mirrors the Python find_or_create_job_run CTE logic:
   *   - Active RUNNING (within timeout) → return existing, no new run
   *   - SUCCESS in window             → return existing, no new run
   *   - RUNNING but timed out         → mark old run TIMEOUT, create new run
   *   - FAILURE or TIMEOUT in window  → create new run (retry)
   *   - Nothing in window             → create new run
   *
   * timeout is in MINUTES (matching Python reference).
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

    const toWindowBound = (d: Date): string =>
      getDbType() === 'sqlite'
        ? d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '')
        : d.toISOString();

    // Per-row timeout cutoff: each row uses its own timeout column (in minutes)
    const timedOutExpr = getDbType() === 'sqlite'
      ? `created_at <= datetime('now', '-' || timeout || ' minutes')`
      : `created_at <= CURRENT_TIMESTAMP - INTERVAL '1 minute' * timeout`;

    return db.transaction(async (tx) => {
      // Find most recent run in window, compute whether it has timed out
      const existing = await tx.query<JobRunRow & { is_timed_out: number }>(
        `SELECT *, CASE WHEN status = 'RUNNING' AND ${timedOutExpr} THEN 1 ELSE 0 END AS is_timed_out
         FROM job_runs
         WHERE job_id = $1 AND job_type = $2 AND company_id = $3
           AND created_at >= $4 AND created_at <= $5
         ORDER BY created_at DESC
         LIMIT 1`,
        [job_id, job_type, company_id, toWindowBound(window_start), toWindowBound(window_end)]
      );

      if (existing.rows.length > 0) {
        const run = existing.rows[0];
        const isTimedOut = Number(run.is_timed_out) === 1;

        // Active RUNNING → dedup, no new run
        if (run.status === 'RUNNING' && !isTimedOut) {
          return { runId: run.id, action: 'found_running', isNewRun: false };
        }

        // SUCCESS → don't retry
        if (run.status === 'SUCCESS') {
          return { runId: run.id, action: 'found_completed', isNewRun: false };
        }

        // Timed-out RUNNING → mark as TIMEOUT then fall through to create
        if (isTimedOut) {
          await tx.query(
            `UPDATE job_runs SET status = 'TIMEOUT', completed_at = CURRENT_TIMESTAMP,
                 error = 'Job timed out - marked on next cron attempt'
             WHERE id = $1`,
            [run.id]
          );
        }
        // FAILURE, TIMEOUT (prior), or timed-out RUNNING → fall through to create new run
      }

      const inserted = await tx.query<{ id: number }>(
        `INSERT INTO job_runs (job_id, job_type, company_id, timeout, source, status)
         VALUES ($1, $2, $3, $4, $5, 'RUNNING')
         RETURNING id`,
        [job_id, job_type, company_id, timeout, source]
      );
      return { runId: inserted.rows[0].id, action: 'created', isNewRun: true };
    });
  }

  /**
   * Mark a job run as complete. output_file_id is already set from create(),
   * so only status and error need to be updated.
   */
  static async complete(
    runId: number,
    status: 'SUCCESS' | 'FAILURE' | 'TIMEOUT',
    error?: string
  ): Promise<void> {
    const db = await getAdapter();
    await db.query(
      `UPDATE job_runs
       SET status = $1, completed_at = CURRENT_TIMESTAMP, error = $2
       WHERE id = $3`,
      [status, error ?? null, runId]
    );
  }

  /**
   * Link a run file to an existing job_run (used by cron after pre-creating the file).
   */
  static async setOutputFile(
    runId: number,
    output_file_id: number,
    output_file_type: string
  ): Promise<void> {
    const db = await getAdapter();
    await db.query(
      `UPDATE job_runs SET output_file_id = $1, output_file_type = $2 WHERE id = $3`,
      [output_file_id, output_file_type, runId]
    );
  }

  /**
   * Find an in-progress run for a given job (used for manual dedup).
   * Atomically marks any stale RUNNING runs (past their timeout) as TIMEOUT,
   * then returns the active run if one exists within its timeout window.
   * timeout is in MINUTES (matching Python reference).
   */
  static async getRunningByJobId(
    job_id: string,
    job_type: string,
    company_id: number
  ): Promise<JobRun | null> {
    const db = await getAdapter();

    // Per-row timeout cutoff: each row uses its own timeout column (in minutes)
    const timedOutExpr = getDbType() === 'sqlite'
      ? `created_at <= datetime('now', '-' || timeout || ' minutes')`
      : `created_at <= CURRENT_TIMESTAMP - INTERVAL '1 minute' * timeout`;

    return db.transaction(async (tx) => {
      // Mark all stale RUNNING runs as TIMEOUT
      await tx.query(
        `UPDATE job_runs SET status = 'TIMEOUT', completed_at = CURRENT_TIMESTAMP,
             error = 'Job timed out - marked on next manual trigger attempt'
         WHERE job_id = $1 AND job_type = $2 AND company_id = $3
           AND status = 'RUNNING' AND ${timedOutExpr}`,
        [job_id, job_type, company_id]
      );

      // Now find an active (non-timed-out) RUNNING run
      const result = await tx.query<JobRunRow>(
        `SELECT * FROM job_runs
         WHERE job_id = $1 AND job_type = $2 AND company_id = $3
           AND status = 'RUNNING'
         ORDER BY created_at DESC
         LIMIT 1`,
        [job_id, job_type, company_id]
      );
      if (result.rows.length === 0) return null;
      return rowToJobRun(result.rows[0]);
    });
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
