/**
 * JobRunsDB - CRUD operations for the job_runs table.
 * Tracks lifecycle, deduplication, and status of scheduled/manual job executions.
 * All queries route through the module registry (getModules().db).
 *
 * findOrCreate() and getRunningByJobId() use atomic CTEs (same pattern as documents-db.ts)
 * to avoid the need for explicit transaction wrappers.
 */
import { JobRun, JobRunStatus, JobRunSource } from '../types';
import { getModules } from '@/lib/modules/registry';

interface JobRunRow {
  id: number;
  created_at: string;
  completed_at: string | null;
  job_id: string;
  job_type: string;
  output_file_id: number | null;
  output_file_type: string | null;
  status: string;
  error: string | null;
  timeout: number;
  source: string;
}

function normalizeTimestamp(ts: string): string {
  return ts;
}

function rowToJobRun(row: JobRunRow): JobRun {
  return {
    id: row.id,
    created_at: normalizeTimestamp(row.created_at),
    completed_at: row.completed_at ? normalizeTimestamp(row.completed_at) : null,
    job_id: row.job_id,
    job_type: row.job_type,
    output_file_id: row.output_file_id,
    output_file_type: row.output_file_type,
    status: row.status as JobRunStatus,
    error: row.error,
    timeout: row.timeout,
    source: row.source as JobRunSource,
  };
}

const POSTGRES_DDL = `
  CREATE TABLE IF NOT EXISTS job_runs (
    id               SERIAL PRIMARY KEY,
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at     TIMESTAMP NULL,
    job_id           TEXT NOT NULL,
    job_type         TEXT NOT NULL,
    output_file_id   INTEGER NULL,
    output_file_type TEXT NULL,
    status           TEXT NOT NULL DEFAULT 'RUNNING',
    error            TEXT NULL,
    timeout          INTEGER NOT NULL DEFAULT 30,
    source           TEXT NOT NULL DEFAULT 'manual'
  );
  CREATE INDEX IF NOT EXISTS idx_job_runs_job ON job_runs(job_id, job_type);
  CREATE INDEX IF NOT EXISTS idx_job_runs_created_at ON job_runs(created_at DESC);
`;

export class JobRunsDB {
  static async ensureTable(): Promise<void> {
    await getModules().db.exec(POSTGRES_DDL);
  }

  static async create(params: {
    job_id: string;
    job_type: string;
    output_file_id: number;
    output_file_type: string;
    timeout?: number;
    source?: JobRunSource;
  }): Promise<number> {
    const { job_id, job_type, output_file_id, output_file_type, timeout = 30, source = 'manual' } = params;
    const result = await getModules().db.exec<{ id: number }>(
      `INSERT INTO job_runs (job_id, job_type, output_file_id, output_file_type, timeout, source, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'RUNNING')
       RETURNING id`,
      [job_id, job_type, output_file_id, output_file_type, timeout, source]
    );
    return result.rows[0].id;
  }

  /**
   * Atomic find-or-create within a time window (cron dedup).
   * Single CTE: reads existing run, marks timed-out RUNNING as TIMEOUT,
   * then conditionally inserts a new run — all in one round-trip.
   */
  static async findOrCreate(params: {
    job_id: string;
    job_type: string;
    window_start: Date;
    window_end: Date;
    timeout?: number;
    source?: JobRunSource;
  }): Promise<{ runId: number; action: string; isNewRun: boolean }> {
    const { job_id, job_type, window_start, window_end, timeout = 30, source = 'cron' } = params;

    // Use window duration in seconds so the comparison uses CURRENT_TIMESTAMP exclusively —
    // avoids JavaScript UTC vs DB clock skew (e.g. PGLite WASM timezone offset).
    const windowSeconds = Math.ceil((window_end.getTime() - window_start.getTime()) / 1000);

    const timedOutExpr = `created_at <= CURRENT_TIMESTAMP - INTERVAL '1 minute' * timeout`;

    // Single atomic CTE:
    // 1. existing: find most recent run in window + compute is_timed_out
    // 2. timeout_update: mark timed-out RUNNING runs as TIMEOUT
    // 3. new_run: insert only when no active/successful run exists
    // 4. outcome: union the three possible results into one row
    const sql = `
      WITH
      existing AS (
        SELECT *,
          CASE WHEN status = 'RUNNING' AND ${timedOutExpr} THEN 1 ELSE 0 END AS is_timed_out
        FROM job_runs
        WHERE job_id = $1 AND job_type = $2
          AND created_at >= CURRENT_TIMESTAMP - ($3 * INTERVAL '1 second')
          AND created_at <= CURRENT_TIMESTAMP
        ORDER BY created_at DESC
        LIMIT 1
      ),
      timeout_update AS (
        UPDATE job_runs
        SET status = 'TIMEOUT', completed_at = CURRENT_TIMESTAMP,
            error = 'Job timed out - marked on next cron attempt'
        WHERE id IN (SELECT id FROM existing WHERE is_timed_out = 1)
        RETURNING id
      ),
      new_run AS (
        INSERT INTO job_runs (job_id, job_type, timeout, source, status)
        SELECT $1, $2, $4, $5, 'RUNNING'
        WHERE NOT EXISTS (
          SELECT 1 FROM existing
          WHERE (status = 'RUNNING' AND is_timed_out = 0) OR status = 'SUCCESS'
        )
        RETURNING id
      ),
      outcome AS (
        SELECT id, 'found_running'   AS action, FALSE AS is_new_run FROM existing WHERE status = 'RUNNING' AND is_timed_out = 0
        UNION ALL
        SELECT id, 'found_completed' AS action, FALSE AS is_new_run FROM existing WHERE status = 'SUCCESS'
        UNION ALL
        SELECT id, 'created'         AS action, TRUE  AS is_new_run FROM new_run
      )
      SELECT * FROM outcome
    `;

    const result = await getModules().db.exec<{ id: number; action: string; is_new_run: boolean | number }>(
      sql,
      [job_id, job_type, windowSeconds, timeout, source]
    );

    const row = result.rows[0];
    return {
      runId: row.id,
      action: row.action,
      isNewRun: Boolean(row.is_new_run),
    };
  }

  static async complete(runId: number, status: 'SUCCESS' | 'FAILURE' | 'TIMEOUT', error?: string): Promise<void> {
    await getModules().db.exec(
      `UPDATE job_runs SET status = $1, completed_at = CURRENT_TIMESTAMP, error = $2 WHERE id = $3`,
      [status, error ?? null, runId]
    );
  }

  static async setOutputFile(runId: number, output_file_id: number, output_file_type: string): Promise<void> {
    await getModules().db.exec(
      `UPDATE job_runs SET output_file_id = $1, output_file_type = $2 WHERE id = $3`,
      [output_file_id, output_file_type, runId]
    );
  }

  /**
   * Atomically marks stale RUNNING runs as TIMEOUT, then returns the active run if one exists.
   * Single CTE: timeout_update excludes IDs just marked from the final SELECT via NOT IN.
   */
  static async getRunningByJobId(job_id: string, job_type: string): Promise<JobRun | null> {
    const timedOutExpr = `created_at <= CURRENT_TIMESTAMP - INTERVAL '1 minute' * timeout`;

    const sql = `
      WITH timeout_update AS (
        UPDATE job_runs
        SET status = 'TIMEOUT', completed_at = CURRENT_TIMESTAMP,
            error = 'Job timed out - marked on next manual trigger attempt'
        WHERE job_id = $1 AND job_type = $2
          AND status = 'RUNNING' AND ${timedOutExpr}
        RETURNING id
      )
      SELECT j.* FROM job_runs j
      WHERE j.job_id = $1 AND j.job_type = $2
        AND j.status = 'RUNNING'
        AND j.id NOT IN (SELECT id FROM timeout_update)
      ORDER BY j.created_at DESC
      LIMIT 1
    `;

    const result = await getModules().db.exec<JobRunRow>(sql, [job_id, job_type]);
    if (result.rows.length === 0) return null;
    return rowToJobRun(result.rows[0]);
  }

  static async getByJobId(job_id: string, job_type: string, limit = 20): Promise<JobRun[]> {
    const result = await getModules().db.exec<JobRunRow>(
      `SELECT * FROM job_runs WHERE job_id = $1 AND job_type = $2 ORDER BY created_at DESC LIMIT $3`,
      [job_id, job_type, limit]
    );
    return result.rows.map(rowToJobRun);
  }
}
