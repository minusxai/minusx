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
import { selectFile, selectIsFileLoaded, selectIsFileFresh, setFile, setFiles, selectMergedContent, setEdit, setMetadataEdit, selectIsDirty, clearEdits, clearMetadataEdits, setLoading, setFolderLoading, setLoadError, clearEphemeral, addFile, selectFileIdByPath, selectIsFolderFresh, setFileInfo, setFolderInfo, selectFiles, setSaving, selectEffectiveName, selectEffectivePath, deleteFile as deleteFileAction, setFilePlaceholder, generateVirtualId, pathToVirtualId } from '@/store/filesSlice';
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
import type { RootState } from '@/store/store';
import type { AugmentedFile, FileState, QueryResult, QuestionContent, FileType, DocumentContent, DbFile, BaseFileContent, QuestionReference } from '@/lib/types';
import type { LoadError } from '@/lib/types/errors';
import { createLoadErrorFromException } from '@/lib/types/errors';
import type { AppState } from '@/lib/appState';

/**
 * Type-specific augmentation selector
 * Takes state and a file state, returns a map of query results keyed by cache key
 */
type AugmentSelector = (state: RootState, fileState: FileState) => Map<string, QueryResult>;

/**
 * Registry of augmentation selectors by file type
 */
const augmentRegistry = new Map<FileType, AugmentSelector>();

/**
 * Register an augmentation selector for a file type
 */
export function registerAugmentation(type: FileType, augmentFn: AugmentSelector): void {
  augmentRegistry.set(type, augmentFn);
}

/**
 * Augment a question file with its query result
 */
function augmentQuestionSelector(state: RootState, fileState: FileState): Map<string, QueryResult> {
  const result = new Map<string, QueryResult>();
  const mergedContent = selectMergedContent(state, fileState.id) as QuestionContent;
  if (!mergedContent) return result;

  const { query, parameters, database_name } = mergedContent;
  const params = (parameters || []).reduce<Record<string, any>>((acc, p) => {
    acc[p.name] = p.value ?? '';
    return acc;
  }, {});

  const queryResult = selectQueryResult(state, query, params, database_name);
  if (queryResult?.data) {
    const key = `${database_name}|||${query}|||${JSON.stringify(params)}`;
    result.set(key, queryResult.data);
  }
  return result;
}

/**
 * Augment a dashboard file with nested question states
 * Recursively augments each referenced question
 */
function augmentDashboardSelector(state: RootState, fileState: FileState): Map<string, QueryResult> {
  const result = new Map<string, QueryResult>();
  const content = selectMergedContent(state, fileState.id) as DocumentContent;
  if (!content?.assets) return result;

  for (const asset of content.assets) {
    if (asset.type === 'question' && 'id' in asset) {
      const questionState = selectFile(state, asset.id);
      if (questionState) {
        for (const [key, qr] of augmentQuestionSelector(state, questionState)) {
          result.set(key, qr);
        }
      }
    }
  }
  return result;
}

// Register default augmentation selectors
registerAugmentation('question', augmentQuestionSelector);
registerAugmentation('dashboard', augmentDashboardSelector);

interface ReadFilesOptions {
  ttl?: number;      // Time-to-live in ms (default: CACHE_TTL.FILE)
  skip?: boolean;    // Skip loading (return from Redux only)
}

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
    if (id < 0) return false;   // virtual files live only in Redux
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
        references: result.metadata.references || []
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
export function selectAugmentedFiles(state: RootState, fileIds: number[]): AugmentedFile[] {
  return fileIds
    .map(id => {
      const fileState = selectFile(state, id);
      if (!fileState) {
        if (id < 0) console.error(`[selectAugmentedFiles] Virtual file ${id} not found in Redux`);
        return undefined;
      }
      const references = (fileState.references || [])
        .map(refId => selectFile(state, refId))
        .filter((f): f is FileState => f !== undefined);
      const queryResultMap = new Map<string, QueryResult>();
      for (const file of [fileState, ...references]) {
        const augmentFn = augmentRegistry.get(file.type);
        if (!augmentFn) continue;
        for (const [key, qr] of augmentFn(state, file)) queryResultMap.set(key, qr);
      }
      return { fileState, references, queryResults: Array.from(queryResultMap.values()) };
    })
    .filter((a): a is AugmentedFile => a !== undefined);
}

/**
 * AugmentedFolder - Result of selectAugmentedFolder
 */
export interface AugmentedFolder {
  files: FileState[];
  loading: boolean;
  error: LoadError | null;
}

/**
 * selectAugmentedFolder - Pure selector: read folder children from Redux
 *
 * Maps folder references to FileState[], filters by user permissions and hidden paths.
 * No async, no side-effects. Pair with readFolder() to ensure data is loaded.
 *
 * @param state - Redux state
 * @param path - Folder path (e.g. '/org')
 * @returns AugmentedFolder
 */
export function selectAugmentedFolder(state: RootState, path: string): AugmentedFolder {
  const folderId = selectFileIdByPath(state, path);
  const folder = folderId ? selectFile(state, folderId) : undefined;

  if (!folder) return { files: [], loading: true, error: null };

  const user = state.auth.user;
  const mode = user?.mode || 'org';
  const role = user?.role || 'viewer';

  const files = (folder.references || [])
    .map(id => selectFile(state, id))
    .filter((f): f is FileState => {
      if (!f) return false;
      if (!canViewFileType(role, f.type)) return false;
      if (f.type === 'folder' && isHiddenSystemPath(f.path, mode)) return false;
      return true;
    });

  return { files, loading: folder.loading ?? false, error: folder.loadError ?? null };
}

/**
 * selectFilesByCriteria - Pure selector: filter files from Redux by criteria
 *
 * No async, no side-effects. Pair with readFilesByCriteria() to ensure data is loaded.
 * Uses startsWith for path matching (equivalent to unlimited depth), matching the
 * server-populated Redux state.
 *
 * @param state - Redux state
 * @param criteria - Filter criteria (type, paths)
 * @returns FileState[] matching criteria
 */
export function selectFilesByCriteria(
  state: RootState,
  criteria: { type?: FileType; paths?: string[] }
): FileState[] {
  return Object.values(state.files.files).filter(file => {
    if (criteria.type && file.type !== criteria.type) return false;
    if (criteria.paths) {
      return criteria.paths.some(path => file.path.startsWith(path));
    }
    return true;
  });
}

/**
 * selectFileByPath - Pure selector: get a file by path from Redux
 *
 * @param state - Redux state
 * @param path - File path
 * @returns FileState if found, undefined otherwise
 */
export function selectFileByPath(state: RootState, path: string | null): FileState | undefined {
  if (!path) return undefined;
  const id = selectFileIdByPath(state, path);
  return id ? selectFile(state, id) : undefined;
}

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
      ids: [pathToVirtualId(path)],
      error: createLoadErrorFromException(err)
    }));
  }
}

/**
 * ReadFiles - Load multiple files with references and query results
 *
 * @param input - File IDs to load
 * @param options - { ttl?: number, skip?: boolean }
 * @returns Augmented files with references and query results
 */
export async function readFiles(
  fileIds: number[],
  options: ReadFilesOptions = {}
): Promise<AugmentedFile[]> {
  const { ttl = CACHE_TTL.FILE, skip = false } = options;

  await loadFiles(fileIds, ttl, skip);
  return selectAugmentedFiles(getStore().getState(), fileIds);
}

/**
 * Options for readFilesByCriteria
 */
export interface ReadFilesByCriteriaOptions {
  criteria: {
    paths?: string[];
    type?: FileType;
    depth?: number;
  };
  ttl?: number;
  skip?: boolean;
  partial?: boolean;  // If true, return metadata only (faster)
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

  // Step 2: If partial load, return metadata only (no augmentation)
  if (partial) {
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
    editFileMetadata({
      fileId,
      changes: {
        ...(changes.name !== undefined && { name: changes.name }),
        ...(changes.path !== undefined && { path: changes.path })
      }
    });
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
 * Read files with line-encoded content for LLM consumption
 *
 * Formats each file's content as JSON with line numbers (1-indexed)
 * matching the format expected by editFileReplace.
 *
 * @param input - File IDs to load
 * @param options - TTL and skip options
 * @returns ReadFilesOutput with additional lineEncodedFiles map
 */
function formatLineEncoded(content: object): string {
  const contentStr = JSON.stringify(content, null, 2);
  const lines = contentStr.split('\n');
  const maxLineNum = lines.length;
  const padding = String(maxLineNum).length;
  return lines
    .map((line, idx) => `${String(idx + 1).padStart(padding)} | ${line}`)
    .join('\n');
}

export async function readFilesLineEncoded(
  fileIds: number[],
  options: ReadFilesOptions = {}
): Promise<(AugmentedFile & { lineEncodedContent: string })[]> {
  const files = await readFiles(fileIds, options);
  const state = getStore().getState();
  return files.map(augmented => {
    const mergedContent = selectMergedContent(state, augmented.fileState.id);
    const lineEncodedContent = mergedContent ? formatLineEncoded(mergedContent) : '';
    return { ...augmented, lineEncodedContent };
  });
}

/**
 * Read files and return stringified content (no pretty print)
 *
 * Loads files and returns their content as compact JSON strings.
 * Useful for string-based operations where line encoding is not needed.
 *
 * @param input - File IDs to load
 * @param options - Read options (ttl, skip, etc.)
 * @returns File states and stringified content (id -> string)
 */
export async function readFilesStr(
  fileIds: number[],
  options: ReadFilesOptions = {}
): Promise<(AugmentedFile & { stringifiedContent: string })[]> {
  const files = await readFiles(fileIds, options);
  const state = getStore().getState();
  return files.map(augmented => {
    const { fileState } = augmented;
    const mergedContent = selectMergedContent(state, fileState.id);
    const fullFile = {
      id: fileState.id,
      name: selectEffectiveName(state, fileState.id) || '',
      path: fileState.path,
      type: fileState.type,
      content: mergedContent
    };
    return { ...augmented, stringifiedContent: JSON.stringify(fullFile) };
  });
}

/**
 * Options for editFileStr (string-based editing)
 */
export interface EditFileStrOptions {
  fileId: number;
  oldMatch: string;    // String to search for
  newMatch: string;    // String to replace with
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

  // Get file state
  const fileState = selectFile(state, fileId);
  if (!fileState) {
    return { success: false, error: `File ${fileId} not found` };
  }

  // Get merged content
  const mergedContent = selectMergedContent(state, fileId);
  if (!mergedContent) {
    return { success: false, error: `File ${fileId} has no content` };
  }

  // Build FULL file JSON (same format as readFilesStr)
  const currentName = selectEffectiveName(state, fileId) || '';
  const fullFile = {
    id: fileState.id,
    name: currentName,
    path: fileState.path,
    type: fileState.type,
    content: mergedContent
  };

  // Convert to JSON string (compact)
  const fullFileStr = JSON.stringify(fullFile);

  // Check if oldMatch exists
  if (!fullFileStr.includes(oldMatch)) {
    return { success: false, error: `String "${oldMatch}" not found in file` };
  }

  // Apply string replace (first occurrence only)
  const editedStr = fullFileStr.replace(oldMatch, newMatch);

  // Parse edited file as JSON
  let editedFile: { id: number; name: string; path: string; type: FileType; content: any };
  try {
    editedFile = JSON.parse(editedStr);
  } catch (error) {
    return {
      success: false,
      error: `Invalid JSON after edit: ${error instanceof Error ? error.message : 'Unknown error'}`
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
    if (fileState.type === 'question') {
      const questionContent = editedFile.content as QuestionContent;
      if (!questionContent.database_name) {
        return {
          success: false,
          error: 'Question requires database_name field'
        };
      }
      if (!questionContent.query) {
        return {
          success: false,
          error: 'Question requires query field'
        };
      }
    }

    if (fileState.type === 'dashboard') {
      const dashboardContent = editedFile.content as DocumentContent;
      if (!dashboardContent.assets) {
        return {
          success: false,
          error: 'Dashboard requires assets field'
        };
      }
      if (!dashboardContent.layout) {
        return {
          success: false,
          error: 'Dashboard requires layout field'
        };
      }
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
 * Options for editFileLineEncoded (line-based editing)
 */
export interface EditFileLineEncodedOptions {
  fileId: number;
  from: number;    // Line number (1-indexed)
  to: number;      // Line number (1-indexed)
  newContent: string;  // Replacement text
}

/**
 * EditFileLineEncoded - Range-based line editing
 *
 * Useful for precise line-by-line editing of JSON content.
 * Validates JSON after edit and auto-executes queries for questions.
 *
 * @param options - File ID and line range to replace
 * @returns Success status with diff
 */
export async function editFileLineEncoded(
  options: EditFileLineEncodedOptions
): Promise<{ success: boolean; diff?: string; error?: string }> {
  const { fileId, from, to, newContent } = options;
  const state = getStore().getState();

  // Get file state
  const fileState = selectFile(state, fileId);
  if (!fileState) {
    return { success: false, error: `File ${fileId} not found` };
  }

  // Get merged content
  const mergedContent = selectMergedContent(state, fileId);
  if (!mergedContent) {
    return { success: false, error: `File ${fileId} has no content` };
  }

  // Convert content to JSON string for line-based editing
  const contentStr = JSON.stringify(mergedContent, null, 2);
  const lines = contentStr.split('\n');

  // Validate range
  if (from < 1 || from > lines.length + 1) {
    return { success: false, error: `Invalid 'from' line number: ${from} (file has ${lines.length} lines)` };
  }

  if (to < 1 || to > lines.length + 1) {
    return { success: false, error: `Invalid 'to' line number: ${to} (file has ${lines.length} lines)` };
  }

  if (from > to) {
    return { success: false, error: `Invalid range: 'from' (${from}) must be <= 'to' (${to})` };
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
      error: `Invalid JSON after edit: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }

  // Validate required fields based on file type
  if (fileState.type === 'question') {
    const questionContent = editedContent as QuestionContent;
    if (!questionContent.database_name) {
      return {
        success: false,
        error: 'Question requires database_name field'
      };
    }
    if (!questionContent.query) {
      return {
        success: false,
        error: 'Question requires query field'
      };
    }
  }

  if (fileState.type === 'dashboard') {
    const dashboardContent = editedContent as DocumentContent;
    if (!dashboardContent.assets) {
      return {
        success: false,
        error: 'Dashboard requires assets field'
      };
    }
    if (!dashboardContent.layout) {
      return {
        success: false,
        error: 'Dashboard requires layout field'
      };
    }
  }

  // Store edit in Redux
  getStore().dispatch(setEdit({
    fileId,
    edits: editedContent
  }));

  // Generate diff
  const diff = generateDiff(contentStr, editedStr);

  // NOTE: Removed auto-execute for questions (Phase 3: explicit execute pattern)
  // Queries should only execute when user clicks Run button (handleExecute)
  // AI agents that edit questions should call handleExecute explicitly if needed

  return { success: true, diff };
}

/**
 * Deep merge two objects
 * @param target - Base object
 * @param source - Changes to merge in
 * @returns Merged object
 */
function deepMerge<T>(target: T, source: Partial<T>): T {
  const result = { ...target };

  for (const key in source) {
    const sourceValue = source[key];
    const targetValue = result[key];

    if (sourceValue === undefined) continue;

    // If both are objects (and not arrays), merge recursively
    if (
      targetValue &&
      typeof targetValue === 'object' &&
      !Array.isArray(targetValue) &&
      sourceValue &&
      typeof sourceValue === 'object' &&
      !Array.isArray(sourceValue)
    ) {
      result[key] = deepMerge(targetValue, sourceValue) as any;
    } else {
      // Otherwise, replace with source value
      result[key] = sourceValue as any;
    }
  }

  return result;
}

/**
 * Generate unified diff between old and new content
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

/**
 * Options for editFileMetadata
 */
interface EditFileMetadataOptions {
  fileId: number;
  changes: { name?: string; path?: string };
}

/**
 * EditFileMetadata - Edit file name/path (internal only)
 *
 * Stores changes in metadataChanges (doesn't save to database).
 * External callers should use editFile() instead.
 *
 * @param options - File ID and metadata changes
 */
function editFileMetadata(options: EditFileMetadataOptions): void {
  const { fileId, changes } = options;

  // Import setMetadataEdit from filesSlice
  getStore().dispatch(setMetadataEdit({ fileId, changes }));
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

  // Set saving state
  getStore().dispatch(setSaving({ id: fileId, saving: true }));

  try {
    // Get merged content
    const mergedContent = selectMergedContent(state, fileId);
  if (!mergedContent) {
    throw new Error(`File ${fileId} has no content`);
  }

  // Determine if this is a create or update
  const isVirtualFile = fileId < 0;

  // Prepare content for saving: merge only persistable changes, NOT ephemeral
  // Ephemeral changes (lastExecuted, parameterValues, etc.) should not be persisted
  const contentToSave = fileState.persistableChanges
    ? { ...fileState.content, ...fileState.persistableChanges }
    : fileState.content;

  if (!contentToSave) {
    throw new Error(`File ${fileId} has no content to save`);
  }

  // Prepare file data
  const fileData = {
    name: fileState.metadataChanges?.name || fileState.name,
    path: fileState.metadataChanges?.path || fileState.path,
    type: fileState.type,
    content: contentToSave,
    company_id: state.auth.user?.companyId
  };

  // Save file
  let savedId: number;
  let savedName: string;
  let updatedFile: DbFile;

  if (isVirtualFile) {
    // Create new file using FilesAPI
    const result = await FilesAPI.createFile({
      name: fileData.name,
      path: fileData.path,
      type: fileData.type as FileType,
      content: fileData.content
    });
    savedId = result.data.id;
    savedName = result.data.name;
    updatedFile = result.data;
  } else {
    // Update existing file using FilesAPI
    const extractReferences = extractReferencesFromContent;
    const references = extractReferences(fileData.content, fileData.type as FileType);

    const result = await FilesAPI.saveFile(
      fileId,
      fileData.name,
      fileData.path,
      fileData.content,
      references
    );
    savedId = result.data.id;
    savedName = result.data.name;
    updatedFile = result.data;
  }

  // Update file state with response from API (so base content is updated)
  // For new files, use addFile to also update parent folder references
  // (so the folder view refreshes immediately without a page reload)
  if (isVirtualFile) {
    getStore().dispatch(addFile(updatedFile));
  } else {
    getStore().dispatch(setFile({ file: updatedFile }));
  }

  // Clear changes for the main file
  // Note: We don't delete the virtual file entry here to avoid potential 404 flash
  // during redirect. The virtual file entry is harmless and will be garbage collected
  // on next page load or can be cleaned up by a background task.
  getStore().dispatch(clearEdits(fileId));
  getStore().dispatch(clearMetadataEdits(fileId));

  // Cascade save: Collect and batch-save dirty referenced files
  const references = fileState.references || [];
  const currentState = getStore().getState();
  const dirtyRefs: Array<{
    id: number;
    name: string;
    path: string;
    content: BaseFileContent;
    references: number[];
  }> = [];

  for (const refId of references) {
    const refState = selectFile(currentState, refId);
    if (!refState) continue;

    // Check if reference is dirty
    const hasPersistableChanges = refState.persistableChanges && Object.keys(refState.persistableChanges).length > 0;
    const hasMetadataChanges = refState.metadataChanges && Object.keys(refState.metadataChanges).length > 0;

    if (hasPersistableChanges || hasMetadataChanges) {
      // Get content for saving: merge only persistable changes, NOT ephemeral
      const contentToSave: BaseFileContent | null = refState.persistableChanges
        ? { ...refState.content, ...refState.persistableChanges }
        : refState.content;

      if (!contentToSave) continue; // Skip if content is undefined

      const editedName = refState.metadataChanges?.name ?? refState.name;
      const editedPath = refState.metadataChanges?.path ?? refState.path;

      dirtyRefs.push({
        id: refId,
        name: editedName,
        path: editedPath,
        content: contentToSave as BaseFileContent,  // Safe after null check
        references: refState.references || []
      });
    }
  }

  // If there are dirty references, batch-save them atomically
  if (dirtyRefs.length > 0) {
    const result = await FilesAPI.batchSaveFiles(dirtyRefs);
    const savedFileIds = result.savedFileIds;

    // Reload saved references to update their base content IN PARALLEL
    // This ensures their content doesn't revert after clearing changes
    await Promise.all(
      savedFileIds.map(async (savedId) => {
        const reloadResult = await FilesAPI.loadFile(savedId);
        getStore().dispatch(setFile({ file: reloadResult.data, references: reloadResult.metadata.references }));
        getStore().dispatch(clearEdits(savedId));
        getStore().dispatch(clearMetadataEdits(savedId));
      })
    );
  }

    return { id: savedId, name: savedName };
  } finally {
    // Always clear saving state
    getStore().dispatch(setSaving({ id: fileId, saving: false }));
  }
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
      references: result.metadata.references || []
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

// ============================================================================
// Create Virtual File
// ============================================================================

/**
 * Options for creating a virtual file
 */
export interface CreateVirtualFileOptions {
  /** Folder path override (defaults to user's home_folder) */
  folder?: string;
  /** For questions: pre-populate with this database/connection name */
  databaseName?: string;
  /** For questions: pre-populate with this SQL query */
  query?: string;
  /** Virtual ID override (defaults to -Date.now()) */
  virtualId?: number;
}

/**
 * createVirtualFile - Create a virtual file for "create mode"
 *
 * Virtual files use negative IDs (-Date.now()) to distinguish them from real files.
 * They exist only in Redux until saved via publishFile.
 *
 * @param type - The type of file to create (question, dashboard, etc.)
 * @param options - Optional configuration (folder, connection, query)
 * @returns Virtual file ID (negative number)
 *
 * Example:
 * ```typescript
 * // Create new question with SQL
 * const virtualId = await createVirtualFile('question', {
 *   folder: '/org',
 *   databaseName: 'my_db',
 *   query: 'SELECT * FROM users LIMIT 100'
 * });
 * ```
 */
export async function createVirtualFile(
  type: FileType,
  options: CreateVirtualFileOptions = {}
): Promise<number> {
  const { folder, databaseName, query, virtualId: providedVirtualId } = options;

  // Generate virtual ID (namespaced or use provided)
  const virtualId = providedVirtualId && providedVirtualId < 0
    ? providedVirtualId
    : generateVirtualId();

  // Get user from Redux for folder resolution and company_id
  const state = getStore().getState();
  const user = state.auth.user;

  // Resolve folder path
  let resolvedFolder = folder;
  if (!resolvedFolder) {
    // Import path resolver dynamically to avoid circular deps
    resolvedFolder = user
      ? resolveHomeFolderSync(user.mode, user.home_folder || '')
      : '/org';
  }

  // Check if file type is allowed in this folder
  // If not allowed in system folder, redirect to user's home folder or mode root
  const mode = user?.mode || 'org';
  if (!isFileTypeAllowedInPath(type, resolvedFolder, mode)) {
    const originalFolder = resolvedFolder;
    // Redirect to user's home folder
    resolvedFolder = user
      ? resolveHomeFolderSync(user.mode, user.home_folder || '')
      : getModeRoot(mode);
    console.log(`[createVirtualFile] Redirected ${type} from restricted folder:`, {
      originalFolder,
      redirectedFolder: resolvedFolder
    });
  }

  // Fetch template from backend
  const template = await FilesAPI.getTemplate(type, {
    path: resolvedFolder,
    databaseName,
    query
  });

  // Create virtual file object
  const virtualFile: DbFile = {
    id: virtualId,
    name: template.fileName,
    path: `${resolvedFolder}/${template.fileName}`,
    type: type,
    references: [],
    content: template.content,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    company_id: user?.companyId ?? 0
  };

  // Add to Redux
  getStore().dispatch(setFile({ file: virtualFile, references: [] }));

  return virtualId;
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

  // Get user from Redux for company_id
  const state = getStore().getState();
  const companyId = state.auth.user?.companyId ?? 0;

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
    company_id: companyId
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
 * Options for reading a folder
 */
export interface ReadFolderOptions {
  depth?: number;      // 1 = direct children, -1 = all descendants (default: 1)
  ttl?: number;        // Time-to-live in ms (default: CACHE_TTL.FOLDER)
  forceLoad?: boolean; // Force fresh load, bypassing cache (default: false)
}

/**
 * Result of reading a folder
 */
export interface ReadFolderResult {
  files: FileState[];  // Child files (filtered by permissions)
  loading: boolean;
  error: LoadError | null;
}

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
export function stripFileContent(files: FileState[]): FileState[] {
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
 * Options for query execution
 */
export interface GetQueryResultOptions {
  ttl?: number;      // Time-to-live in ms (default: CACHE_TTL.QUERY)
  skip?: boolean;    // Skip execution (default: false)
}

/**
 * Query execution parameters
 */
export interface QueryExecutionParams {
  query: string;
  params: Record<string, any>;
  database: string;
  references?: QuestionReference[];  // For CTE composition
}

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
  const { query, params: queryParams, database, references } = params;
  const { ttl = CACHE_TTL.QUERY, skip = false } = options;

  if (skip) {
    throw new Error('Cannot execute query with skip=true');
  }

  const state = getStore().getState();

  // Import query utilities

  const queryId = getQueryHash(query, queryParams, database);

  // Step 1: Check Redux cache first (with TTL check)
  const isFresh = selectIsQueryFresh(state, query, queryParams, database, ttl);
  const cached = selectQueryResult(state, query, queryParams, database);

  if (cached?.data && isFresh) {
    return Promise.resolve(cached.data);
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
          database_name: database,
          parameters: queryParams,
          references: references || []
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        // API returns { success: false, error: { code, message, details } }
        const errorMessage = errorData.error?.message || errorData.error || `Query execution failed: ${response.statusText}`;
        throw new Error(errorMessage);
      }

      const apiResponse: { data: QueryResult } = await response.json();
      const result = apiResponse.data;

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

// ============================================================================
// App State Management
// ============================================================================

/**
 * Get app state from current navigation pathname
 *
 * Determines page type from pathname and loads appropriate data:
 * - /f/{id} → file page → readFiles
 * - /p/path → folder page → readFolder
 * - /new/{type} → new file page → create virtual file with options
 *
 * @param pathname - Current pathname from usePathname()
 * @param createOptions - Options for creating virtual files (for /new routes)
 * @returns AppState (file or folder context)
 */
export async function getAppState(
  pathname: string,
  createOptions?: CreateVirtualFileOptions
): Promise<AppState | null> {
  // File page: /f/{id} or /f/{id}-{slug}
  const fileMatch = pathname.match(/^\/f\/(\d+)/);
  if (fileMatch) {
    const id = parseInt(fileMatch[1], 10);
    const result = await readFiles([id], { skip: id < 0 });
    const augmented = result[0];
    if (!augmented || augmented.fileState.loadError) return null;
    const { fileState: file, references, queryResults } = augmented;
    return {
      type: 'file',
      id,
      fileType: file.type,
      file,
      references,
      queryResults
    };
  }

  // New file page: /new/{type}
  const newFileMatch = pathname.match(/^\/new\/([^/?]+)/);
  if (newFileMatch) {
    const fileType = newFileMatch[1] as FileType;
    const state = getStore().getState();

    // Check if virtual file with specific ID already exists (from createOptions.virtualId)
    let virtualId: number | undefined;
    if (createOptions?.virtualId && createOptions.virtualId < 0) {
      const existingFile = selectFile(state, createOptions.virtualId);
      if (existingFile) {
        virtualId = createOptions.virtualId;
      }
    }

    // If no specific virtual ID, find or create latest virtual file of this type
    if (!virtualId) {
      const virtualFiles = Object.values(state.files.files)
        .filter(f => f.id < 0 && f.type === fileType)
        .sort((a, b) => a.id - b.id); // Sort ascending: most negative (newest) first

      if (virtualFiles.length > 0) {
        // Use existing virtual file
        virtualId = virtualFiles[0].id;
      } else {
        // Create new virtual file with options
        virtualId = await createVirtualFile(fileType, createOptions);
      }
    }

    // Get the file from Redux
    const updatedState = getStore().getState();
    const file = selectFile(updatedState, virtualId);

    if (!file) return null;

    return {
      type: 'file',
      id: virtualId,
      fileType: file.type,
      file,
      references: [],
      queryResults: []
    };
  }

  // Folder page: /p/path or /p/nested/path
  const folderMatch = pathname.match(/^\/p\/(.*)/);
  if (folderMatch) {
    const path = '/' + (folderMatch[1] || '');
    const result = await readFolder(path);
    return {
      type: 'folder',
      path,
      folder: {
        files: result.files,
        loading: false,
        error: null
      }
    };
  }

  return null;
}
