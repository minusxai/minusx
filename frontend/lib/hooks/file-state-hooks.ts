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
 * - useNewFile - Create a virtual file for create mode
 * - useQueryResult - Execute queries with TTL caching
 */

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import {
  selectFile,
  selectFiles,
  isVirtualFileId,
  setFiles,
  setFile,
  setLoading,
  type FileId,
  type FileState
} from '@/store/filesSlice';
import {
  selectQueryResult,
  selectIsQueryFresh,
  selectHasQueryData
} from '@/store/queryResultsSlice';
import {
  readFiles,
  readFilesByCriteria,
  readFolder,
  getQueryResult,
  createVirtualFile,
  getAppState
} from '@/lib/api/file-state';
import { FilesAPI } from '@/lib/data/files';
import { CACHE_TTL } from '@/lib/constants/cache';
import type { LoadError } from '@/lib/types/errors';
import { createLoadErrorFromException } from '@/lib/types/errors';
import type { GetFilesOptions } from '@/lib/data/types';
import type { QuestionReference } from '@/lib/types';
import { FileType } from '@/lib/ui/file-metadata';
import type { AppState } from '@/lib/appState';

// ============================================================================
// useFiles - Load multiple files by IDs
// ============================================================================

/**
 * Options for useFiles hook
 */
export interface UseFilesOptions {
  /** Load specific files by ID */
  ids: number[];
  /** Time-to-live for cache freshness (ms) */
  ttl?: number;
  /** Skip loading (for conditional fetching) */
  skip?: boolean;
}

/**
 * Return type for useFiles hook
 */
export interface UseFilesReturn {
  files: FileState[];
  loading: boolean;
  error: LoadError | null;
}

/**
 * useFiles - Simple hook for loading files by IDs
 *
 * Uses file-state.ts readFiles internally for consistent caching and augmentation.
 * For criteria-based queries (path, type, depth), use useFilesByCriteria instead.
 *
 * Usage:
 * ```typescript
 * // Load by IDs
 * const { files, loading, error } = useFiles({ ids: [1, 2, 3] });
 *
 * // With cache control
 * const { files, loading } = useFiles({
 *   ids: [1],
 *   ttl: 300000,
 *   skip: false
 * });
 * ```
 */
export function useFiles(options: UseFilesOptions): UseFilesReturn {
  const { ids, ttl = 60000, skip = false } = options;
  const dispatch = useAppDispatch();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<LoadError | null>(null);

  // Stable key from options for dependency tracking
  const optionsKey = useMemo(
    () => JSON.stringify({ ids, ttl, skip }),
    [ids, ttl, skip]
  );

  // Get existing files from Redux (memoized to prevent unnecessary re-renders)
  const allFiles = useAppSelector(state => state.files.files);
  const existingFiles = useMemo(() => {
    return ids
      .map(id => allFiles[id])
      .filter((file): file is FileState => file !== undefined);
  }, [ids, allFiles]);

  // Main fetch effect
  useEffect(() => {
    if (skip || ids.length === 0) return;

    const fetchFiles = async () => {
      setLoading(true);
      setError(null);

      try {
        // Use file-state.ts for consistent caching and augmentation
        const result = await readFiles(
          { fileIds: ids },
          { ttl, skip: false }
        );

        // Update Redux with loaded files
        if (result.fileStates && result.fileStates.length > 0) {
          dispatch(setFiles({ files: result.fileStates }));
        }
      } catch (err) {
        console.error('[useFiles] Failed to fetch:', err);
        setError(err as LoadError);
      } finally {
        setLoading(false);
      }
    };

    fetchFiles();
  }, [optionsKey, dispatch]);

  return {
    files: existingFiles,
    loading,
    error
  };
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
 * Return type for useFile hook
 */
export interface UseFileReturn {
  file: FileState | undefined;
  loading: boolean;
  saving: boolean;
  error: LoadError | null;
}

/**
 * useFile Hook - Phase 3 (Simplified)
 *
 * Purely reactive hook that loads a file by ID. No methods - components use
 * file-state.ts exports directly for mutations (editFile, publishFile, reloadFile, clearFileChanges).
 *
 * Uses useFiles internally for consistent caching and augmentation.
 *
 * @param id - File ID (positive number for real files, negative number for virtual files)
 * @param options - Hook options (ttl, skip)
 * @returns {file, loading, saving, error}
 *
 * Example:
 * ```tsx
 * import { editFile, publishFile, reloadFile, clearFileChanges } from '@/lib/api/file-state';
 *
 * function FileComponent({ fileId }: { fileId: FileId }) {
 *   const { file, loading, saving } = useFile(fileId);
 *
 *   if (loading) return <Spinner />;
 *   if (!file) return <NotFound />;
 *
 *   // Use file-state.ts exports directly
 *   const handleEdit = () => {
 *     editFile({ fileId, changes: { content: { query: 'SELECT 1' } } });
 *   };
 *
 *   const handleSave = async () => {
 *     const result = await publishFile({ fileId });
 *     router.push(`/f/${result.id}`);
 *   };
 *
 *   return <FileContent file={file} onEdit={handleEdit} onSave={handleSave} />;
 * }
 * ```
 */
export function useFile(id: FileId | undefined, options: UseFileOptions = {}): UseFileReturn {
  const { ttl = CACHE_TTL.FILE, skip = false } = options;

  // Virtual files (negative IDs) are pre-populated in Redux, so skip loading
  const shouldSkip = skip || (id !== undefined && isVirtualFileId(id));

  // Use useFiles internally for consistent loading logic
  const { files, loading, error } = useFiles({
    ids: id !== undefined ? [id] : [],
    ttl,
    skip: shouldSkip
  });

  // Extract the single file from the array
  const file = useAppSelector(state => id ? selectFile(state, id) : undefined);

  // Get saving state from Redux
  const saving = file?.saving || false;

  // Show loading if file doesn't exist in Redux yet (prevents flash of 404)
  // This applies to both real and virtual files on first render
  const effectiveLoading = loading || Boolean(id && !file);

  return {
    file,
    loading: effectiveLoading,
    saving,
    error
  };
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
 * Check if a file is stale based on TTL
 */
function isFileStale(file: FileState, ttl: number = 60000): boolean {
  return Date.now() - file.updatedAt > ttl;
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
  const dispatch = useAppDispatch();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [reloadCounter, setReloadCounter] = useState(0);

  // Stable key from options for dependency tracking
  const optionsKey = useMemo(
    () => JSON.stringify({ criteria, partial, ttl, skip }),
    [criteria, partial, ttl, skip]
  );

  // Get existing files from Redux (memoized to prevent unnecessary re-renders)
  const allFiles = useAppSelector(state => state.files.files);
  const existingFiles = useMemo(() => {
    return Object.values(allFiles).filter(file => {
      if (criteria.type && file.type !== criteria.type) return false;
      if (criteria.paths) {
        return criteria.paths.some(path => file.path.startsWith(path));
      }
      return true;
    });
  }, [criteria, allFiles]);

  // Main fetch effect
  useEffect(() => {
    if (skip) return;

    const fetchFiles = async () => {
      setLoading(true);
      setError(null);

      try {
        // Check if we need to fetch
        const needsFetch =
          reloadCounter > 0 ||
          existingFiles.length === 0 ||
          existingFiles.some(file => isFileStale(file, ttl));

        if (needsFetch) {
          // Use file-state.ts for consistent caching and augmentation
          const result = await readFilesByCriteria({
            criteria,
            partial,
            skip: false
          });

          // Update Redux with loaded files
          if (result.fileStates && result.fileStates.length > 0) {
            dispatch(setFiles({ files: result.fileStates }));
          }
        }
      } catch (err) {
        console.error('[useFilesByCriteria] Failed to fetch:', err);
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        setLoading(false);
      }
    };

    fetchFiles();
  }, [optionsKey, reloadCounter, dispatch]);

  return {
    files: existingFiles,
    loading,
    error
  };
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
  file: FileState | undefined;
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
  const dispatch = useAppDispatch();

  // Track error and loaded file ID locally
  const [error, setError] = useState<LoadError | null>(null);
  const [loadedFileId, setLoadedFileId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Reset state when path changes
  const prevPathRef = useRef(path);
  if (prevPathRef.current !== path) {
    prevPathRef.current = path;
    setError(null);
    setLoadedFileId(null);
    setIsLoading(false);
  }

  // Select file from Redux (if we've loaded it before)
  const file = useAppSelector(state => loadedFileId ? selectFile(state, loadedFileId) : undefined);

  // Determine if we need to fetch
  const needsFetch = !skip && !!path && !loadedFileId && !error && !isLoading;

  // Effect: Load file if needed
  useEffect(() => {
    if (!needsFetch) return;

    setIsLoading(true);
    setError(null);

    // Fetch file by path
    FilesAPI.loadFileByPath(path!)
      .then(response => {
        const { data: file } = response;

        // Store in Redux by ID
        dispatch(setFile({ file, references: [] }));

        // Track the file ID so we can find it in Redux
        setLoadedFileId(file.id);
        setIsLoading(false);
      })
      .catch(err => {
        console.error(`[useFileByPath] Failed to load file at ${path}:`, err);

        // Store structured error in local state
        const loadError = createLoadErrorFromException(err);
        setError(loadError);
        setIsLoading(false);
      });
  }, [needsFetch, path, dispatch]);

  return {
    file,
    loading: isLoading || (!file && needsFetch),
    error
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

  const [files, setFiles] = useState<FileState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<LoadError | null>(null);

  // Effect: Load folder using readFolder from file-state.ts
  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError(null);

    readFolder(path, { depth, ttl, forceLoad })
      .then(result => {
        if (!cancelled) {
          setFiles(result.files);
          setLoading(result.loading);
          setError(result.error);
        }
      })
      .catch(err => {
        console.error(`[useFolder] Failed to load folder ${path}:`, err);
        if (!cancelled) {
          setFiles([]);
          setLoading(false);
          // Convert to LoadError
          const loadError: LoadError = {
            message: err instanceof Error ? err.message : String(err),
            code: 'SERVER_ERROR'
          };
          setError(loadError);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [path, depth, ttl, forceLoad]);

  return {
    files,
    loading,
    error
  };
}

// ============================================================================
// useNewFile - Create virtual file for create mode
// ============================================================================

/**
 * Options for creating a new file
 */
export interface NewFileOptions {
  /** Folder path override (defaults to user's home_folder) */
  folder?: string;
  /** For questions: pre-populate with this database/connection name */
  databaseName?: string;
  /** For questions: pre-populate with this SQL query */
  query?: string;
  virtualId?: number;
}

/**
 * useNewFile Hook - Phase 3 (Simplified)
 *
 * Creates and initializes a virtual file for "create mode" in the file editor.
 * Uses createVirtualFile from file-state.ts internally.
 *
 * Virtual files use negative IDs (-Date.now()) to distinguish them from real files.
 *
 * @param type - The type of file to create (question, dashboard, etc.)
 * @param options - Optional configuration (folder, connection, query)
 * @returns Virtual file ID (negative number)
 *
 * Example:
 * ```tsx
 * function NewFilePage({ params }: { params: { type: string } }) {
 *   const virtualFileId = useNewFile(params.type as FileType, { folder: '/org/sales' });
 *   return <FileView fileId={virtualFileId} mode="create" />;
 * }
 *
 * // Pre-populate a question with SQL
 * const virtualFileId = useNewFile('question', {
 *   folder: '/org',
 *   databaseName: 'my_db',
 *   query: 'SELECT * FROM users LIMIT 100'
 * });
 * ```
 */
export function useNewFile(type: FileType, options?: NewFileOptions): number {
  // Generate stable virtual ID
  const virtualId = useMemo(() => {
    if (options?.virtualId && options.virtualId < 0) {
      return options.virtualId;
    }
    return -Date.now();
  }, [options?.virtualId]);

  // Track initialization state
  const [initialized, setInitialized] = useState(false);

  // Create virtual file on mount
  useEffect(() => {
    if (initialized) return;
    setInitialized(true);

    createVirtualFile(type, {
      folder: options?.folder,
      databaseName: options?.databaseName,
      query: options?.query,
      virtualId
    }).catch(err => {
      console.error('[useNewFile] Failed to create virtual file:', err);
    });
  }, [initialized, type, options?.folder, options?.databaseName, options?.query, virtualId]);

  return virtualId;
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
    if (!needsFetch) return;

    // Skip if already loading
    if (loading) return;

    // Execute query inline (no callback dependency issues)
    (async () => {
      try {
        await getQueryResult({
          query,
          params,
          database
        }, { ttl });
      } catch (error) {
        console.error('[useQueryResult] Query execution failed:', error);
        // Error is already stored in Redux by getQueryResult
      }
    })();
  }, [needsFetch, loading, query, params, database, ttl]);

  // Manual refetch function
  const refetch = useCallback(async () => {
    try {
      await getQueryResult({ query, params, database }, { ttl });
    } catch (error) {
      console.error('[useQueryResult] Manual refetch failed:', error);
    }
  }, [query, params, database, ttl]);

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
 * Replaces selectAppState selector with async file loading.
 * Loads file and builds augmented AppState (Question/Dashboard/Report/etc.)
 *
 * Usage:
 *   const appState = useAppState(fileId);
 *   if (appState?.pageType === 'question') {
 *     // Access appState.queryData, etc.
 *   }
 */
export function useAppState(fileId: number | undefined): AppState | undefined {
  const [appState, setAppState] = useState<AppState | undefined>(undefined);

  useEffect(() => {
    if (fileId === undefined) {
      setAppState(undefined);
      return;
    }

    let cancelled = false;

    getAppState(fileId)
      .then(result => {
        if (!cancelled) {
          setAppState(result);
        }
      })
      .catch(err => {
        console.error('useAppState error:', err);
        if (!cancelled) {
          setAppState(undefined);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [fileId]);

  return appState;
}
