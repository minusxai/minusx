/**
 * App State Types
 *
 * Represents the current page context - either a file page or folder page.
 */

import type { FileState } from '@/store/filesSlice';
import type { CompressedAugmentedFile, CompressedFileState } from '@/lib/types';

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
