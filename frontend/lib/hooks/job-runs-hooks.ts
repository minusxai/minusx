/**
 * Job Runs Hooks — React hooks for job run state
 *
 * Thin wrappers around job-runs-state.ts, analogous to file-state-hooks.ts.
 * All network calls and Redux interactions are delegated to job-runs-state.ts.
 *
 * Exports:
 *   useJobRuns(jobId, jobType) — load runs on mount, return full run interface
 */

import { useEffect, useCallback } from 'react';
import { useAppSelector } from '@/store/hooks';
import {
  selectJobRuns,
  selectSelectedJobRunId,
  selectSelectedJobRun,
  selectIsJobRunning,
} from '@/store/jobRunsSlice';
import {
  loadJobRuns,
  triggerJobRun,
  selectJobRun,
} from '@/lib/api/job-runs-state';
import type { JobRun } from '@/lib/types';

export interface UseJobRunsResult {
  runs: JobRun[];
  selectedRunId: number | null;
  selectedRun: JobRun | null;
  isRunning: boolean;
  /** Trigger a manual run. No-op if already running. */
  trigger: (options?: { force?: boolean; send?: boolean; run_mode?: 'full' | 'test_only' }) => Promise<void>;
  /** Select a run by ID (pass null to deselect). */
  selectRun: (runId: number | null) => void;
  /** Reload run history from the server. */
  reload: () => Promise<void>;
}

/**
 * Load and subscribe to job run state for a given job.
 *
 * Fetches run history once on mount (selecting the latest automatically).
 * Re-fetches when jobId or jobType changes.
 *
 * @param jobId   - Numeric file ID of the job (alert, report, etc.). Pass null/0 to disable.
 * @param jobType - Job type string (e.g. 'alert'). Must match /api/jobs/run job_type.
 */
export function useJobRuns(jobId: number | null, jobType: string): UseJobRunsResult {
  const id = jobId ?? 0;

  const runs = useAppSelector(state => selectJobRuns(state, id));
  const selectedRunId = useAppSelector(state => selectSelectedJobRunId(state, id));
  const selectedRun = useAppSelector(state => selectSelectedJobRun(state, id));
  const isRunning = useAppSelector(state => selectIsJobRunning(state, id));

  const reload = useCallback(async () => {
    if (!id) return;
    await loadJobRuns(id, jobType, { selectLatest: true });
  }, [id, jobType]);

  const trigger = useCallback(async (options?: { force?: boolean; send?: boolean; run_mode?: 'full' | 'test_only' }) => {
    if (!id || (isRunning && !options?.force)) return;
    await triggerJobRun(id, jobType, options);
  }, [id, jobType, isRunning]);

  const selectRun = useCallback((runId: number | null) => {
    if (id) selectJobRun(id, runId);
  }, [id]);

  // Load on mount and when job identity changes
  useEffect(() => {
    reload();
  }, [reload]);

  return { runs, selectedRunId, selectedRun, isRunning, trigger, selectRun, reload };
}
