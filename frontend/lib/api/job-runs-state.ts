/**
 * Job Runs State — centralized network calls and Redux interactions
 *
 * This is the single source of truth for all job run operations on the client.
 * Analogous to file-state.ts: no React, no hooks, usable from anywhere.
 *
 * Exports:
 *   loadJobRuns(jobId, jobType)  — fetch history from /api/jobs/runs, store in Redux
 *   triggerJobRun(jobId, jobType) — POST /api/jobs/run, reload history after
 *   selectJobRun(jobId, runId)   — update selected run in Redux
 */

import { getStore } from '@/store/store';
import {
  setRuns,
  setSelectedRun,
  setIsRunning,
} from '@/store/jobRunsSlice';
import type { JobRun } from '@/lib/types';

/**
 * Fetch the run history for a job and store it in Redux.
 * Automatically selects the latest run if selectLatest is true.
 */
export async function loadJobRuns(
  jobId: number,
  jobType: string,
  { limit = 20, selectLatest = false }: { limit?: number; selectLatest?: boolean } = {}
): Promise<void> {
  if (jobId <= 0) return;

  const response = await fetch(
    `/api/jobs/runs?job_id=${jobId}&job_type=${encodeURIComponent(jobType)}&limit=${limit}`
  );
  if (!response.ok) throw new Error('Failed to load job runs');

  const result = await response.json();
  const runs: JobRun[] = result.data ?? [];

  const store = getStore();
  store.dispatch(setRuns({ jobId, runs }));

  if (selectLatest && runs.length > 0) {
    store.dispatch(setSelectedRun({ jobId, runId: runs[0].id }));
  }
}

/**
 * Trigger a manual job run (POST /api/jobs/run).
 * Sets isRunning in Redux during execution, then reloads history.
 * Throws on non-2xx responses.
 */
export async function triggerJobRun(jobId: number, jobType: string): Promise<void> {
  if (jobId <= 0) return;

  const store = getStore();
  store.dispatch(setIsRunning({ jobId, isRunning: true }));

  try {
    const response = await fetch('/api/jobs/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: String(jobId), job_type: jobType }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error?.message ?? 'Job run failed');
    }

    await loadJobRuns(jobId, jobType, { selectLatest: true });
  } finally {
    store.dispatch(setIsRunning({ jobId, isRunning: false }));
  }
}

/**
 * Select a specific run (or deselect with null) in Redux.
 */
export function selectJobRun(jobId: number, runId: number | null): void {
  getStore().dispatch(setSelectedRun({ jobId, runId }));
}
