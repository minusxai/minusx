/**
 * App State Types
 *
 * Represents the current page context - either a file page or folder page.
 */

import type { FileState } from '@/store/filesSlice';
import type { AugmentedFile } from '@/lib/types';

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
      state: AugmentedFile;
    }
  | {
      type: 'folder';
      state: FolderState;
    }
  | {
      type: 'explore';
      state: null; // No additional state needed for explore page at this time
    };
