/**
 * PublishFile - Commit changes from Redux to database
 *
 * Phase 1: Unified File System API
 *
 * Saves file and all dirty references in a single atomic transaction.
 * Clears persistableChanges on success.
 */

import {
  PublishFileInput,
  PublishFileOutput,
  PublishFileError,
  BaseFileContent
} from '@/lib/types';
import { RootState } from '@/store/store';
import { selectMergedContent, selectIsDirty, clearEdits } from '@/store/filesSlice';
import { Dispatch } from '@reduxjs/toolkit';

/**
 * PublishFile implementation
 *
 * @param input - File ID to publish
 * @param getState - Redux getState function
 * @param dispatch - Redux dispatch function
 * @returns Success with saved file IDs, or error
 */
export async function publishFile(
  input: PublishFileInput,
  getState: () => RootState,
  dispatch: Dispatch
): Promise<PublishFileOutput | PublishFileError> {
  const { fileId } = input;
  const state = getState();

  // Get file state
  const fileState = state.files.files[fileId];
  if (!fileState) {
    return {
      success: false,
      error: `File ${fileId} not found`
    };
  }

  // Check if file is dirty
  const isDirty = selectIsDirty(state, fileId);
  if (!isDirty) {
    // Nothing to save
    return {
      success: true,
      savedFileIds: []
    };
  }

  // Collect all files to save (main file + dirty references)
  const filesToSave: Array<{
    id: number;
    name: string;
    path: string;
    content: BaseFileContent;
    references: number[];
  }> = [];

  // Add main file
  const mergedContent = selectMergedContent(state, fileId);
  if (!mergedContent) {
    return {
      success: false,
      error: `File ${fileId} has no content`
    };
  }

  // Extract references from file (already cached in Redux state)
  const mainFileReferences = fileState.references || [];
  filesToSave.push({
    id: fileId,
    name: fileState.name,
    path: fileState.path,
    content: mergedContent as BaseFileContent,
    references: mainFileReferences
  });

  // Add dirty references (cascade save)
  if (fileState.references) {
    for (const refId of fileState.references) {
      const refIsDirty = selectIsDirty(state, refId);
      if (refIsDirty) {
        const refState = state.files.files[refId];
        if (refState) {
          const refMergedContent = selectMergedContent(state, refId);
          if (refMergedContent) {
            // Extract references from file (already cached in Redux state)
            const refReferences = refState.references || [];
            filesToSave.push({
              id: refId,
              name: refState.name,
              path: refState.path,
              content: refMergedContent as BaseFileContent,
              references: refReferences
            });
          }
        }
      }
    }
  }

  // Get company_id from auth
  const companyId = state.auth.user?.companyId;
  if (!companyId) {
    return {
      success: false,
      error: 'User company ID not found'
    };
  }

  try {
    // Call API to save all files atomically
    const response = await fetch('/api/files/batch-save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files: filesToSave,
        companyId
      })
    });

    if (!response.ok) {
      const error = await response.json();
      return {
        success: false,
        error: error.message || 'Failed to save files',
        failedFiles: error.failedFiles
      };
    }

    const result = await response.json();
    const savedFileIds = result.data.savedFileIds || filesToSave.map(f => f.id);

    // Clear persistableChanges for all saved files
    for (const savedId of savedFileIds) {
      dispatch(clearEdits(savedId));
    }

    return {
      success: true,
      savedFileIds
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}
