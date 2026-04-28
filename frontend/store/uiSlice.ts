import { createSlice, createSelector, PayloadAction } from '@reduxjs/toolkit';
import { IS_DEV } from '@/lib/constants';
import type { RootState } from './store';
import type { Attachment } from '@/lib/types';

export type ViewStackItem =
  | { type: 'question'; fileId: number }
  | { type: 'create-question'; folderPath: string; dashboardId: number; fileId: number };

interface UIState {
  leftSidebarCollapsed: boolean;
  rightSidebarCollapsed: boolean;
  rightSidebarWidth: number;
  colorMode: 'light' | 'dark';
  devMode: boolean;
  sidebarPendingMessage: string | null;
  activeSidebarSection: string | null;
  askForConfirmation: boolean;
  showAdvanced: boolean;
  gettingStartedCollapsed: boolean;
  dashboardEditMode: Record<number, boolean>;  // fileId -> editMode (dashboards)
  fileEditMode: Record<number, boolean>;       // fileId -> editMode (question, report, alert)
  fileViewMode: Record<number, 'visual' | 'json'>;  // fileId -> active tab
  sqlEditorCollapsed: Record<number, boolean>;  // fileId -> collapsed state
  questionCollapsedPanel: 'none' | 'left' | 'right';  // global: which panel is collapsed across all questions
  sidebarDrafts: Record<number, string>;  // fileId -> draft input text
  proposedQueries: Record<number, string>;  // fileId -> proposed SQL query (for diff view)
  modalFile: { fileId: number; state: 'ACTIVE' | 'COLLAPSED' } | null;
  viewStack: ViewStackItem[];
  chatAttachments: Attachment[];
  showSuggestedQuestions: boolean;
  showTrustScore: boolean;
  allowChatQueue: boolean;
  queueStrategy: 'end-of-turn' | 'mid-turn';
  unrestrictedMode: boolean;
  showExpandedMessages: boolean;
  homePage: {
    showFeedSummary: boolean;
    showRecentQuestions: boolean;
    showRecentDashboards: boolean;
    showRecentConversations: boolean;
    showSuggestedPrompts: boolean;
    feedSummaryPrompt: string;
    feedSummaryQuestionIds: number[];
  };
}

const initialState: UIState = {
  leftSidebarCollapsed: false,
  rightSidebarCollapsed: true,
  rightSidebarWidth: 400,
  colorMode: 'dark',
  devMode: false,
  sidebarPendingMessage: null,
  activeSidebarSection: null,
  askForConfirmation: false,
  showAdvanced: false,
  gettingStartedCollapsed: false,
  dashboardEditMode: {},
  fileEditMode: {},
  fileViewMode: {},
  sqlEditorCollapsed: {},
  questionCollapsedPanel: 'none',
  sidebarDrafts: {},
  proposedQueries: {},
  modalFile: null,
  viewStack: [],
  chatAttachments: [],
  showSuggestedQuestions: true,
  showTrustScore: true,
  allowChatQueue: true,
  queueStrategy: 'end-of-turn',
  unrestrictedMode: false,
  showExpandedMessages: false,
  homePage: {
    showFeedSummary: true,
    showRecentQuestions: true,
    showRecentDashboards: true,
    showRecentConversations: true,
    showSuggestedPrompts: true,
    feedSummaryPrompt: '',
    feedSummaryQuestionIds: [],
  },
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
      if (typeof window !== 'undefined') {
        try { localStorage.setItem('devMode', String(action.payload)); } catch { /* ignore */ }
      }
    },
    toggleDevMode: (state) => {
      state.devMode = !state.devMode;
      if (typeof window !== 'undefined') {
        try { localStorage.setItem('devMode', String(state.devMode)); } catch { /* ignore */ }
      }
    },
    setSidebarPendingMessage: (state, action: PayloadAction<string | null>) => {
      state.sidebarPendingMessage = action.payload;
    },
    setActiveSidebarSection: (state, action: PayloadAction<string | null>) => {
      state.activeSidebarSection = action.payload;
    },
    setAskForConfirmation: (state, action: PayloadAction<boolean>) => {
      state.askForConfirmation = action.payload;
      if (typeof window !== 'undefined') {
        try { localStorage.setItem('askForConfirmation', String(action.payload)); } catch { /* ignore */ }
      }
    },
    setShowAdvanced: (state, action: PayloadAction<boolean>) => {
      state.showAdvanced = action.payload;
      if (typeof window !== 'undefined') {
        try { localStorage.setItem('showAdvanced', String(action.payload)); } catch { /* ignore */ }
      }
    },
    setShowSuggestedQuestions: (state, action: PayloadAction<boolean>) => {
      state.showSuggestedQuestions = action.payload;
      if (typeof window !== 'undefined') {
        try { localStorage.setItem('showSuggestedQuestions', String(action.payload)); } catch { /* ignore */ }
      }
    },
    setShowTrustScore: (state, action: PayloadAction<boolean>) => {
      state.showTrustScore = action.payload;
      if (typeof window !== 'undefined') {
        try { localStorage.setItem('showTrustScore', String(action.payload)); } catch { /* ignore */ }
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
    pushView: (state, action: PayloadAction<ViewStackItem>) => {
      state.viewStack.push(action.payload);
    },
    popView: (state) => {
      state.viewStack.pop();
    },
    clearViewStack: (state) => {
      state.viewStack = [];
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
    setAllowChatQueue: (state, action: PayloadAction<boolean>) => {
      state.allowChatQueue = action.payload;
      if (typeof window !== 'undefined') {
        try { localStorage.setItem('allowChatQueue_v2', String(action.payload)); } catch { /* ignore */ }
      }
    },
    setQueueStrategy: (state, action: PayloadAction<'end-of-turn' | 'mid-turn'>) => {
      state.queueStrategy = action.payload;
      if (typeof window !== 'undefined') {
        try { localStorage.setItem('queueStrategy', action.payload); } catch { /* ignore */ }
      }
    },
    setUnrestrictedMode: (state, action: PayloadAction<boolean>) => {
      state.unrestrictedMode = action.payload;
      if (typeof window !== 'undefined') {
        try { localStorage.setItem('unrestrictedMode', String(action.payload)); } catch { /* ignore */ }
      }
    },
    setShowExpandedMessages: (state, action: PayloadAction<boolean>) => {
      state.showExpandedMessages = action.payload;
      if (typeof window !== 'undefined') {
        try { localStorage.setItem('showExpandedMessages', String(action.payload)); } catch { /* ignore */ }
      }
    },
    setHomePageConfig: (state, action: PayloadAction<Partial<UIState['homePage']>>) => {
      Object.assign(state.homePage, action.payload);
      if (typeof window !== 'undefined') {
        try { localStorage.setItem('homePage', JSON.stringify(state.homePage)); } catch { /* ignore */ }
      }
    },
    setBulkUiFlags: (state, action: PayloadAction<{ devMode?: boolean; askForConfirmation?: boolean; showAdvanced?: boolean; allowChatQueue?: boolean; queueStrategy?: 'end-of-turn' | 'mid-turn'; showSuggestedQuestions?: boolean; showTrustScore?: boolean; unrestrictedMode?: boolean; showExpandedMessages?: boolean; homePage?: Partial<UIState['homePage']> }>) => {
      const { devMode, askForConfirmation, showAdvanced, allowChatQueue, queueStrategy, showSuggestedQuestions, showTrustScore, unrestrictedMode, showExpandedMessages, homePage } = action.payload;
      if (devMode !== undefined) state.devMode = devMode;
      if (askForConfirmation !== undefined) state.askForConfirmation = askForConfirmation;
      if (showAdvanced !== undefined) state.showAdvanced = showAdvanced;
      if (allowChatQueue !== undefined) state.allowChatQueue = allowChatQueue;
      if (queueStrategy !== undefined) state.queueStrategy = queueStrategy;
      if (showSuggestedQuestions !== undefined) state.showSuggestedQuestions = showSuggestedQuestions;
      if (showTrustScore !== undefined) state.showTrustScore = showTrustScore;
      if (unrestrictedMode !== undefined) state.unrestrictedMode = unrestrictedMode;
      if (showExpandedMessages !== undefined) state.showExpandedMessages = showExpandedMessages;
      if (homePage !== undefined) Object.assign(state.homePage, homePage);
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
  setShowAdvanced,
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
  setAllowChatQueue,
  setQueueStrategy,
  setUnrestrictedMode,
  setShowExpandedMessages,
  setHomePageConfig,
  setBulkUiFlags,
  pushView,
  popView,
  clearViewStack,
  setShowSuggestedQuestions,
  setShowTrustScore,
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
export const selectDevMode = (state: RootState) => state.ui.devMode;
export const selectShowAdvanced = (state: RootState) => state.ui.showAdvanced;
export const selectAllowChatQueue = (state: RootState) => state.ui.allowChatQueue ?? true;
export const selectQueueStrategy = (state: RootState) => state.ui.queueStrategy ?? 'end-of-turn';
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
export const selectViewStack = (state: RootState) => state.ui.viewStack;
export const selectTopView = (state: RootState): ViewStackItem | undefined =>
  state.ui.viewStack[state.ui.viewStack.length - 1];
export const selectViewStackDepth = (state: RootState) => state.ui.viewStack.length;
export const selectShowSuggestedQuestions = (state: RootState) => state.ui.showSuggestedQuestions;
export const selectShowTrustScore = (state: RootState) => state.ui.showTrustScore;
export const selectUnrestrictedMode = (state: RootState) => state.ui.unrestrictedMode;
export const selectShowExpandedMessages = (state: RootState) => state.ui.showExpandedMessages ?? false;
export const selectHomePage = (state: RootState) => state.ui.homePage;
