/**
 * App State Types
 *
 * Represents the current page context - either a file page or folder page.
 */

import type { FileState } from '@/store/filesSlice';
import type { CompressedAugmentedFile, CompressedFileState } from '@/lib/types';
import { stripAugmentedContentForLlm, omitFileStateContent } from '@/lib/api/compress-augmented';

/**
 * Folder state (from useFolder / navigationSlice)
 */
export interface FolderState {
  files: FileState[];
  loading: boolean;
  error: string | null;
}

/**
 * Ephemeral UI context included in AppState so the agent sees the current
 * modal/overlay state without needing a separate API call.
 */
export interface AppStateUI {
  openModal?: {
    type: 'question' | 'create-question';
    fileId: number;
    dashboardId?: number;
    /** Current state of the focused file — use for oldMatch values when calling EditFile */
    fileState?: CompressedFileState;
  };
}

/**
 * App State - Discriminated union of page types
 */
export type AppState =
  | {
      type: 'file';
      state: CompressedAugmentedFile;
      ui?: AppStateUI;
    }
  | {
      type: 'folder';
      state: FolderState;
      ui?: AppStateUI;
    }
  | {
      type: 'explore';
      state: null; // No additional state needed for explore page at this time
      ui?: AppStateUI;
    };

/**
 * Project AppState for the LLM: strip the JSON `content` from file states (the agent reads the
 * `markup` projection instead — `content` is duplicate context). Applied only when serializing
 * into a prompt / tool result; the in-memory AppState (and the wire request body) keep `content`
 * for client use. Covers the focused file + its references and any open-modal file state.
 */
export function appStateForLlm(appState: AppState): AppState {
  if (!appState || typeof appState !== 'object') return appState;
  const ui: AppStateUI | undefined = appState.ui?.openModal?.fileState
    ? { ...appState.ui, openModal: { ...appState.ui.openModal, fileState: omitFileStateContent(appState.ui.openModal.fileState) } }
    : appState.ui;

  if (appState.type === 'file') {
    // `state` is typed as always-present, but partial app-state payloads (e.g. headless
    // callers / tests) may omit it — guard at runtime before stripping content.
    const fileState = appState.state as CompressedAugmentedFile | undefined;
    if (!fileState) return { ...appState, ui };
    return { ...appState, state: stripAugmentedContentForLlm(fileState), ui };
  }
  return { ...appState, ui };
}
