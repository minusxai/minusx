import { createSlice, createSelector, PayloadAction } from '@reduxjs/toolkit';
import { IS_DEV } from '@/lib/constants';
import type { RootState } from './store';

interface UIState {
  leftSidebarCollapsed: boolean;
  rightSidebarCollapsed: boolean;
  rightSidebarWidth: number;
  colorMode: 'light' | 'dark';
  devMode: boolean;
  sidebarPendingMessage: string | null;
  activeSidebarSection: string | null;
  askForConfirmation: boolean;
  showDebug: boolean;
  showJson: boolean;
  gettingStartedCollapsed: boolean;
  dashboardEditMode: Record<number, boolean>;  // fileId -> editMode
  sidebarDrafts: Record<number, string>;  // fileId -> draft input text
  proposedQueries: Record<number, string>;  // fileId -> proposed SQL query (for diff view)
  selectedToolset: 'classic' | 'native';
}

const initialState: UIState = {
  leftSidebarCollapsed: false,
  rightSidebarCollapsed: true,
  rightSidebarWidth: 320,
  colorMode: 'dark',
  devMode: IS_DEV,
  sidebarPendingMessage: null,
  activeSidebarSection: null,
  askForConfirmation: false,
  showDebug: false,
  showJson: false,
  gettingStartedCollapsed: false,
  dashboardEditMode: {},
  sidebarDrafts: {},
  proposedQueries: {},
  selectedToolset: 'classic',
};

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setLeftSidebarCollapsed: (state, action: PayloadAction<boolean>) => {
      state.leftSidebarCollapsed = action.payload;
    },
    toggleLeftSidebar: (state) => {
      state.leftSidebarCollapsed = !state.leftSidebarCollapsed;
    },
    setRightSidebarCollapsed: (state, action: PayloadAction<boolean>) => {
      if (!action.payload) {
        state.leftSidebarCollapsed = true;
      }
        state.rightSidebarCollapsed = action.payload;
    },
    toggleRightSidebar: (state) => {
      state.rightSidebarCollapsed = !state.rightSidebarCollapsed;
    },
    setRightSidebarWidth: (state, action: PayloadAction<number>) => {
      state.rightSidebarWidth = action.payload;
    },
    setColorMode: (state, action: PayloadAction<'light' | 'dark'>) => {
      state.colorMode = action.payload;
    },
    toggleColorMode: (state) => {
      state.colorMode = state.colorMode === 'dark' ? 'light' : 'dark';
    },
    setDevMode: (state, action: PayloadAction<boolean>) => {
      state.devMode = action.payload;
    },
    toggleDevMode: (state) => {
      state.devMode = !state.devMode;
    },
    setSidebarPendingMessage: (state, action: PayloadAction<string | null>) => {
      state.sidebarPendingMessage = action.payload;
    },
    setActiveSidebarSection: (state, action: PayloadAction<string | null>) => {
      state.activeSidebarSection = action.payload;
    },
    setAskForConfirmation: (state, action: PayloadAction<boolean>) => {
      state.askForConfirmation = action.payload;
    },
    setShowDebug: (state, action: PayloadAction<boolean>) => {
      state.showDebug = action.payload;
    },
    setShowJson: (state, action: PayloadAction<boolean>) => {
      state.showJson = action.payload;
    },
    setGettingStartedCollapsed: (state, action: PayloadAction<boolean>) => {
      state.gettingStartedCollapsed = action.payload;
    },
    toggleGettingStartedCollapsed: (state) => {
      state.gettingStartedCollapsed = !state.gettingStartedCollapsed;
    },
    setDashboardEditMode: (state, action: PayloadAction<{ fileId: number; editMode: boolean }>) => {
      const { fileId, editMode } = action.payload;
      state.dashboardEditMode[fileId] = editMode;
    },
    clearDashboardEditMode: (state, action: PayloadAction<number>) => {
      delete state.dashboardEditMode[action.payload];
    },
    setSidebarDraft: (state, action: PayloadAction<{ fileId: number; draft: string }>) => {
      const { fileId, draft } = action.payload;
      if (draft.trim() === '') {
        delete state.sidebarDrafts[fileId];
      } else {
        state.sidebarDrafts[fileId] = draft;
      }
    },
    clearSidebarDraft: (state, action: PayloadAction<number>) => {
      delete state.sidebarDrafts[action.payload];
    },
    setProposedQuery: (state, action: PayloadAction<{ fileId: number; query: string }>) => {
      const { fileId, query } = action.payload;
      state.proposedQueries[fileId] = query;
    },
    clearProposedQuery: (state, action: PayloadAction<number>) => {
      delete state.proposedQueries[action.payload];
    },
    setSelectedToolset: (state, action: PayloadAction<'classic' | 'native'>) => {
      state.selectedToolset = action.payload;
    },
  },
});

export const {
  setLeftSidebarCollapsed,
  toggleLeftSidebar,
  setRightSidebarCollapsed,
  toggleRightSidebar,
  setRightSidebarWidth,
  setColorMode,
  toggleColorMode,
  setDevMode,
  toggleDevMode,
  setSidebarPendingMessage,
  setActiveSidebarSection,
  setAskForConfirmation,
  setShowDebug,
  setShowJson,
  setGettingStartedCollapsed,
  toggleGettingStartedCollapsed,
  setDashboardEditMode,
  clearDashboardEditMode,
  setSidebarDraft,
  clearSidebarDraft,
  setProposedQuery,
  clearProposedQuery,
  setSelectedToolset,
} = uiSlice.actions;

export default uiSlice.reducer;

// Selectors
export const selectRightSidebarUIState = createSelector(
  [
    (state: RootState) => state.ui.rightSidebarCollapsed,
    (state: RootState) => state.ui.rightSidebarWidth,
    (state: RootState) => state.ui.devMode,
    (state: RootState) => state.ui.colorMode,
    (state: RootState) => state.ui.activeSidebarSection,
  ],
  (isCollapsed, width, devMode, colorMode, activeSidebarSection) => ({
    isCollapsed,
    width,
    devMode,
    colorMode,
    activeSidebarSection,
  })
);

export const selectAskForConfirmation = (state: RootState) => state.ui.askForConfirmation;
export const selectShowDebug = (state: RootState) => state.ui.showDebug;
export const selectShowJson = (state: RootState) => state.ui.showJson;
export const selectGettingStartedCollapsed = (state: RootState) => state.ui.gettingStartedCollapsed;
export const selectDashboardEditMode = (state: RootState, fileId: number) => state.ui.dashboardEditMode[fileId] ?? false;
export const selectSidebarDraft = (state: RootState, fileId: number | undefined) =>
  fileId ? state.ui.sidebarDrafts[fileId] ?? '' : '';
export const selectProposedQuery = (state: RootState, fileId: number | undefined) =>
  fileId ? state.ui.proposedQueries[fileId] : undefined;
export const selectSelectedToolset = (state: RootState) => state.ui.selectedToolset;
