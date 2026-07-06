/**
 * File State Manager — barrel module.
 *
 * The implementation has been split by concern into sibling files within this
 * directory (each verb-grouped, single-responsibility); this file re-exports
 * everything so existing consumers (`@/lib/file-state/file-state`) keep
 * working with zero changes:
 *
 *   - file-read.ts        — loadFiles, loadFileByPath, readFiles, readFilesByCriteria, readFolder
 *   - file-edit.ts         — editFile, editFileStr, applyJsonContentEdit, applyStoryHtmlEdit, replaceFileState
 *   - file-publish.ts      — publishFile, publishAll
 *   - file-mutations.ts    — deleteFile, moveFile, batchMoveFiles, reloadFile, clearFileChanges,
 *                            discardAll, createDraftFile, duplicateFile, dryRunSave, createFolder
 *   - query-results.ts     — getQueryResult
 *   - notebook-results.ts  — captureNotebookCellResult, removeNotebookCellResult, rehydrateNotebookResults
 *
 * Shared stateful singletons (e.g. filePromises) stay colocated with their
 * sole owner file (file-read.ts) rather than being duplicated; small stateless
 * helpers shared across files (e.g. hashString) live in shared.ts.
 */

export * from '@/lib/file-state/file-read';
export * from '@/lib/file-state/file-edit';
export * from '@/lib/file-state/file-publish';
export * from '@/lib/file-state/file-mutations';
export * from '@/lib/file-state/query-results';
export * from '@/lib/file-state/notebook-results';

export type {
  ReadFilesOptions,
  ReadFilesByCriteriaOptions,
  ReadFolderOptions,
  ReadFolderResult,
  QueryExecutionParams,
  GetQueryResultOptions,
} from '@/lib/file-state/file-state-interface';
