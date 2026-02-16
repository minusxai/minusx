/**
 * Alert Runs Slice
 * Manages alert run state (runs list and selected run) per alert
 */
import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { AlertRunContent } from '@/lib/types';

interface AlertRun {
  id: number;
  name: string;
  content: AlertRunContent;
}

interface AlertRunsState {
  // Map of alertId -> runs array
  runsByAlert: Record<number, AlertRun[]>;
  // Map of alertId -> selected run ID
  selectedRunByAlert: Record<number, number | null>;
}

const initialState: AlertRunsState = {
  runsByAlert: {},
  selectedRunByAlert: {},
};

const alertRunsSlice = createSlice({
  name: 'alertRuns',
  initialState,
  reducers: {
    setRuns: (state, action: PayloadAction<{ alertId: number; runs: AlertRun[] }>) => {
      const { alertId, runs } = action.payload;
      state.runsByAlert[alertId] = runs;
    },
    setSelectedRun: (state, action: PayloadAction<{ alertId: number; runId: number | null }>) => {
      const { alertId, runId } = action.payload;
      state.selectedRunByAlert[alertId] = runId;
    },
    clearRuns: (state, action: PayloadAction<number>) => {
      const alertId = action.payload;
      delete state.runsByAlert[alertId];
      delete state.selectedRunByAlert[alertId];
    },
  },
});

export const { setRuns, setSelectedRun, clearRuns } = alertRunsSlice.actions;

// Selectors
export const selectAlertRuns = (state: { alertRuns: AlertRunsState }, alertId: number) =>
  state.alertRuns.runsByAlert[alertId] || [];

export const selectSelectedAlertRunId = (state: { alertRuns: AlertRunsState }, alertId: number) =>
  state.alertRuns.selectedRunByAlert[alertId] ?? null;

export const selectSelectedAlertRun = (state: { alertRuns: AlertRunsState }, alertId: number) => {
  const runs = state.alertRuns.runsByAlert[alertId] || [];
  const selectedId = state.alertRuns.selectedRunByAlert[alertId];
  if (selectedId === null || selectedId === undefined) return null;
  return runs.find(r => r.id === selectedId) || null;
};

export default alertRunsSlice.reducer;
