import { createSlice, createSelector, PayloadAction } from '@reduxjs/toolkit';
import type { RootState } from './store';
import type { Attachment } from '@/lib/types';
import type { ChatModelSelection } from '@/lib/llm/llm-config-types';

export type ViewStackItem =
  | { type: 'question'; fileId: number; dashboardId?: number; dashboardParamValues?: Record<string, any> }
  | { type: 'create-question'; folderPath: string; dashboardId: number; fileId: number };

interface UIState {
  leftSidebarCollapsed: boolean;
  rightSidebarCollapsed: boolean;
  rightSidebarWidth: number;
  colorMode: 'light' | 'dark';
  devMode: boolean;
  sidebarPendingMessage: string | null;
  chatModelSelection: ChatModelSelection | null;
  sidebarPendingSlashCommand: string | null;
  activeSidebarSection: string | null;
  askForConfirmation: boolean;
  showAdvanced: boolean;
  /** Chart renderer (docs/Visualization Arch V2.md §21): 'vega' (default) draws
   * every chart with the V2 engine; 'echarts' is the classic escape hatch — the
   * exact pre-V2 pipeline, where only V1 is possible (saved `viz` envelopes are
   * ignored and the `vizV2` format flag has no effect). */
  vizRenderer: 'echarts' | 'vega';
  /** Viz V2 format switch (docs/Visualization Arch V2.md §21) — only meaningful
   * when vizRenderer is 'vega'. Off (V1, default until the prompts/tools flip):
   * `vizSettings` is the truth — charts are just-in-time converted for rendering,
   * saved `viz` envelopes are ignored, and editing stays on the classic panel
   * (nothing ever writes an envelope). On (V2): a saved envelope is the truth —
   * renders directly and edits in the V2 panel; vizSettings-only files render
   * via JIT conversion and their first V2-panel edit upgrades the file on Save. */
  vizV2: boolean;
  fileEditMode: Record<number, boolean>;       // fileId -> editMode (dashboard, story, question, report, alert)
  fileViewMode: Record<number, 'visual' | 'json'>;  // fileId -> active tab
  notebookActiveCell: Record<number, string>;   // notebook fileId -> active cell id (for agent context + highlight)
  questionCollapsedPanel: 'none' | 'left' | 'right';  // global: which panel is collapsed across all questions
  proposedQueries: Record<number, string>;  // fileId -> proposed SQL query (for diff view)
  viewStack: ViewStackItem[];
  chatAttachments: Attachment[];
  pendingUploads: { id: string; name: string }[];  // in-flight image/file uploads — block send until empty
  lightboxImageUrl: string | null;  // global image lightbox — open when non-null
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
    showRecentStories: boolean;
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
  chatModelSelection: null,
  sidebarPendingSlashCommand: null,
  activeSidebarSection: null,
  askForConfirmation: false,
  showAdvanced: false,
  vizRenderer: 'vega',
  vizV2: false, // V1 (vizSettings) stays authoritative until the prompts/tools PR flips the default
  fileEditMode: {},
  fileViewMode: {},
  notebookActiveCell: {},
  questionCollapsedPanel: 'none',
  proposedQueries: {},
  viewStack: [],
  chatAttachments: [],
  pendingUploads: [],
  lightboxImageUrl: null,
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
    showRecentStories: true,
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
    setSidebarPendingMessage: (state, action: PayloadAction<string | null>) => {
      state.sidebarPendingMessage = action.payload;
    },
    setChatModelSelection: (state, action: PayloadAction<ChatModelSelection | null>) => {
      state.chatModelSelection = action.payload;
    },
    setSidebarPendingSlashCommand: (state, action: PayloadAction<UIState['sidebarPendingSlashCommand']>) => {
      state.sidebarPendingSlashCommand = action.payload;
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
    setVizV2: (state, action: PayloadAction<boolean>) => {
      state.vizV2 = action.payload;
      if (typeof window !== 'undefined') {
        try { localStorage.setItem('vizV2', String(action.payload)); } catch { /* ignore */ }
      }
    },
    setVizRenderer: (state, action: PayloadAction<'echarts' | 'vega'>) => {
      state.vizRenderer = action.payload;
      if (typeof window !== 'undefined') {
        try { localStorage.setItem('vizRenderer', action.payload); } catch { /* ignore */ }
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
    setFileEditMode: (state, action: PayloadAction<{ fileId: number; editMode: boolean }>) => {
      const { fileId, editMode } = action.payload;
      state.fileEditMode[fileId] = editMode;
    },
    setFileViewMode: (state, action: PayloadAction<{ fileId: number; mode: 'visual' | 'json' }>) => {
      const { fileId, mode } = action.payload;
      state.fileViewMode[fileId] = mode;
    },
    setNotebookActiveCell: (state, action: PayloadAction<{ fileId: number; cellId: string }>) => {
      const { fileId, cellId } = action.payload;
      state.notebookActiveCell[fileId] = cellId;
    },
    setQuestionCollapsedPanel: (state, action: PayloadAction<'none' | 'left' | 'right'>) => {
      state.questionCollapsedPanel = action.payload;
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
    updateChatAttachment: (state, action: PayloadAction<{ index: number; attachment: Attachment }>) => {
      if (action.payload.index >= 0 && action.payload.index < state.chatAttachments.length) {
        state.chatAttachments[action.payload.index] = action.payload.attachment;
      }
    },
    clearChatAttachments: (state) => {
      state.chatAttachments = [];
    },
    addPendingUpload: (state, action: PayloadAction<{ id: string; name: string }>) => {
      state.pendingUploads.push(action.payload);
    },
    removePendingUpload: (state, action: PayloadAction<string>) => {
      state.pendingUploads = state.pendingUploads.filter(u => u.id !== action.payload);
    },
    openImageLightbox: (state, action: PayloadAction<string>) => {
      state.lightboxImageUrl = action.payload;
    },
    closeImageLightbox: (state) => {
      state.lightboxImageUrl = null;
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
    setBulkUiFlags: (state, action: PayloadAction<{ devMode?: boolean; askForConfirmation?: boolean; showAdvanced?: boolean; vizV2?: boolean; vizRenderer?: 'echarts' | 'vega'; allowChatQueue?: boolean; queueStrategy?: 'end-of-turn' | 'mid-turn'; showSuggestedQuestions?: boolean; showTrustScore?: boolean; unrestrictedMode?: boolean; showExpandedMessages?: boolean; homePage?: Partial<UIState['homePage']> }>) => {
      const { devMode, askForConfirmation, showAdvanced, vizV2, vizRenderer, allowChatQueue, queueStrategy, showSuggestedQuestions, showTrustScore, unrestrictedMode, showExpandedMessages, homePage } = action.payload;
      if (devMode !== undefined) state.devMode = devMode;
      if (askForConfirmation !== undefined) state.askForConfirmation = askForConfirmation;
      if (showAdvanced !== undefined) state.showAdvanced = showAdvanced;
      if (vizV2 !== undefined) state.vizV2 = vizV2;
      if (vizRenderer !== undefined) state.vizRenderer = vizRenderer;
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
  setRightSidebarWidth,
  setColorMode,
  toggleColorMode,
  setDevMode,
  setSidebarPendingMessage,
  setChatModelSelection,
  setSidebarPendingSlashCommand,
  setActiveSidebarSection,
  setAskForConfirmation,
  setShowAdvanced,
  setVizV2,
  setVizRenderer,
  setFileEditMode,
  setFileViewMode,
  setNotebookActiveCell,
  setQuestionCollapsedPanel,
  addChatAttachment,
  removeChatAttachment,
  updateChatAttachment,
  clearChatAttachments,
  addPendingUpload,
  removePendingUpload,
  openImageLightbox,
  closeImageLightbox,
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

export const selectDevMode = (state: RootState) => state.ui.devMode;
export const selectShowAdvanced = (state: RootState) => state.ui.showAdvanced;
export const selectVizV2 = (state: RootState) => state.ui.vizV2;
export const selectVizRenderer = (state: RootState) => state.ui.vizRenderer;
/** True only when the vega renderer is active AND the V2 format is authoritative —
 * the single predicate render/edit surfaces should gate V2-envelope behavior on. */
export const selectVizV2Active = (state: RootState) => state.ui.vizRenderer === 'vega' && state.ui.vizV2;
export const selectAllowChatQueue = (state: RootState) => state.ui.allowChatQueue ?? true;
export const selectQueueStrategy = (state: RootState) => state.ui.queueStrategy ?? 'end-of-turn';
export const selectFileEditMode = (state: RootState, fileId: number) => state.ui.fileEditMode[fileId] ?? false;
export const selectFileViewMode = (state: RootState, fileId: number | undefined) =>
  fileId !== undefined ? (state.ui.fileViewMode[fileId] ?? 'visual') : 'visual';
export const selectNotebookActiveCell = (
  state: { ui: UIState },
  fileId: number | undefined,
): string | undefined => fileId !== undefined ? state.ui.notebookActiveCell[fileId] : undefined;

export const selectQuestionCollapsedPanel = (state: RootState) => state.ui.questionCollapsedPanel;
export const selectProposedQuery = (state: RootState, fileId: number | undefined) =>
  fileId ? state.ui.proposedQueries[fileId] : undefined;
export const selectChatAttachments = (state: RootState) => state.ui.chatAttachments;
export const selectPendingUploads = (state: RootState) => state.ui.pendingUploads;
export const selectLightboxImageUrl = (state: RootState) => state.ui.lightboxImageUrl;
export const selectViewStack = (state: RootState) => state.ui.viewStack;
export const selectViewStackDepth = (state: RootState) => state.ui.viewStack.length;
export const selectShowSuggestedQuestions = (state: RootState) => state.ui.showSuggestedQuestions;
export const selectShowTrustScore = (state: RootState) => state.ui.showTrustScore;
export const selectUnrestrictedMode = (state: RootState) => state.ui.unrestrictedMode;
export const selectShowExpandedMessages = (state: RootState) => state.ui.showExpandedMessages ?? false;
export const selectHomePage = (state: RootState) => state.ui.homePage;
