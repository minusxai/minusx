/**
 * Job Runs Slice
 * Generic Redux state for job_runs table records.
 * Keyed by jobId (numeric file ID). Covers all job types (alert, report, etc.).
 */
import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { JobRun } from '@/lib/types';

interface JobRunsState {
  runsByJob: Record<number, JobRun[]>;
  selectedByJob: Record<number, number | null>;
  isRunningByJob: Record<number, boolean>;
}

const initialState: JobRunsState = {
  runsByJob: {},
  selectedByJob: {},
  isRunningByJob: {},
};

const jobRunsSlice = createSlice({
  name: 'jobRuns',
  initialState,
  reducers: {
    setRuns(state, action: PayloadAction<{ jobId: number; runs: JobRun[] }>) {
      const { jobId, runs } = action.payload;
      state.runsByJob[jobId] = runs;
    },
    setSelectedRun(state, action: PayloadAction<{ jobId: number; runId: number | null }>) {
      const { jobId, runId } = action.payload;
      state.selectedByJob[jobId] = runId;
    },
    setIsRunning(state, action: PayloadAction<{ jobId: number; isRunning: boolean }>) {
      const { jobId, isRunning } = action.payload;
      state.isRunningByJob[jobId] = isRunning;
    },
    clearJob(state, action: PayloadAction<number>) {
      const jobId = action.payload;
      delete state.runsByJob[jobId];
      delete state.selectedByJob[jobId];
      delete state.isRunningByJob[jobId];
    },
  },
});

export const { setRuns, setSelectedRun, setIsRunning, clearJob } = jobRunsSlice.actions;

// ── Selectors ──────────────────────────────────────────────────────────────────

type SliceState = { jobRuns: JobRunsState };

export const selectJobRuns = (state: SliceState, jobId: number): JobRun[] =>
  state.jobRuns.runsByJob[jobId] ?? [];

export const selectSelectedJobRunId = (state: SliceState, jobId: number): number | null =>
  state.jobRuns.selectedByJob[jobId] ?? null;

export const selectSelectedJobRun = (state: SliceState, jobId: number): JobRun | null => {
  const runs = state.jobRuns.runsByJob[jobId] ?? [];
  const selectedId = state.jobRuns.selectedByJob[jobId];
  if (selectedId == null) return null;
  return runs.find(r => r.id === selectedId) ?? null;
};

export const selectIsJobRunning = (state: SliceState, jobId: number): boolean =>
  state.jobRuns.isRunningByJob[jobId] ?? false;

export default jobRunsSlice.reducer;
