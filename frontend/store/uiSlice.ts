import { createSlice, createSelector, PayloadAction } from '@reduxjs/toolkit';
import { IS_DEV } from '@/lib/constants';
import type { RootState } from './store';
import type { Attachment } from '@/lib/types';

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
  dashboardEditMode: Record<number, boolean>;  // fileId -> editMode (dashboards)
  fileEditMode: Record<number, boolean>;       // fileId -> editMode (question, report, alert)
  fileViewMode: Record<number, 'visual' | 'json'>;  // fileId -> active tab
  sqlEditorCollapsed: Record<number, boolean>;  // fileId -> collapsed state
  questionCollapsedPanel: 'none' | 'left' | 'right';  // global: which panel is collapsed across all questions
  sidebarDrafts: Record<number, string>;  // fileId -> draft input text
  proposedQueries: Record<number, string>;  // fileId -> proposed SQL query (for diff view)
  modalFile: { fileId: number; state: 'ACTIVE' | 'COLLAPSED' } | null;
  chatAttachments: Attachment[];
}

const initialState: UIState = {
  leftSidebarCollapsed: false,
  rightSidebarCollapsed: true,
  rightSidebarWidth: 400,
  colorMode: 'dark',
  devMode: IS_DEV,
  sidebarPendingMessage: null,
  activeSidebarSection: null,
  askForConfirmation: false,
  showDebug: false,
  showJson: false,
  gettingStartedCollapsed: false,
  dashboardEditMode: {},
  fileEditMode: {},
  fileViewMode: {},
  sqlEditorCollapsed: {},
  questionCollapsedPanel: 'none',
  sidebarDrafts: {},
  proposedQueries: {},
  modalFile: null,
  chatAttachments: [],
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
      if (typeof window !== 'undefined') {
        try { localStorage.setItem('showDebug', String(action.payload)); } catch { /* ignore */ }
      }
    },
    setShowJson: (state, action: PayloadAction<boolean>) => {
      state.showJson = action.payload;
      if (typeof window !== 'undefined') {
        try { localStorage.setItem('showJson', String(action.payload)); } catch { /* ignore */ }
      }
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
    setFileEditMode: (state, action: PayloadAction<{ fileId: number; editMode: boolean }>) => {
      const { fileId, editMode } = action.payload;
      state.fileEditMode[fileId] = editMode;
    },
    clearFileEditMode: (state, action: PayloadAction<number>) => {
      delete state.fileEditMode[action.payload];
    },
    setFileViewMode: (state, action: PayloadAction<{ fileId: number; mode: 'visual' | 'json' }>) => {
      const { fileId, mode } = action.payload;
      state.fileViewMode[fileId] = mode;
    },
    setSqlEditorCollapsed: (state, action: PayloadAction<{ fileId: number; collapsed: boolean }>) => {
      const { fileId, collapsed } = action.payload;
      state.sqlEditorCollapsed[fileId] = collapsed;
    },
    setQuestionCollapsedPanel: (state, action: PayloadAction<'none' | 'left' | 'right'>) => {
      state.questionCollapsedPanel = action.payload;
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
    openFileModal: (state, action: PayloadAction<number>) => {
      state.modalFile = { fileId: action.payload, state: 'ACTIVE' };
    },
    closeFileModal: (state) => {
      state.modalFile = null;
    },
    collapseFileModal: (state) => {
      if (state.modalFile) state.modalFile.state = 'COLLAPSED';
    },
    expandFileModal: (state) => {
      if (state.modalFile) state.modalFile.state = 'ACTIVE';
    },
    addChatAttachment: (state, action: PayloadAction<Attachment>) => {
      state.chatAttachments.push(action.payload);
    },
    removeChatAttachment: (state, action: PayloadAction<number>) => {
      state.chatAttachments.splice(action.payload, 1);
    },
    clearChatAttachments: (state) => {
      state.chatAttachments = [];
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
  setFileEditMode,
  clearFileEditMode,
  setFileViewMode,
  setSqlEditorCollapsed,
  setQuestionCollapsedPanel,
  setSidebarDraft,
  clearSidebarDraft,
  setProposedQuery,
  clearProposedQuery,
  openFileModal,
  closeFileModal,
  collapseFileModal,
  expandFileModal,
  addChatAttachment,
  removeChatAttachment,
  clearChatAttachments,
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
export const selectFileEditMode = (state: RootState, fileId: number) => state.ui.fileEditMode[fileId] ?? false;
export const selectFileViewMode = (state: RootState, fileId: number | undefined) =>
  fileId !== undefined ? (state.ui.fileViewMode[fileId] ?? 'visual') : 'visual';
// Returns collapsed state for a question's SQL editor.
// Falls back to mode-appropriate default when not yet stored (open in page mode, closed in toolcall).
export const selectSqlEditorCollapsed = (
  state: RootState,
  fileId: number | undefined,
  defaultCollapsed: boolean
) => fileId !== undefined ? (state.ui.sqlEditorCollapsed[fileId] ?? defaultCollapsed) : defaultCollapsed;
export const selectQuestionCollapsedPanel = (state: RootState) => state.ui.questionCollapsedPanel;
export const selectSidebarDraft = (state: RootState, fileId: number | undefined) =>
  fileId ? state.ui.sidebarDrafts[fileId] ?? '' : '';
export const selectProposedQuery = (state: RootState, fileId: number | undefined) =>
  fileId ? state.ui.proposedQueries[fileId] : undefined;
export const selectModalFile = (state: RootState) => state.ui.modalFile;
export const selectChatAttachments = (state: RootState) => state.ui.chatAttachments;
