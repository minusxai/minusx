/**
 * File State Hooks - Centralized React hooks for file operations
 *
 * All hooks in this file are thin wrappers around functions from @/lib/api/file-state.ts
 * They handle React-specific concerns (state, effects) while delegating actual work to
 * the centralized file-state module.
 *
 * Hooks included:
 * - useFiles - Load multiple files by IDs
 * - useFile - Load a single file by ID
 * - useFilesByCriteria - Load files by criteria (path, type, depth)
 * - useFileByPath - Load a file by path (read-only)
 * - useFolder - Load folder contents with permissions
 * - useAppState - Get current page app state (file or folder)
 * - useQueryResult - Execute queries with TTL caching
 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import { shallowEqual } from 'react-redux';
import { useAppSelector } from '@/store/hooks';
import {
  isVirtualFileId,
  type FileId,
  type FileState
} from '@/store/filesSlice';
import {
  selectQueryResult,
  selectIsQueryFresh,
  selectHasQueryData
} from '@/store/queryResultsSlice';
import {
  readFilesByCriteria,
  readFolder,
  loadFiles,
  loadFileByPath,
  getQueryResult,
  selectAugmentedFiles,
  selectAugmentedFolder,
  selectFilesByCriteria,
  selectFileByPath,
  type AugmentedFolder
} from '@/lib/api/file-state';
import type { AppState } from '@/lib/appState';
import { selectAppState } from '@/store/navigationSlice';
import { CACHE_TTL } from '@/lib/constants/cache';
import type { LoadError } from '@/lib/types/errors';
import type { GetFilesOptions } from '@/lib/data/types';
import type { AugmentedFile, QuestionReference } from '@/lib/types';
import { FileType } from '@/lib/ui/file-metadata';

// ============================================================================
// useAugmentedFile / useAugmentedFolder - Internal reactive selector hooks
// ============================================================================

/**
 * useAugmentedFile - Pure reactive selector hook for a single augmented file
 *
 * No side-effects, no fetching — pair with useFile (or loadFiles) to ensure data is loaded.
 * Re-renders only when fileState, references, or queryResults change by shallow equality.
 */
function useAugmentedFile(id: number | undefined): AugmentedFile | undefined {
  return useAppSelector(
    state => id !== undefined ? selectAugmentedFiles(state, [id])[0] : undefined,
    (a, b) =>
      a?.fileState === b?.fileState &&
      shallowEqual(a?.references, b?.references) &&
      shallowEqual(a?.queryResults, b?.queryResults)
  );
}

/**
 * useAugmentedFolder - Pure reactive selector hook for folder children
 *
 * No side-effects, no fetching — pair with readFolder() to ensure data is loaded.
 * Re-renders only when files, loading, or error change by shallow equality.
 */
function useAugmentedFolder(path: string): AugmentedFolder {
  return useAppSelector(
    state => selectAugmentedFolder(state, path),
    (a, b) =>
      a.loading === b.loading &&
      a.error === b.error &&
      shallowEqual(a.files, b.files)
  );
}

/**
 * useFilesByCriteriaSelector - Pure reactive selector hook for criteria-matched files
 *
 * No side-effects, no fetching — pair with readFilesByCriteria() to ensure data is loaded.
 * shallowEqual on the returned array checks each FileState element by reference —
 * Redux/immer keeps unchanged file references stable, preventing unnecessary re-renders.
 */
function useFilesByCriteriaSelector(
  criteria: { type?: FileType; paths?: string[] }
): FileState[] {
  return useAppSelector(
    state => selectFilesByCriteria(state, criteria),
    shallowEqual
  );
}

/**
 * useFileByPathSelector - Pure reactive selector hook for a file looked up by path
 *
 * No side-effects, no fetching — pair with loadFileByPath() to ensure data is loaded.
 * Returns AugmentedFile (with references and queryResults) or undefined.
 */
function useFileByPathSelector(path: string | null | undefined): AugmentedFile | undefined {
  return useAppSelector(
    state => {
      const fileState = selectFileByPath(state, path ?? null);
      return fileState ? selectAugmentedFiles(state, [fileState.id])[0] : undefined;
    },
    (a, b) =>
      a?.fileState === b?.fileState &&
      shallowEqual(a?.references, b?.references) &&
      shallowEqual(a?.queryResults, b?.queryResults)
  );
}

// ============================================================================
// useFile - Load a single file by ID
// ============================================================================

/**
 * Options for useFile hook
 */
export interface UseFileOptions {
  ttl?: number;      // Time-to-live in ms (default: CACHE_TTL.FILE = 10 hours)
  skip?: boolean;    // Skip loading (for conditional use)
}

/**
 * useFile Hook - Phase 3 (Simplified)
 *
 * Purely reactive hook that loads a file by ID. No methods - components use
 * file-state.ts exports directly for mutations (editFile, publishFile, reloadFile, clearFileChanges).
 *
 * @param id - File ID (positive number for real files, negative number for virtual files)
 * @param options - Hook options (ttl, skip)
 * @returns AugmentedFile | undefined — access .fileState for file data, .references, .queryResults
 *
 * Example:
 * ```tsx
 * const { fileState: file } = useFile(fileId) ?? {};
 * if (!file || file.loading) return <Spinner />;
 * ```
 */
export function useFile(id: FileId | undefined, options: UseFileOptions = {}): AugmentedFile | undefined {
  const { ttl = CACHE_TTL.FILE, skip = false } = options;

  // Virtual files (negative IDs) are pre-populated in Redux, so skip loading
  const shouldSkip = skip || (id !== undefined && isVirtualFileId(id));

  const optionsKey = useMemo(
    () => JSON.stringify({ id, ttl, skip: shouldSkip }),
    [id, ttl, shouldSkip]
  );

  // Trigger fetch — loading state is owned by Redux (file.loading)
  useEffect(() => {
    if (shouldSkip || id === undefined) return;
    loadFiles([id], ttl, false).catch(() => {});
  }, [optionsKey]);

  return useAugmentedFile(id);
}

// ============================================================================
// useFilesByCriteria - Load files by criteria
// ============================================================================

/**
 * Options for useFilesByCriteria hook
 */
export interface UseFilesByCriteriaOptions {
  /** Query files by criteria (path, type, depth) */
  criteria: GetFilesOptions;
  /** Partial loading (default: false) - true: metadata only, false: full content */
  partial?: boolean;
  /** Time-to-live for cache freshness (ms) */
  ttl?: number;
  /** Skip loading (for conditional fetching) */
  skip?: boolean;
}

/**
 * Return type for useFilesByCriteria hook
 */
export interface UseFilesByCriteriaReturn {
  files: FileState[];
  loading: boolean;
  error: Error | null;
}

/**
 * useFilesByCriteria - Load files by criteria (path, type, depth)
 *
 * Uses file-state.ts readFilesByCriteria internally for consistent caching and augmentation.
 *
 * Usage:
 * ```typescript
 * // Query by criteria with full load (default, triggers augmentation)
 * const { files, loading } = useFilesByCriteria({
 *   criteria: { type: 'connection', depth: 1 }
 * });
 *
 * // Query by criteria with partial load (metadata only, fast)
 * const { files, loading } = useFilesByCriteria({
 *   criteria: { type: 'context', depth: -1 },
 *   partial: true
 * });
 * ```
 */
export function useFilesByCriteria(options: UseFilesByCriteriaOptions): UseFilesByCriteriaReturn {
  const { criteria, partial = false, ttl = 60000, skip = false } = options;
  const [loading, setLoading] = useState(!skip);
  const [error, setError] = useState<Error | null>(null);

  const optionsKey = useMemo(
    () => JSON.stringify({ criteria, partial, ttl, skip }),
    [criteria, partial, ttl, skip]
  );

  useEffect(() => {
    if (skip) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    readFilesByCriteria({ criteria, partial }).catch(err => {
      setError(err instanceof Error ? err : new Error(String(err)));
    }).finally(() => setLoading(false));
  }, [optionsKey]);

  const files = useFilesByCriteriaSelector(criteria);
  return { files, loading, error };
}

// ============================================================================
// useFileByPath - Load a file by path (read-only)
// ============================================================================

/**
 * Options for useFileByPath hook
 */
export interface UseFileByPathOptions {
  ttl?: number;      // Time-to-live in ms (default: CACHE_TTL.FILE = 10 hours)
  skip?: boolean;    // Skip loading (for conditional use)
}

/**
 * Return type for useFileByPath hook
 */
export interface UseFileByPathReturn {
  file: AugmentedFile | undefined;
  loading: boolean;
  error: LoadError | null;
}

/**
 * useFileByPath Hook
 *
 * Loads a file by path instead of ID. Useful when you only know the file path
 * (e.g., LLM call files where you have llm_call_id but not the file ID).
 *
 * @param path - File path (e.g., /logs/llm_calls/user@example.com/abc123.json)
 * @param options - Hook options (ttl, skip)
 * @returns {file, loading, error}
 *
 * Behavior:
 * 1. Fetches file by path from API
 * 2. Extracts file ID from response
 * 3. Stores file in Redux by ID (can be accessed with useFile later)
 * 4. Returns file state
 *
 * Example:
 * ```tsx
 * function LLMCallViewer({ llmCallId, userId }: Props) {
 *   const path = `/logs/llm_calls/${userId}/${llmCallId}.json`;
 *   const { file, loading, error } = useFileByPath(path);
 *
 *   if (loading) return <Spinner />;
 *   if (error) return <Error message={error} />;
 *   if (!file) return <NotFound />;
 *
 *   return <LLMCallContent file={file} />;
 * }
 * ```
 *
 * Note: This hook does NOT support edit/save operations. It's read-only.
 * After loading, if you need to edit, use useFile with the file.id.
 */
export function useFileByPath(path: string | null | undefined, options: UseFileByPathOptions = {}): UseFileByPathReturn {
  const { ttl = CACHE_TTL.FILE, skip = false } = options;

  useEffect(() => {
    if (skip || !path) return;
    loadFileByPath(path, ttl).catch(() => {}); // errors land in Redux placeholder
  }, [path, ttl, skip]);

  const file = useFileByPathSelector(path);
  return {
    file,
    // If no placeholder yet (first render before effect fires): infer from intent
    loading: file ? (file.fileState.loading ?? false) : (!skip && !!path),
    error: file?.fileState.loadError ?? null
  };
}

// ============================================================================
// useFolder - Load folder contents
// ============================================================================

/**
 * Options for useFolder hook
 */
export interface UseFolderOptions {
  depth?: number;    // 1 = direct children, -1 = all descendants (default: 1)
  ttl?: number;      // Time-to-live in ms (default: CACHE_TTL.FOLDER = 10 hours)
  forceLoad?: boolean;  // Force fresh load, bypassing cache (default: false)
}

/**
 * Return type for useFolder hook
 */
export interface UseFolderReturn {
  files: FileState[];
  loading: boolean;
  error: LoadError | null;
}

/**
 * useFolder Hook - Phase 3 (Simplified)
 *
 * Loads children of a folder with TTL caching and automatically filters
 * files based on the current user's permissions.
 *
 * Uses readFolder from file-state.ts internally.
 *
 * @param path - Folder path (e.g., '/org', '/team')
 * @param options - Hook options (depth, ttl, forceLoad)
 * @returns {files, loading, error}
 *
 * Example:
 * ```tsx
 * function FolderBrowser({ path }: { path: string }) {
 *   const { files, loading } = useFolder(path);
 *   const questions = files.filter(f => f.type === 'question');  // Filter downstream
 *   return <FilesList files={questions} />;
 * }
 * ```
 */
export function useFolder(path: string, options: UseFolderOptions = {}): UseFolderReturn {
  const { depth = 1, ttl = CACHE_TTL.FOLDER, forceLoad = false } = options;

  useEffect(() => {
    readFolder(path, { depth, ttl, forceLoad }).catch(() => {});
  }, [path, depth, ttl, forceLoad]);

  return useAugmentedFolder(path);
}

// ============================================================================
// useQueryResult - Execute queries with TTL caching
// ============================================================================

/**
 * Query execution parameters
 */
export interface QueryParams {
  query: string;
  params: Record<string, any>;
  database: string;
  references?: QuestionReference[];  // Composed questions
}

/**
 * Result returned by useQueryResult hook
 */
export interface UseQueryResultReturn {
  data: any | null;              // Query result data (columns + rows)
  loading: boolean;              // Currently fetching
  error: string | null;          // Error message if fetch failed
  isStale: boolean;              // Data exists but is stale (being refetched)
  refetch: () => void;           // Manually trigger refetch
}

/**
 * Options for useQueryResult hook
 */
export interface UseQueryResultOptions {
  ttl?: number;      // Time-to-live in ms (default: CACHE_TTL.QUERY = 10 hours)
  skip?: boolean;    // Skip execution (for conditional use)
}

/**
 * useQueryResult Hook - Phase 3 (Simplified)
 *
 * Executes queries with TTL-based caching and automatic refetching.
 * Uses getQueryResult from file-state.ts internally.
 *
 * @param query - SQL query string
 * @param params - Query parameters
 * @param database - Database name (connection)
 * @param references - Question references (optional)
 * @param options - Hook options (ttl, skip)
 * @returns {data, loading, error, isStale, refetch}
 *
 * Behavior:
 * 1. No data → Execute query, set loading true
 * 2. Data exists & fresh → Return cached data
 * 3. Data exists & stale → Return stale data, refetch in background
 *
 * Example:
 * ```tsx
 * const { data, loading, error, isStale } = useQueryResult(
 *   'SELECT * FROM users WHERE id = :userId',
 *   { userId: 123 },
 *   'default_db'
 * );
 *
 * if (loading && !data) return <Spinner />;
 * if (error) return <Error message={error} />;
 * if (!data) return <NoData />;
 *
 * return (
 *   <>
 *     {isStale && <Badge>Refetching...</Badge>}
 *     <Table data={data} />
 *   </>
 * );
 * ```
 */
export function useQueryResult(
  query: string,
  params: Record<string, any>,
  database: string,
  references?: QuestionReference[],
  options: UseQueryResultOptions = {}
): UseQueryResultReturn {
//   console.log('Executing query', options.skip, query)
  const { ttl = CACHE_TTL.QUERY, skip = false } = options;

  // Select result from Redux
  const result = useAppSelector(state => selectQueryResult(state, query, params, database));

  // Check if result exists and is fresh
  const hasData = useAppSelector(state => selectHasQueryData(state, query, params, database));
  const isFresh = useAppSelector(state => selectIsQueryFresh(state, query, params, database, ttl));

  // Determine if we need to fetch
  // Don't auto-fetch if there's an error (user must explicitly refetch)
  const hasError = result?.error != null;
  const needsFetch = !skip && !hasError && (!hasData || !isFresh);

  // Determine loading state
  const loading = result?.loading || false;

  // Determine isStale: has data but fetching new data
  const isStale = hasData && loading;

  // Effect: Execute query if needed
  // IMPORTANT: Don't use useCallback for executeQuery - inline it to prevent re-execution on edits
  useEffect(() => {
    console.log('[useQueryResult] Checking if query needs fetch:', { needsFetch, hasData, isFresh, loading, error: result?.error });
    if (!needsFetch) return;

    // Skip if already loading
    if (loading) return;

    console.log('[useQueryResult] Executing query:', query.substring(0, 60) + '...');

    // Execute query inline (no callback dependency issues)
    (async () => {
      try {
        await getQueryResult({
          query,
          params,
          database,
          references
        }, { ttl });
      } catch (error) {
        console.error('[useQueryResult] Query execution failed:', error);
        // Error is already stored in Redux by getQueryResult
      }
    })();
  }, [needsFetch, loading, query, params, database, references, ttl]);

  // Manual refetch function
  const refetch = useCallback(async () => {
    try {
      await getQueryResult({ query, params, database, references }, { ttl });
    } catch (error) {
      console.error('[useQueryResult] Manual refetch failed:', error);
    }
  }, [query, params, database, references, ttl]);

  return {
    data: result?.data || null,
    loading,
    error: result?.error || null,
    isStale,
    refetch
  };
}


// ============================================================================
// useAppState Hook
// ============================================================================

/**
 * useAppState Hook
 *
 * Returns current page context (file or folder) derived from Redux navigation state.
 * All business logic (URL parsing, file loading, virtual file creation) lives in
 * navigationSlice + navigationListener — this hook is a pure selector.
 *
 * Usage:
 * ```typescript
 * const { appState, loading } = useAppState();
 *
 * if (appState?.type === "file") {
 *   // Access appState.file (already augmented FileState)
 * } else if (appState?.type === "folder") {
 *   // Access appState.folder.files
 * }
 * ```
 */
export function useAppState(): { appState: AppState | null; loading: boolean } {
  return useAppSelector(selectAppState, shallowEqual);
}
