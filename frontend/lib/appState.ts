/**
 * App State Types
 *
 * Represents the current page context - either a file page or folder page.
 * Contains the augmented state from useFile/useFolder.
 */

import { FileType, QueryResult } from '@/lib/types';
import type { FileState } from '@/store/filesSlice';

/**
 * Folder state (from useFolder)
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
      id: number;
      fileType: FileType;
      file: FileState;
      references: FileState[];      // Referenced files (e.g., questions in dashboard)
      queryResults: QueryResult[];  // Query results from augmentation
    }
  | {
      type: 'folder';
      path: string;
      folder: FolderState;
    };
