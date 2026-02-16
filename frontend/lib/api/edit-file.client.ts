/**
 * EditFile - Range-based file editing with validation
 *
 * Phase 1: Unified File System API
 *
 * Applies line-based edits to file content, validates changes,
 * and stores in persistableChanges (does not save to database).
 */

import {
  EditFileInput,
  EditFileOutput,
  EditFileError,
  FileState,
  QuestionContent,
  QueryResult
} from '@/lib/types';
import { RootState } from '@/store/store';
import { selectMergedContent } from '@/store/filesSlice';
import { Dispatch } from '@reduxjs/toolkit';
import { setEdit } from '@/store/filesSlice';
import { runQuery } from './query-executor';
import { getQueryHash } from '@/lib/utils/query-hash';

/**
 * EditFile implementation
 *
 * @param input - File ID and range edit
 * @param getState - Redux getState function
 * @param dispatch - Redux dispatch function
 * @returns Updated file state with diff, or validation error
 */
export async function editFile(
  input: EditFileInput,
  getState: () => RootState,
  dispatch: Dispatch
): Promise<EditFileOutput | EditFileError> {
  const { fileId, from, to, newContent } = input;
  const state = getState();

  // Get file state
  const fileState = state.files.files[fileId];
  if (!fileState) {
    return {
      success: false,
      error: `File ${fileId} not found`
    };
  }

  // Get merged content (base + persistableChanges + ephemeralChanges)
  const mergedContent = selectMergedContent(state, fileId);
  if (!mergedContent) {
    return {
      success: false,
      error: `File ${fileId} has no content`
    };
  }

  // Convert content to JSON string for line-based editing
  const contentStr = JSON.stringify(mergedContent, null, 2);
  const lines = contentStr.split('\n');

  // Validate range
  if (from < 1 || from > lines.length + 1) {
    return {
      success: false,
      error: `Invalid 'from' line number: ${from} (file has ${lines.length} lines)`
    };
  }

  if (to < 1 || to > lines.length + 1) {
    return {
      success: false,
      error: `Invalid 'to' line number: ${to} (file has ${lines.length} lines)`
    };
  }

  if (from > to) {
    return {
      success: false,
      error: `Invalid range: 'from' (${from}) must be <= 'to' (${to})`
    };
  }

  // Apply edit (line numbers are 1-indexed)
  const beforeLines = lines.slice(0, from - 1);
  const afterLines = lines.slice(to);
  const newLines = newContent.split('\n');
  const editedLines = [...beforeLines, ...newLines, ...afterLines];
  const editedStr = editedLines.join('\n');

  // Parse edited content as JSON
  let editedContent;
  try {
    editedContent = JSON.parse(editedStr);
  } catch (error) {
    return {
      success: false,
      error: `Invalid JSON after edit: ${error instanceof Error ? error.message : 'Unknown error'}`,
      validationErrors: [{
        field: 'content',
        message: 'Edited content is not valid JSON'
      }]
    };
  }

  // Type-specific validation
  const validationResult = validateFileContent(fileState.type, editedContent);
  if (!validationResult.valid) {
    return {
      success: false,
      error: validationResult.error || 'Validation failed',
      validationErrors: validationResult.errors
    };
  }

  // Store edit in Redux persistableChanges
  dispatch(setEdit({
    fileId,
    edits: editedContent
  }));

  // Generate unified diff
  const diff = generateDiff(contentStr, editedStr);

  // Get updated file state after edit
  const updatedState = getState();
  const updatedFileState = updatedState.files.files[fileId];

  // Collect references (same as before)
  const references: FileState[] = [];
  if (updatedFileState.references) {
    for (const refId of updatedFileState.references) {
      const refState = updatedState.files.files[refId];
      if (refState) {
        references.push(refState);
      }
    }
  }

  // Execute query if this is a question (auto-execution with deduplication)
  const queryResults: QueryResult[] = [];
  if (fileState.type === 'question') {
    const questionContent = editedContent as QuestionContent;
    const params = (questionContent.parameters || []).reduce<Record<string, any>>((acc, p) => {
      acc[p.name] = p.value ?? '';
      return acc;
    }, {});

    // Use runQuery for automatic execution with caching and deduplication
    const queryResult = await runQuery(
      questionContent.query,
      params,
      questionContent.database_name,
      getState,
      dispatch
    );

    queryResults.push({
      columns: queryResult.columns || [],
      types: queryResult.types || [],
      rows: queryResult.rows || []
    });
  }

  return {
    success: true,
    diff,
    fileState: updatedFileState,
    references,
    queryResults
  };
}

/**
 * Validate file content based on type
 */
function validateFileContent(
  fileType: string,
  content: any
): { valid: boolean; error?: string; errors?: Array<{ field: string; message: string }> } {
  // Basic validation - can be extended per file type
  if (!content || typeof content !== 'object') {
    return {
      valid: false,
      error: 'Content must be a valid object'
    };
  }

  // Type-specific validation
  switch (fileType) {
    case 'question':
      if (!content.query || typeof content.query !== 'string') {
        return {
          valid: false,
          error: 'Question must have a valid query field',
          errors: [{ field: 'query', message: 'Required field missing or invalid' }]
        };
      }
      if (!content.database_name || typeof content.database_name !== 'string') {
        return {
          valid: false,
          error: 'Question must have a valid database_name field',
          errors: [{ field: 'database_name', message: 'Required field missing or invalid' }]
        };
      }
      break;

    case 'dashboard':
      if (!content.assets || !Array.isArray(content.assets)) {
        return {
          valid: false,
          error: 'Dashboard must have a valid assets array',
          errors: [{ field: 'assets', message: 'Required field missing or invalid' }]
        };
      }
      break;

    // Add more type-specific validation as needed
  }

  return { valid: true };
}

/**
 * Generate unified diff between old and new content
 * Simple line-by-line diff for now
 */
function generateDiff(oldStr: string, newStr: string): string {
  const oldLines = oldStr.split('\n');
  const newLines = newStr.split('\n');

  const diffLines: string[] = [];
  const maxLines = Math.max(oldLines.length, newLines.length);

  for (let i = 0; i < maxLines; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];

    if (oldLine !== newLine) {
      if (oldLine !== undefined) {
        diffLines.push(`-${oldLine}`);
      }
      if (newLine !== undefined) {
        diffLines.push(`+${newLine}`);
      }
    }
  }

  return diffLines.join('\n');
}
