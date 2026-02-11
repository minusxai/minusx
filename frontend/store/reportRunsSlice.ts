/**
 * Report Runs Slice
 * Manages report run state (runs list and selected run) per report
 */
import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { ReportRunContent } from '@/lib/types';

interface ReportRun {
  id: number;
  name: string;
  content: ReportRunContent;
}

interface ReportRunsState {
  // Map of reportId -> runs array
  runsByReport: Record<number, ReportRun[]>;
  // Map of reportId -> selected run ID
  selectedRunByReport: Record<number, number | null>;
}

const initialState: ReportRunsState = {
  runsByReport: {},
  selectedRunByReport: {},
};

const reportRunsSlice = createSlice({
  name: 'reportRuns',
  initialState,
  reducers: {
    setRuns: (state, action: PayloadAction<{ reportId: number; runs: ReportRun[] }>) => {
      const { reportId, runs } = action.payload;
      state.runsByReport[reportId] = runs;
    },
    setSelectedRun: (state, action: PayloadAction<{ reportId: number; runId: number | null }>) => {
      const { reportId, runId } = action.payload;
      state.selectedRunByReport[reportId] = runId;
    },
    clearRuns: (state, action: PayloadAction<number>) => {
      const reportId = action.payload;
      delete state.runsByReport[reportId];
      delete state.selectedRunByReport[reportId];
    },
  },
});

export const { setRuns, setSelectedRun, clearRuns } = reportRunsSlice.actions;

// Selectors
export const selectRuns = (state: { reportRuns: ReportRunsState }, reportId: number) =>
  state.reportRuns.runsByReport[reportId] || [];

export const selectSelectedRunId = (state: { reportRuns: ReportRunsState }, reportId: number) =>
  state.reportRuns.selectedRunByReport[reportId] ?? null;

export const selectSelectedRun = (state: { reportRuns: ReportRunsState }, reportId: number) => {
  const runs = state.reportRuns.runsByReport[reportId] || [];
  const selectedId = state.reportRuns.selectedRunByReport[reportId];
  if (selectedId === null || selectedId === undefined) return null;
  return runs.find(r => r.id === selectedId) || null;
};

export default reportRunsSlice.reducer;
