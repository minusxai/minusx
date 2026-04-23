/**
 * ReadFiles - Load multiple files with references and query results
 *
 * Phase 1: Enhanced with auto-fetching, TTL-based caching, and promise deduplication
 *
 * Features:
 * - Fetches missing files automatically (no more "File not found" errors)
 * - TTL-based cache freshness checks
 * - Promise deduplication for concurrent requests
 * - Skip option to bypass fetching
 * - Extensible augmentation registry for type-specific processing
 *
 * Improvements over read-files.client.ts:
 * - Actually fetches files if missing/stale (instead of throwing error)
 * - Promise deduplication prevents redundant API calls
 * - Flexible TTL control per request
 * - Direct store import (no getState parameter)
 * - Registry pattern for type-specific augmentation
 */

import { getStore } from '@/store/store';
import { selectFile, selectIsFileLoaded, selectIsFileFresh, setFile, setFiles, selectMergedContent, setEdit, setMetadataEdit, selectIsDirty, clearEdits, clearMetadataEdits, setLoading, setFolderLoading, setLoadError, clearEphemeral, setEphemeral, addFile, selectFileIdByPath, selectIsFolderFresh, setFileInfo, setFolderInfo, selectFiles, setSaving, selectEffectiveName, deleteFile as deleteFileAction, setFilePlaceholder, selectDirtyFiles, type FileId } from '@/store/filesSlice';
import { ConflictError } from '@/lib/data/files';
import { selectQueryResult, setQueryResult, setQueryError, selectIsQueryFresh, setQueryLoading } from '@/store/queryResultsSlice';
import { selectEffectiveUser } from '@/store/authSlice';
import { FilesAPI, getFiles } from '@/lib/data/files';
import { PromiseManager } from '@/lib/utils/promise-manager';
import { CACHE_TTL } from '@/lib/constants/cache';
import { extractReferencesFromContent } from '@/lib/data/helpers/extract-references';
import { resolveHomeFolderSync, isHiddenSystemPath, isFileTypeAllowedInPath, getModeRoot } from '@/lib/mode/path-resolver';
import { fetchWithCache } from '@/lib/api/fetch-wrapper';
import { API } from '@/lib/api/declarations';
import { canViewFileType } from '@/lib/auth/access-rules.client';
import { getQueryHash } from '@/lib/utils/query-hash';
import { encodeFileStr, decodeFileStr } from '@/lib/api/file-encoding';
import type { AugmentedFile, FileState, QueryResult, QuestionContent, FileType, DbFile } from '@/lib/types';
import type { DryRunSaveResult } from '@/lib/data/types';
import type { LoadError } from '@/lib/types/errors';
import { createLoadErrorFromException } from '@/lib/types/errors';
import { validateFileState } from '@/lib/validation/content-validators';
import { deepMerge, generateDiff } from '@/lib/utils/deep-merge';
import { selectAugmentedFiles } from '@/lib/store/file-selectors';
import type {
  ReadFilesOptions,
  ReadFilesByCriteriaOptions,
  ReadFolderOptions,
  ReadFolderResult,
  QueryExecutionParams,
  GetQueryResultOptions,
} from '@/lib/api/file-state-interface';

// djb2-style hash used for deterministic edit IDs and path placeholder keys
function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}
function pathToPlaceholderId(path: string): number {
  return -(2_000_000_000 + (Math.abs(hashString(path)) % 1_000_000_000));
}

export type {
  IFileStateRead,
  ReadFilesOptions,
  ReadFilesByCriteriaOptions,
  ReadFolderOptions,
  ReadFolderResult,
  QueryExecutionParams,
  GetQueryResultOptions,
} from '@/lib/api/file-state-interface';


/**
 * Global promise manager for in-flight file fetches
 * Export for testing and debugging (e.g., filePromises.clear(), filePromises.size)
 */
export const filePromises = new PromiseManager<void>();

/**
 * LoadFiles - Fetch missing/stale files into Redux (Steps 1+2 of readFiles)
 *
 * Never re-throws — all errors end up in file.loadError in Redux.
 *
 * @param fileIds - File IDs to check and potentially fetch
 * @param ttl - Time-to-live in ms for cache freshness
 * @param skip - If true, skip fetching entirely
 */
export async function loadFiles(fileIds: number[], ttl: number, skip: boolean): Promise<void> {
  const state = getStore().getState();

  // Determine which files need fetching
  const needsFetch = fileIds.filter(id => {
    if (skip) return false;
    return !selectIsFileLoaded(state, id) || !selectIsFileFresh(state, id, ttl);
  });

  if (needsFetch.length === 0) return;

  // Sort IDs for consistent cache key
  const key = [...needsFetch].sort((a, b) => a - b).join(',');

  // Set loading state for files being fetched
  needsFetch.forEach(id => getStore().dispatch(setLoading({ id, loading: true })));

  try {
    await filePromises.execute(key, async () => {
      const result = await FilesAPI.loadFiles(needsFetch);
      getStore().dispatch(setFiles({
        files: result.data,
        references: result.metadata.references || [],
        analyticsMap: result.metadata.analytics || {},
      }));
      // setFiles sets loading: false on all stored files
    });
  } catch (error) {
    // Store error in Redux — do NOT re-throw
    getStore().dispatch(setLoadError({ ids: needsFetch, error: createLoadErrorFromException(error) }));
    return;
  }

  // Post-fetch: mark files not returned by the API as NOT_FOUND
  const afterState = getStore().getState();
  const notFound = needsFetch.filter(id => {
    const file = selectFile(afterState, id);
    return !file || file.updatedAt === 0;
  });
  if (notFound.length > 0) {
    getStore().dispatch(setLoadError({
      ids: notFound,
      error: { message: 'File not found', code: 'NOT_FOUND' }
    }));
  }
}

/**
 * SelectAugmentedFiles - Pure selector: read files + references + query results from Redux
 *
 * No async, no side-effects. Can be used in hooks via useSelector.
 *
 * @param state - Redux state
 * @param fileIds - File IDs to select
 * @returns ReadFilesOutput
 */
/**
 * loadFileByPath - Fetch a file by path into Redux
 *
 * Never re-throws — callers handle errors in local state.
 *
 * @param path - File path to load
 * @param ttl - Time-to-live in ms for cache freshness
 */
export async function loadFileByPath(path: string, ttl: number = CACHE_TTL.FILE): Promise<void> {
  const state = getStore().getState();
  const existingId = selectFileIdByPath(state, path);
  // Skip if a real (positive-ID) file is already fresh
  if (existingId && existingId > 0
      && selectIsFileLoaded(state, existingId)
      && selectIsFileFresh(state, existingId, ttl)) {
    return;
  }
  // Synchronously create loading placeholder in Redux (pathIndex updated too)
  getStore().dispatch(setFilePlaceholder(path));
  try {
    const response = await FilesAPI.loadFileByPath(path);
    // setFile reducer auto-deletes the placeholder and updates pathIndex
    getStore().dispatch(setFile({ file: response.data, references: [] }));
  } catch (err) {
    getStore().dispatch(setLoadError({
      ids: [pathToPlaceholderId(path)],
      error: createLoadErrorFromException(err)
    }));
  }
}

/**
 * ReadFiles - Load multiple files with references and query results
 *
 * @param input - File IDs to load
 * @param options - { ttl?: number, skip?: boolean, runQueries?: boolean }
 * @returns Augmented files with references and query results
 */
export async function readFiles(
  fileIds: number[],
  options: ReadFilesOptions = {}
): Promise<AugmentedFile[]> {
  const { ttl = CACHE_TTL.FILE, skip = false, runQueries = false } = options;

  await loadFiles(fileIds, ttl, skip);

  if (runQueries) {
    // Collect all question files (root + references) that need a fresh query result
    const preAugmented = selectAugmentedFiles(getStore().getState(), fileIds);
    const questionFiles = preAugmented.flatMap(a => [a.fileState, ...a.references])
      .filter(f => f.type === 'question');

    await Promise.allSettled(
      questionFiles.flatMap(f => {
        const content = f.content as any;
        if (!content?.query || !content?.connection_name) return [];
        return [getQueryResult({
          query: content.query,
          params: content.parameterValues ?? {},
          database: content.connection_name,
          filePath: f.path,
          fileId: f.id,
          fileVersion: f.version,
        })];
      })
    );
  }

  return selectAugmentedFiles(getStore().getState(), fileIds);
}


/**
 * ReadFilesByCriteria - Load files by criteria (path, type, depth)
 *
 * @param options - Criteria and options
 * @returns Augmented files matching criteria
 */
export async function readFilesByCriteria(
  options: ReadFilesByCriteriaOptions
): Promise<AugmentedFile[]> {
  const { criteria, ttl = CACHE_TTL.FILE, skip = false, partial = false } = options;

  // Step 1: Get file metadata matching criteria
  const result = await FilesAPI.getFiles(criteria);
  const fileIds = result.data.map(f => f.id);

  // Step 2: If partial load, store metadata in Redux and return without augmentation
  if (partial) {
    // Store file metadata in Redux so reactive selectors (useFilesByCriteria) can find them
    if (result.data.length > 0) {
      getStore().dispatch(setFileInfo(result.data));
    }
    const state = getStore().getState();
    return fileIds
      .map(id => selectFile(state, id))
      .filter((f): f is FileState => Boolean(f))
      .map(fileState => ({ fileState, references: [], queryResults: [] }));
  }

  // Step 3: Full load with augmentation
  return readFiles(fileIds, { ttl, skip });
}

/**
 * Options for editFile
 */
export interface EditFileOptions {
  fileId: number;
  changes: {
    name?: string;
    path?: string;
    content?: Partial<DbFile['content']>;  // Allow partial content updates
  };
}

/**
 * EditFile - Apply changes to a file with deep merge
 *
 * Accepts partial file changes (name, path, content) and deep merges them.
 * Stores changes in persistableChanges/metadataChanges (doesn't save to database).
 * Auto-executes query for question files.
 *
 * @param options - File ID and changes
 */
export async function editFile(options: EditFileOptions): Promise<void> {
  const { fileId, changes } = options;
  const state = getStore().getState();

  // Validate file exists
  const fileState = selectFile(state, fileId);
  if (!fileState) {
    throw new Error(`File ${fileId} not found`);
  }

  // Handle metadata changes (name, path)
  if (changes.name !== undefined || changes.path !== undefined) {
    getStore().dispatch(setMetadataEdit({
      fileId,
      changes: {
        ...(changes.name !== undefined && { name: changes.name }),
        ...(changes.path !== undefined && { path: changes.path })
      }
    }));
  }

  // Handle content changes
  if (changes.content !== undefined) {
    // Deep merge with existing persistableChanges (NOT full content!)
    // This way we only store the changes, not the full merged content
    const currentPersistableChanges = state.files.files[fileId].persistableChanges || {};
    const mergedChanges = deepMerge(currentPersistableChanges, changes.content);

    // Store ONLY changes in persistableChanges
    console.log('Merged changes to persistableChanges for file', fileId, mergedChanges);
    getStore().dispatch(setEdit({
      fileId,
      edits: mergedChanges
    }));

    // NOTE: Removed auto-execute for questions (Phase 3: explicit execute pattern)
    // Queries should only execute when user clicks Run button (handleExecute)
    // Not on every edit!
  }
}



/**
 * Replace a file's entire state via editFileStr (same code path as EditFile tool).
 * Also auto-executes query for question files so viz/columns update immediately.
 *
 * @param fileId - The file to replace
 * @param targetFileObj - The full file object to apply (as parsed from a diff line)
 */
export async function replaceFileState(fileId: number, targetFileObj: { name?: string; path?: string; content: any }): Promise<{ success: boolean; error?: string }> {
  const state = getStore().getState();
  const built = buildCurrentFileStr(state, fileId);
  if (!built.success) return built;

  // Replace the entire file string via editFileStr (handles content, metadata, validation)
  const targetStr = encodeFileStr(targetFileObj);
  const result = await editFileStr({ fileId, oldMatch: built.fullFileStr, newMatch: targetStr });
  if (!result.success) return result;

  // Auto-execute query for questions (same as EditFile tool handler)
  const fileState = selectFile(state, fileId);
  if (fileState?.type === 'question') {
    const updatedState = getStore().getState();
    const finalContent = selectMergedContent(updatedState, fileId) as any;
    if (finalContent?.query && finalContent?.connection_name) {
      const params = finalContent.parameterValues || {};
      try {
        await getQueryResult({ query: finalContent.query, params, database: finalContent.connection_name, filePath: fileState.path, fileId, fileVersion: fileState.version });
        getStore().dispatch(setEphemeral({
          fileId: fileId as FileId,
          changes: {
            lastExecuted: {
              query: finalContent.query,
              params,
              database: finalContent.connection_name,
              references: finalContent.references || []
            }
          }
        }));
      } catch (err) {
        console.warn('[replaceFileState] Auto-execute failed:', err);
      }
    }
  }

  return result;
}

/**
 * Options for editFileStr (string-based editing)
 */
export interface EditFileStrOptions {
  fileId: number;
  oldMatch: string;    // String to search for
  newMatch: string;    // String to replace with
  replaceAll?: boolean; // default true: replace all occurrences; false: error if multiple found
}

/**
 * Build the full encoded file string for a file from Redux state.
 * Must match compressFileState exactly so oldMatch copied from ReadFiles/appState works verbatim.
 * Used by editFileStr and replaceFileState.
 */
export function buildCurrentFileStr(state: ReturnType<typeof getStore>['getState'] extends () => infer R ? R : never, fileId: number): { success: true; fullFileStr: string; mergedContent: any } | { success: false; error: string } {
  const fileState = selectFile(state, fileId);
  if (!fileState) {
    return { success: false, error: `File ${fileId} not found` };
  }
  const baseContent = fileState.content;
  if (!baseContent) {
    return { success: false, error: `File ${fileId} has no content` };
  }
  const mergedContent = fileState.persistableChanges && Object.keys(fileState.persistableChanges).length > 0
    ? { ...baseContent, ...fileState.persistableChanges }
    : baseContent;
  const currentName = selectEffectiveName(state, fileId) || '';
  const isDirty = !!(
    (fileState.persistableChanges && Object.keys(fileState.persistableChanges).length > 0) ||
    fileState.metadataChanges?.name !== undefined ||
    fileState.metadataChanges?.path !== undefined
  );
  let queryResultId = fileState.queryResultId;
  if (fileState.type === 'question') {
    const qc = mergedContent as QuestionContent;
    if (qc?.query && qc?.connection_name) {
      queryResultId = getQueryHash(qc.query, qc.parameterValues || {}, qc.connection_name);
    }
  }
  const fullFileStr = encodeFileStr({
    id: fileState.id,
    name: currentName,
    path: fileState.metadataChanges?.path ?? fileState.path,
    type: fileState.type,
    content: mergedContent,
    isDirty,
    ...(queryResultId ? { queryResultId } : {}),
  });
  return { success: true, fullFileStr, mergedContent };
}

/**
 * EditFileStr - String-based editing using find and replace
 *
 * Searches for oldMatch in the FULL file JSON (including name, path, type, content)
 * and replaces with newMatch. Detects what changed and updates Redux accordingly.
 * Uses string replace (replaces first occurrence only).
 * Validates JSON after edit.
 * Changes are stored in Redux but NOT saved to database until PublishFile is called.
 *
 * @param options - File ID and search/replace strings
 * @returns Success status with diff
 */
export async function editFileStr(
  options: EditFileStrOptions
): Promise<{ success: boolean; diff?: string; error?: string }> {
  const { fileId, oldMatch, newMatch } = options;
  const state = getStore().getState();

  const built = buildCurrentFileStr(state, fileId);
  if (!built.success) return built;
  const { fullFileStr, mergedContent } = built;
  const fileState = selectFile(state, fileId)!;
  const currentName = selectEffectiveName(state, fileId) || '';

  // Normalize \n escape sequences to literal newlines (LLM sometimes outputs \\n instead of real newlines)
  const normalizedOldMatch = oldMatch.includes('\\n') ? oldMatch.replace(/\\n/g, '\n') : oldMatch;
  const normalizedNewMatch = newMatch.includes('\\n') ? newMatch.replace(/\\n/g, '\n') : newMatch;
  const effectiveOldMatch = fullFileStr.includes(oldMatch) ? oldMatch : normalizedOldMatch;
  const effectiveNewMatch = oldMatch === effectiveOldMatch ? newMatch : normalizedNewMatch;

  if (!fullFileStr.includes(effectiveOldMatch)) {
    return { success: false, error: `String "${oldMatch}" not found in file` };
  }

  const replaceAll = options.replaceAll ?? true;
  let editedStr: string;

  if (!replaceAll) {
    const count = fullFileStr.split(effectiveOldMatch).length - 1;
    if (count > 1) {
      return { success: false, error: `oldMatch found ${count} times — it is not unique. Either (a) add more surrounding context to oldMatch so it matches exactly one location, or (b) use replaceAll=true to replace all ${count} occurrences` };
    }
    editedStr = fullFileStr.replace(effectiveOldMatch, effectiveNewMatch);
  } else {
    editedStr = fullFileStr.split(effectiveOldMatch).join(effectiveNewMatch);
  }

  // Decode back to object
  let editedFile: { id: number; name: string; path: string; type: FileType; isDirty: boolean; queryResultId?: string; content: any };
  try {
    editedFile = decodeFileStr(editedStr) as typeof editedFile;
  } catch (error) {
    return {
      success: false,
      error: `Invalid file encoding after edit: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }

  // Detect what changed and dispatch appropriate Redux actions
  const metadataChanges: { name?: string; path?: string } = {};
  let contentChanged = false;

  // Check name change
  if (editedFile.name !== currentName) {
    metadataChanges.name = editedFile.name;
  }

  // Check path change
  if (editedFile.path !== fileState.path) {
    metadataChanges.path = editedFile.path;
  }

  // Check content change
  if (JSON.stringify(editedFile.content) !== JSON.stringify(mergedContent)) {
    contentChanged = true;
  }

  // Validate content if it changed
  if (contentChanged) {
    const error = validateFileState(editedFile);
    if (error) {
      return { success: false, error: `Invalid ${editedFile.type} content: ${error}` };
    }
  }

  // Dispatch Redux actions for changes
  if (Object.keys(metadataChanges).length > 0) {
    getStore().dispatch(setMetadataEdit({ fileId, changes: metadataChanges }));
  }

  if (contentChanged) {
    getStore().dispatch(setEdit({
      fileId,
      edits: editedFile.content
    }));
  }

  // Generate diff
  const diff = generateDiff(fullFileStr, editedStr);

  return { success: true, diff };
}

/**
 * Options for publishFile
 */
export interface PublishFileOptions {
  fileId: number;
}

/**
 * Result from publishFile
 */
export interface PublishFileResult {
  id: number;
  name: string;
}

/** @deprecated Use PublishFileResult instead */
export type SaveResult = PublishFileResult;

/**
 * PublishFile - Save file and dirty references to database
 *
 * Handles both virtual files (negative IDs) and real files (positive IDs).
 * Clears persistableChanges and metadataChanges on success.
 *
 * @param options - File ID to publish
 * @returns File ID and name for redirect logic
 */
export async function publishFile(
  options: PublishFileOptions
): Promise<PublishFileResult> {
  const { fileId } = options;
  const state = getStore().getState();

  // Get file state
  const fileState = selectFile(state, fileId);
  if (!fileState) {
    throw new Error(`File ${fileId} not found`);
  }

  // Import isDirty selector

  // Check if file is dirty
  const isDirty = selectIsDirty(state, fileId);
  if (!isDirty) {
    // Nothing to save, return current ID and name
    return { id: fileId, name: fileState.name };
  }

  // Prepare content for saving: merge only persistable changes, NOT ephemeral
  // Ephemeral changes (lastExecuted, parameterValues, etc.) should not be persisted
  let contentToSave = fileState.persistableChanges
    ? { ...fileState.content, ...fileState.persistableChanges }
    : fileState.content;

  if (!contentToSave) {
    throw new Error(`File ${fileId} has no content to save`);
  }

  const fileData = {
    name: fileState.metadataChanges?.name || fileState.name,
    path: fileState.metadataChanges?.path || fileState.path,
    type: fileState.type,
    content: contentToSave,
  };

  const references = extractReferencesFromContent(fileData.content, fileData.type as FileType);
  const editId = String(hashString(`${fileId}:${JSON.stringify(fileState.persistableChanges ?? {})}`));

  getStore().dispatch(setSaving({ id: fileId, saving: true }));

  let savedId: number;
  let savedName: string;
  let updatedFile: DbFile;

  try {
    const saveVersion = fileState.version;
    const saveContent = fileData.content;
    try {
      const result = await FilesAPI.saveFile(
        fileId,
        fileData.name,
        fileData.path,
        saveContent,
        references,
        undefined,
        editId,
        saveVersion
      );
      savedId = result.data.id;
      savedName = result.data.name;
      updatedFile = result.data;
    } catch (firstError) {
      if (!(firstError instanceof ConflictError)) throw firstError;
      // 409: server has a newer version (e.g. schema cache write).
      // Merge our edits on top of the server's latest content and retry once.
      const serverFile = firstError.currentFile;
      getStore().dispatch(setFile({ file: serverFile }));
      const retryContent = { ...serverFile.content, ...fileState.persistableChanges } as typeof saveContent;
      const result = await FilesAPI.saveFile(
        fileId,
        fileData.name,
        fileData.path,
        retryContent,
        references,
        undefined,
        editId,
        serverFile.version
      );
      savedId = result.data.id;
      savedName = result.data.name;
      updatedFile = result.data;
    }
  } catch (error) {
    if (error instanceof ConflictError) {
      getStore().dispatch(setFile({ file: error.currentFile }));
    }
    throw error;
  } finally {
    getStore().dispatch(setSaving({ id: fileId, saving: false }));
  }

  getStore().dispatch(setFile({ file: updatedFile! }));
  getStore().dispatch(clearEdits(fileId));
  getStore().dispatch(clearMetadataEdits(fileId));

  return { id: savedId!, name: savedName! };
}

/**
 * publishAll - Batch-publish all dirty non-system files in a single round trip.
 *
 * All files are expected to have real positive IDs (use createDraftFile to create
 * new files — they get real IDs from the server immediately, with draft:true).
 *
 * @param fileIds - Optional list of file IDs to scope the publish to.
 *   When provided, only these files (and their dirty dependencies) are saved.
 *   When omitted, all dirty non-system files are saved.
 *
 * Returns an empty map (no virtual→real ID mapping needed anymore).
 * Throws on error; caller is responsible for showing error state.
 */
export async function publishAll(fileIds?: number[]): Promise<Record<number, number>> {
  const state = getStore().getState();
  const allDirtyUnscoped = selectDirtyFiles(state);
  let allDirty: FileState[];
  if (fileIds) {
    // Start with explicitly requested files, then expand to include their dirty dependencies.
    const scopedIds = new Set(fileIds);
    for (const id of [...scopedIds]) {
      const f = state.files.files[id];
      if (!f) continue;
      const merged = { ...(f.content || {}), ...(f.persistableChanges || {}) };
      const refs = extractReferencesFromContent(merged as any, f.type as FileType);
      for (const refId of refs) {
        if (selectIsDirty(state, refId)) scopedIds.add(refId);
      }
    }
    allDirty = allDirtyUnscoped.filter(f => scopedIds.has(f.id));
  } else {
    allDirty = allDirtyUnscoped;
  }
  if (allDirty.length === 0) return {};

  const toSave = allDirty.map(f => {
    const merged = { ...(f.content || {}), ...(f.persistableChanges || {}) };
    return {
      id: f.id,
      name: f.metadataChanges?.name || f.name,
      path: f.metadataChanges?.path || f.path,
      content: merged,
      references: extractReferencesFromContent(merged as any, f.type as FileType),
    };
  });

  const { data: saved } = await FilesAPI.batchSaveFiles(toSave as any);
  for (const file of saved) {
    getStore().dispatch(setFile({ file }));
    getStore().dispatch(clearEdits(file.id));
    getStore().dispatch(clearMetadataEdits(file.id));
  }

  return {};
}

/**
 * Options for deleteFile
 */
export interface DeleteFileOptions {
  fileId: number;
}

/**
 * DeleteFile - Delete a file from database and Redux
 *
 * Handles deletion of files including folders (recursive delete on server).
 * Removes file from Redux on success.
 *
 * @param options - File ID to delete
 */
export async function deleteFile(options: DeleteFileOptions): Promise<void> {
  const { fileId } = options;

  // Call API to delete file
  const response = await fetch(`/api/files/${fileId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const errorData = await response.json();
    const errorMessage = errorData.error?.message || errorData.error || 'Failed to delete file';
    throw new Error(errorMessage);
  }

  // Remove from Redux
  const state = getStore().getState();
  const file = selectFile(state, fileId);
  if (file) {
    getStore().dispatch(deleteFileAction({ id: fileId, path: file.path }));
  }
}

/**
 * MoveFile - Update a file's name/path and sync Redux + affected parent folders
 *
 * On success:
 * - Updates the file's metadata in Redux via setFileInfo
 * - Force-reloads the old parent folder (removes file from its listing)
 * - Force-reloads the new parent folder (adds file to its listing)
 */
export async function moveFile(fileId: number, name: string, newPath: string): Promise<void> {
  const data = await FilesAPI.moveFile({ id: fileId, name, newPath });
  const { oldPath } = data;

  // Update the file's metadata in Redux
  const state = getStore().getState();
  const file = selectFile(state, fileId);
  if (file) {
    getStore().dispatch(setFileInfo([{
      ...file,
      name,
      path: newPath,
      references: file.references ?? [],
    }]));
  }

  // Reload only the two affected parent folders
  const oldParent = oldPath.split('/').slice(0, -1).join('/') || '/';
  const newParent = newPath.split('/').slice(0, -1).join('/') || '/';
  const parentsToReload = new Set([oldParent, newParent]);
  await Promise.all([...parentsToReload].map(p => readFolder(p, { forceLoad: true })));

  // For folder moves, also reload the moved folder itself so children get fresh paths
  const movedFile = selectFile(getStore().getState(), fileId);
  if (movedFile?.type === 'folder') {
    await readFolder(newPath, { forceLoad: true });
  }
}

/**
 * Move multiple files to a destination folder in a single API call.
 */
export async function batchMoveFiles(files: Array<{ id: number; name: string }>, destFolder: string): Promise<void> {
  const results = await FilesAPI.batchMoveFiles(
    files.map(f => ({ id: f.id, name: f.name, newPath: `${destFolder}/${f.name}` }))
  );

  // Batch-update Redux state for all moved files
  const state = getStore().getState();
  const fileInfoUpdates = results
    .map(r => {
      const file = selectFile(state, r.id);
      if (!file) return null;
      return { ...file, name: r.name, path: r.path, references: file.references ?? [] };
    })
    .filter((f): f is NonNullable<typeof f> => f !== null);

  if (fileInfoUpdates.length > 0) {
    getStore().dispatch(setFileInfo(fileInfoUpdates));
  }

  // Reload all affected parent folders
  const parentsToReload = new Set<string>();
  for (const r of results) {
    const oldParent = r.oldPath.split('/').slice(0, -1).join('/') || '/';
    const newParent = r.path.split('/').slice(0, -1).join('/') || '/';
    parentsToReload.add(oldParent);
    parentsToReload.add(newParent);
  }
  await Promise.all([...parentsToReload].map(p => readFolder(p, { forceLoad: true })));

  // Reload any moved folders so their children get fresh paths
  for (const r of results) {
    const movedFile = selectFile(getStore().getState(), r.id);
    if (movedFile?.type === 'folder') {
      await readFolder(r.path, { forceLoad: true });
    }
  }
}

/**
 * Options for reloadFile
 */
export interface ReloadFileOptions {
  fileId: number;
  silent?: boolean;  // Skip loading state
}

/**
 * ReloadFile - Force refresh a file from database
 *
 * Bypasses TTL cache and fetches fresh data.
 * Overwrites any local changes.
 *
 * @param options - File ID and options
 */
export async function reloadFile(options: ReloadFileOptions): Promise<void> {
  const { fileId, silent = false } = options;

  // Skip reloading virtual files (negative IDs)
  // Virtual files only exist in Redux and have no database representation
  if (fileId < 0) {
    console.warn(`[reloadFile] Skipping reload of virtual file ${fileId} - virtual files cannot be reloaded from database`);
    return;
  }

  // Set loading state (unless silent)
  if (!silent) {
    getStore().dispatch(setLoading({ id: fileId, loading: true }));
  }

  try {
    // Force fetch from API (with undefined user parameter)
    const result = await FilesAPI.loadFile(fileId, undefined, { refresh: true });

    // Update Redux with fresh data
    getStore().dispatch(setFile({
      file: result.data,
      references: result.metadata.references || [],
      analytics: result.metadata.analytics,
      conversationAnalytics: result.metadata.conversationAnalytics,
    }));
  } finally {
    // Clear loading state
    if (!silent) {
        getStore().dispatch(setLoading({ id: fileId, loading: false }));
    }
  }
}

/**
 * Options for clearFileChanges
 */
export interface ClearFileChangesOptions {
  fileId: number;
}

/**
 * ClearFileChanges - Discard local changes without reloading
 *
 * Clears persistableChanges, metadataChanges, and ephemeralChanges.
 * File reverts to original state from database.
 *
 * @param options - File ID
 */
export function clearFileChanges(options: ClearFileChangesOptions): void {
  const { fileId } = options;

  // Import clear actions

  // Clear all changes
  getStore().dispatch(clearEdits(fileId));
  getStore().dispatch(clearMetadataEdits(fileId));
  getStore().dispatch(clearEphemeral(fileId));
}

/**
 * discardAll - Discard changes for dirty non-system files.
 *
 * Real files (id >= 0): clears persistableChanges, metadataChanges, ephemeralChanges.
 * Virtual files (id < 0): removed from Redux entirely.
 * Real files are cleared first so dashboard refs to virtual IDs revert before the virtual files are removed.
 *
 * @param fileIds - Optional list of file IDs to scope the discard to.
 *   When provided, only these files (+ their dirty dependencies) are discarded.
 *   When omitted, all dirty non-system files are discarded.
 */
export function discardAll(fileIds?: number[]): void {
  const state = getStore().getState();
  const allDirtyUnscoped = selectDirtyFiles(state);
  let filesToDiscard: FileState[];
  if (fileIds) {
    const scopedIds = new Set(fileIds);
    // Expand: look at ALL scoped files (not just dirty) to find their dirty children.
    // E.g., a clean dashboard references a dirty question — the question should be discarded.
    for (const id of [...scopedIds]) {
      const f = state.files.files[id];
      if (!f) continue;
      const merged = { ...(f.content || {}), ...(f.persistableChanges || {}) };
      const refs = extractReferencesFromContent(merged as any, f.type as FileType);
      for (const refId of refs) {
        if (selectIsDirty(state, refId)) scopedIds.add(refId);
      }
    }
    filesToDiscard = allDirtyUnscoped.filter(f => scopedIds.has(f.id));
  } else {
    filesToDiscard = allDirtyUnscoped;
  }

  for (const file of filesToDiscard) {
    getStore().dispatch(clearEdits(file.id));
    getStore().dispatch(clearMetadataEdits(file.id));
    getStore().dispatch(clearEphemeral(file.id));
  }
}

// ============================================================================
// Create Virtual File
// ============================================================================

// ============================================================================
// Create Draft File
// ============================================================================

/**
 * Options for creating a draft file (server-side)
 */
export interface CreateDraftFileOptions {
  /** Folder path override (defaults to user's home_folder) */
  folder?: string;
  /** For questions: pre-populate with this database/connection name */
  databaseName?: string;
  /** For questions: pre-populate with this SQL query */
  query?: string;
  /** Name for the file — uses a slug to set the DB path immediately so parent folders are navigable */
  name?: string;
}

/**
 * createDraftFile - Create a new file on the server immediately with draft:true.
 *
 * Unlike createVirtualFile (which uses a negative client-side ID), this calls the
 * server right away and gets back a real positive ID. The file is stored in the DB
 * with draft:true, making it invisible in folder listings until first real save.
 *
 * @param type - The type of file to create (question, dashboard, etc.)
 * @param options - Optional configuration (folder, connection, query)
 * @returns Real file ID (positive number) — consistent from creation to publish
 */
export async function createDraftFile(
  type: FileType,
  options: CreateDraftFileOptions = {}
): Promise<number> {
  const { folder, databaseName, query, name } = options;

  const state = getStore().getState();
  const user = state.auth.user;

  let resolvedFolder = folder;
  if (!resolvedFolder) {
    resolvedFolder = user
      ? resolveHomeFolderSync(user.mode, user.home_folder || '')
      : '/org';
  }

  const mode = user?.mode || 'org';
  if (!isFileTypeAllowedInPath(type, resolvedFolder, mode)) {
    const originalFolder = resolvedFolder;
    resolvedFolder = user
      ? resolveHomeFolderSync(user.mode, user.home_folder || '')
      : getModeRoot(mode);
    console.log(`[createDraftFile] Redirected ${type} from restricted folder:`, {
      originalFolder,
      redirectedFolder: resolvedFolder
    });
  }

  const template = await FilesAPI.getTemplate(type, {
    path: resolvedFolder,
    databaseName,
    query
  });

  const baseFolder = resolvedFolder.replace(/\/+$/, '');
  let fileName: string;
  let filePath: string;
  if (name) {
    // Slug the name immediately so the DB path is correct from creation.
    // Important for folders that will be used as parents within the same session.
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    fileName = name;
    filePath = `${baseFolder}/${slug}`;
  } else if (template.fileName) {
    fileName = template.fileName;
    filePath = `${baseFolder}/${template.fileName}`;
  } else {
    // Template has no name (questions, dashboards, etc.) — generate a random token
    // for a unique DB path. The UI shows an empty name; the token is replaced when
    // the user or agent assigns a real name and saves.
    const token = Math.random().toString(36).slice(2, 10);
    fileName = token;
    filePath = `${baseFolder}/${token}`;
  }

  const result = await FilesAPI.createFile({
    name: fileName,
    path: filePath,
    type,
    content: template.content,
    references: [],
  });

  const file = result.data;
  // When using a random token, hide it from the UI by showing the template name
  // (empty string for questions/dashboards). The parent folder is preserved in
  // file.path so slug computation in setMetadataEdit works correctly on name change.
  const uiName = name || template.fileName; // '' when neither is set
  getStore().dispatch(setFile({ file: { ...file, name: uiName }, references: [] }));
  return file.id;
}

// ============================================================================
// Dry Run Save
// ============================================================================

/**
 * dryRunSave - Validate a batch save without committing to the database.
 *
 * Collects all dirty files (optionally scoped by fileIds) and runs batchSaveFiles
 * with dryRun:true — the server wraps everything in a transaction that always rolls
 * back. Useful for pre-flight checks that catch cross-file path conflicts before
 * the user actually commits.
 *
 * @param fileIds - Optional list of file IDs to scope the dry run to.
 *   When omitted, all dirty non-system files are included.
 * @returns DryRunSaveResult — success:true if all saves would succeed, or errors list.
 */
export async function dryRunSave(fileIds?: number[]): Promise<DryRunSaveResult> {
  const state = getStore().getState();
  const allDirtyUnscoped = selectDirtyFiles(state);
  const allDirty = fileIds
    ? allDirtyUnscoped.filter(f => fileIds.includes(f.id))
    : allDirtyUnscoped;

  if (allDirty.length === 0) return { success: true, errors: [] };

  const toSave = allDirty.map(f => {
    const merged = { ...(f.content || {}), ...(f.persistableChanges || {}) };
    return {
      id: f.id,
      name: f.metadataChanges?.name || f.name,
      path: f.metadataChanges?.path || f.path,
      content: merged,
      references: extractReferencesFromContent(merged as any, f.type as FileType),
    };
  });

  return FilesAPI.batchSaveFiles(toSave as any, undefined, true);
}

// ============================================================================
// Create Folder
// ============================================================================

/**
 * Result of folder creation
 */
export interface CreateFolderResult {
  id: number;
  name: string;
  path: string;
}

/**
 * createFolder - Create a new folder in the file system
 *
 * @param folderName - Name of the new folder
 * @param parentPath - Parent path where folder will be created
 * @returns Folder metadata (id, name, path)
 *
 * Example:
 * ```typescript
 * const folder = await createFolder('Sales Reports', '/org');
 * // Creates folder at /org/Sales Reports
 * console.log(folder.path); // "/org/sales-reports"
 * ```
 */
export async function createFolder(
  folderName: string,
  parentPath: string
): Promise<CreateFolderResult> {
  // Call API to create folder

  const result = await fetchWithCache('/api/folders', {
    method: 'POST',
    body: JSON.stringify({ folderName, parentPath }),
    cacheStrategy: API.folders.create.cache,
  });

  // Construct folder file object
  const now = new Date().toISOString();
  const folderFile: DbFile = {
    id: result.data.id,
    name: result.data.name,
    path: result.data.path,
    type: 'folder',
    references: [],  // Folder references computed dynamically from children
    content: { description: '' },
    created_at: now,
    updated_at: now,
    version: 1,
    last_edit_id: null,
  };

  // Add to Redux
  getStore().dispatch(addFile(folderFile));

  // Return metadata
  return {
    id: result.data.id,
    name: result.data.name,
    path: result.data.path
  };
}

// ============================================================================
// Read Folder
// ============================================================================


/**
 * readFolder - Load folder contents with TTL caching and permission filtering
 *
 * Behavior:
 * 1. Check if folder is fresh (within TTL) - return cached if fresh
 * 2. If stale/missing, fetch from API (getFiles with path and depth)
 * 3. Store folder file + children in Redux
 * 4. Filter files based on user permissions and hidden system paths
 * 5. Return { files, loading, error }
 *
 * @param path - Folder path (e.g., '/org', '/team')
 * @param options - Options (depth, ttl, forceLoad)
 * @returns Promise<ReadFolderResult>
 *
 * Example:
 * ```typescript
 * const result = await readFolder('/org', { depth: 1 });
 * console.log(result.files); // All accessible files in /org
 * ```
 */
export async function readFolder(
  path: string,
  options: ReadFolderOptions = {}
): Promise<ReadFolderResult> {
  const { depth = 1, ttl = CACHE_TTL.FOLDER, forceLoad = false } = options;

  const state = getStore().getState();


  // Look up folder ID by path
  let folderId = selectFileIdByPath(state, path);

  // Check if folder is fresh
  const isFresh = selectIsFolderFresh(state, path, ttl);

  // Fetch from API if not fresh or forcing reload
  if (!isFresh || forceLoad) {
    // Set loading state (creates placeholder if folder not yet in Redux)
    getStore().dispatch(setFolderLoading({ path, loading: true }));

    try {
      // Fetch folder contents from API
      const response = await getFiles({ paths: [path], depth });

      // Store folder file itself (for pathIndex)
      if (response.metadata.folders.length > 0) {
        getStore().dispatch(setFileInfo(response.metadata.folders));
      }

      // Store children and update folder.references
      getStore().dispatch(setFolderInfo({ path, fileInfos: response.data }));

      // Update folderId after storing
      const updatedState = getStore().getState();
      folderId = selectFileIdByPath(updatedState, path);
    } catch (error) {
      console.error('[readFolder] Failed to load folder:', path, error);

      const loadError: LoadError = {
        message: error instanceof Error ? error.message : String(error),
        code: 'SERVER_ERROR'
      };

      const updatedFolderId = selectFileIdByPath(getStore().getState(), path);
      if (updatedFolderId) {
        getStore().dispatch(setLoadError({ ids: [updatedFolderId], error: loadError }));
      }

      return { files: [], loading: false, error: loadError };
    }
  }

  // Common return path: get from cache (now fresh), strip metadata, filter
  const currentState = getStore().getState();
  const folder = folderId ? selectFile(currentState, folderId) : undefined;
  const childIds = folder?.references || [];
  const allFiles = selectFiles(currentState, childIds);

  // Strip content and edit state to avoid bloating app state
  const metadataOnly = stripFileContent(allFiles);

  // Filter by permissions
  const filteredFiles = await filterFilesByPermissions(metadataOnly);

  return {
    files: filteredFiles,
    loading: false,
    error: null
  };
}

/**
 * Strip content and edit state from files to avoid bloating app state.
 * Used by readFolder() and useAppState() folder path.
 */
function stripFileContent(files: FileState[]): FileState[] {
  return files.map(f => {
    const { content, persistableChanges, ephemeralChanges, metadataChanges, ...rest } = f;
    return rest as FileState;
  });
}

/**
 * Helper: Filter files by user permissions and hidden system paths
 */
async function filterFilesByPermissions(files: FileState[]): Promise<FileState[]> {
  const state = getStore().getState();

  // Get effective user and mode
  const effectiveUser = selectEffectiveUser(state);
  const mode = effectiveUser?.mode || 'org';

  // Import access rules and path helpers

  // Filter by permissions
  return files.filter(file => {
    // Filter by role-based type permissions
    if (!canViewFileType(effectiveUser?.role || 'viewer', file.type)) {
      return false;
    }
    // Filter out hidden system folders
    if (file.type === 'folder' && isHiddenSystemPath(file.path, mode)) {
      return false;
    }
    return true;
  });
}

// ============================================================================
// Get Query Result
// ============================================================================


/**
 * Global promise manager for in-flight queries
 * Prevents duplicate concurrent queries
 */
const queryPromiseManager = new PromiseManager<QueryResult>();

/**
 * getQueryResult - Execute query with TTL caching and promise deduplication
 *
 * Behavior:
 * 1. Check Redux cache - return immediately if fresh (within TTL)
 * 2. Check promise store - return existing promise if already running
 * 3. Execute query - store promise, update Redux on completion
 * 4. Cleanup - remove from promise store when done
 *
 * Features:
 * - TTL-based caching (default: 10 hours)
 * - Promise deduplication (same query = same promise)
 * - Redux cache integration
 * - Automatic loading state management
 *
 * @param params - Query execution parameters (query, params, database)
 * @param options - Options (ttl, skip)
 * @returns Promise<QueryResult>
 *
 * Example:
 * ```typescript
 * const result = await getQueryResult({
 *   query: 'SELECT * FROM users WHERE id = :userId',
 *   params: { userId: 123 },
 *   database: 'default_db'
 * });
 * console.log(result.rows); // Query results
 * ```
 */
export async function getQueryResult(
  params: QueryExecutionParams,
  options: GetQueryResultOptions = {}
): Promise<QueryResult> {
  const { query, params: queryParams, database, references, parameterTypes, filePath, fileId, fileVersion } = params;
  const { ttl = CACHE_TTL.QUERY, skip = false, forceLoad = false } = options;

  if (skip) {
    throw new Error('Cannot execute query with skip=true');
  }

  const state = getStore().getState();

  // Import query utilities

  const queryId = getQueryHash(query, queryParams, database);

  // Step 1: Check Redux cache first (with TTL check)
  const isFresh = selectIsQueryFresh(state, query, queryParams, database, ttl);
  const cached = selectQueryResult(state, query, queryParams, database);

  if (isFresh && !forceLoad) {
    if (cached?.data) return Promise.resolve(cached.data);
    // Cached error within TTL — re-throw without re-fetching to prevent retry loop
    if (cached?.error) throw new Error(cached.error);
  }

  // Step 2: Execute with deduplication via PromiseManager
  return queryPromiseManager.execute(queryId, async () => {
    // Import Redux actions

    // Set loading state
    getStore().dispatch(setQueryLoading({ query, params: queryParams, database, loading: true }));

    try {
      const response = await fetch('/api/query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          connection_name: database,
          parameters: queryParams,
          references: references || [],
          ...(parameterTypes && { parameterTypes }),
          ...(filePath && { filePath }),
          ...(fileId !== undefined && { fileId }),
          ...(fileVersion !== undefined && { fileVersion })
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        // API returns { success: false, error: { code, message, details } }
        const errorMessage = errorData.error?.message || errorData.error || `Query execution failed: ${response.statusText}`;
        throw new Error(errorMessage);
      }

      const apiResponse: { data: QueryResult; finalQuery?: string } = await response.json();
      const result = { ...apiResponse.data, ...(apiResponse.finalQuery && { finalQuery: apiResponse.finalQuery }) };

      // Update Redux cache with result (clears loading state)
      console.log('[getQueryResult] Query completed, caching result:', queryId);
      getStore().dispatch(setQueryResult({
        query,
        params: queryParams,
        database,
        data: result
      }));

      return result;
    } catch (error) {
      console.error('[getQueryResult] Query execution failed:', error);

      // Store error in Redux
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      getStore().dispatch(setQueryError({
        query,
        params: queryParams,
        database,
        error: errorMessage
      }));

      throw error;
    }
  });
}

