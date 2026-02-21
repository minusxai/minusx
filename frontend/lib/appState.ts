/**
 * App State Types
 *
 * Represents the current page context - either a file page or folder page.
 */

import type { FileState } from '@/store/filesSlice';

/**
 * Folder state (from useFolder / navigationSlice)
 */
export interface FolderState {
  files: FileState[];
  loading: boolean;
  error: string | null;
}

/**
 * App State - Discriminated union of page types
 */
export type AppState =
  | {
      type: 'file';
      state: FileState;
    }
  | {
      type: 'folder';
      state: FolderState;
    };
