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

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { shallowEqual } from 'react-redux';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import {
  selectFile,
  selectFiles,
  selectMergedContent,
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
  getAppState,
  stripFileContent,
  selectAugmentedFiles
} from '@/lib/api/file-state';
import type { AppState } from '@/lib/appState';
import { FilesAPI } from '@/lib/data/files';
import { CACHE_TTL } from '@/lib/constants/cache';
import type { LoadError } from '@/lib/types/errors';
import { createLoadErrorFromException } from '@/lib/types/errors';
import { resolveHomeFolderSync, isHiddenSystemPath } from '@/lib/mode/path-resolver';
import { canViewFileType } from '@/lib/auth/access-rules.client';
import type { GetFilesOptions } from '@/lib/data/types';
import type { AugmentedFiles, QuestionReference, QueryResult } from '@/lib/types';
import { FileType } from '@/lib/ui/file-metadata';

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
 * useAugmentedFiles - Pure reactive selector hook for augmented file data
 *
 * Selects files + references + query results from Redux using selectAugmentedFiles.
 * No side-effects, no fetching — pair with useFiles (or readFiles) to ensure data is loaded.
 *
 * Re-renders only when fileStates, references, or queryResults change by shallow equality.
 */
export function useAugmentedFiles(fileIds: number[]): AugmentedFiles {
  return useAppSelector(
    state => selectAugmentedFiles(state, fileIds),
    (a, b) =>
      shallowEqual(a.fileStates, b.fileStates) &&
      shallowEqual(a.references, b.references) &&
      shallowEqual(a.queryResults, b.queryResults)
  );
}

/**
 * useFiles - Load files by IDs, returns full AugmentedFiles (fileStates + references + queryResults)
 *
 * Triggers fetch via readFiles (which stores results in Redux), then returns
 * the reactive selection via useAugmentedFiles.
 *
 * Usage:
 * ```typescript
 * const { fileStates, references, queryResults } = useFiles({ ids: [1, 2, 3] });
 * ```
 */
export function useFiles(options: UseFilesOptions): AugmentedFiles {
  const { ids, ttl = 60000, skip = false } = options;

  // Stable key from options for dependency tracking
  const optionsKey = useMemo(
    () => JSON.stringify({ ids, ttl, skip }),
    [ids, ttl, skip]
  );

  // Trigger fetch — readFiles owns loading state in Redux
  useEffect(() => {
    if (skip || ids.length === 0) return;
    readFiles({ fileIds: ids }, { ttl, skip: false }).catch(() => {
      // Error already stored in Redux by readFiles
    });
  }, [optionsKey]);

  return useAugmentedFiles(ids);
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
 * loading, saving, and loadError are available directly on the returned FileState
 */
export type UseFileReturn = FileState | undefined;

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
export function useFile(id: FileId | undefined, options: UseFileOptions = {}): FileState | undefined {
  const { ttl = CACHE_TTL.FILE, skip = false } = options;

  // Virtual files (negative IDs) are pre-populated in Redux, so skip loading
  const shouldSkip = skip || (id !== undefined && isVirtualFileId(id));

  // Trigger fetch via useFiles — loading state is owned by Redux (file.loading)
  useFiles({
    ids: id !== undefined ? [id] : [],
    ttl,
    skip: shouldSkip
  });

  // Return FileState directly — consumers read file.loading, file.loadError, file.saving
  return useAppSelector(state => id ? selectFile(state, id) : undefined);
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

  // Trigger fetch — readFolder owns loading/error state in Redux
  useEffect(() => {
    readFolder(path, { depth, ttl, forceLoad }).catch(() => {
      // Error already stored in Redux by readFolder
    });
  }, [path, depth, ttl, forceLoad]);

  // Derive all state from Redux — no local useState
  return useAppSelector(state => {
    const folderId = state.files.pathIndex[path];
    const folder = folderId ? state.files.files[folderId] : undefined;

    if (!folder) {
      return { files: [], loading: true, error: null };
    }

    const user = state.auth.user;
    const mode = user?.mode || 'org';
    const role = user?.role || 'viewer';

    const files = (folder.references || [])
      .map(id => state.files.files[id])
      .filter((f): f is FileState => {
        if (!f) return false;
        if (!canViewFileType(role, f.type)) return false;
        if (f.type === 'folder' && isHiddenSystemPath(f.path, mode)) return false;
        return true;
      });

    return {
      files,
      loading: folder.loading,
      error: folder.loadError
    };
  }, shallowEqual);
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
 * Watches navigation and returns current page context (file or folder).
 * Gets pathname from usePathname() and calls getAppState when it changes.
 *
 * Usage:
 * ```typescript
 * const appState = useAppState();
 *
 * if (appState?.type === "file") {
 *   // Access appState.file (already augmented FileState)
 * } else if (appState?.type === "folder") {
 *   // Access appState.folder.files
 * }
 * ```
 */
export function useAppState(): { appState: AppState | null; loading: boolean } {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const user = useAppSelector(state => state.auth.user);
  const filesState = useAppSelector(state => state.files.files);
  const queryResultsState = useAppSelector(state => state.queryResults.results);

  // Track created virtual file ID in local state
  const [createdVirtualId, setCreatedVirtualId] = useState<number | undefined>(undefined);

  // Parse URL params for new file pages
  const createOptions = useMemo(() => {
    if (!pathname.startsWith('/new/')) return undefined;

    const folderParam = searchParams.get('folder');
    const databaseParam = searchParams.get('databaseName'); // Match URL param name
    const queryB64 = searchParams.get('queryB64'); // Match URL param name
    const virtualIdParam = searchParams.get('virtualId');

    const query = queryB64
      ? new TextDecoder().decode(Uint8Array.from(atob(queryB64), c => c.charCodeAt(0)))
      : undefined;

    const folder = folderParam || (user ? resolveHomeFolderSync(user.mode, user.home_folder || '') : '/org');

    const virtualId = virtualIdParam ? parseInt(virtualIdParam, 10) : undefined;
    const validVirtualId = virtualId && !isNaN(virtualId) && virtualId < 0 ? virtualId : undefined;

    return {
      folder,
      databaseName: databaseParam || undefined,
      query,
      virtualId: validVirtualId
    };
  }, [pathname, searchParams, user]);

  // Clear created virtual ID when route changes
  useEffect(() => {
    setCreatedVirtualId(undefined);
  }, [pathname]);

  // Determine route type from pathname
  const routeInfo = useMemo(() => {
    // File page: /f/{id}
    const fileMatch = pathname.match(/^\/f\/(\d+)/);
    if (fileMatch) {
      return { type: 'file' as const, id: parseInt(fileMatch[1], 10) };
    }

    // New file page: /new/{type}
    const newFileMatch = pathname.match(/^\/new\/([^/?]+)/);
    if (newFileMatch) {
      return { type: 'newFile' as const, fileType: newFileMatch[1] as FileType };
    }

    // Folder page: /p/path
    const folderMatch = pathname.match(/^\/p\/(.*)/);
    if (folderMatch) {
      return { type: 'folder' as const, path: '/' + (folderMatch[1] || '') };
    }

    return { type: null };
  }, [pathname]);

  // Initialize: Load files from DB, create virtual files
  useEffect(() => {
    let cancelled = false;

    const initialize = async () => {
      if (routeInfo.type === 'file' && routeInfo.id > 0) {
        // Load from DB if positive ID
        await readFiles({ fileIds: [routeInfo.id] });
      } else if (routeInfo.type === 'newFile') {
        // Check if virtual file exists (from URL or local state)
        const virtualId = createOptions?.virtualId || createdVirtualId;
        const existingFile = virtualId ? filesState[virtualId] : null;

        if (!existingFile) {
          // Create new virtual file and store its ID
          const newVirtualId = await createVirtualFile(routeInfo.fileType, createOptions);
          setCreatedVirtualId(newVirtualId);
        }
      } else if (routeInfo.type === 'folder') {
        await readFolder(routeInfo.path);
      }
    };

    initialize();

    return () => {
      cancelled = true;
    };
  }, [routeInfo, createOptions, filesState, createdVirtualId]);

  // Compute appState from Redux (reactive to state changes - NO LOCAL STATE!)
  return useMemo(() => {
    if (routeInfo.type === 'file') {
      const file = filesState[routeInfo.id];

      // File doesn't exist in Redux yet - might be loading or doesn't exist
      if (!file) {
        return { appState: null, loading: true };
      }

      // File exists - check if it's still loading
      const loading = file.loading || false;

      // Get referenced files from Redux (file.references contains IDs)
      const references = (file.references || [])
        .map(id => filesState[id])
        .filter(Boolean) as FileState[];

      const queryResults: QueryResult[] = [];

      return {
        appState: {
          type: 'file',
          id: routeInfo.id,
          fileType: file.type,
          file,
          references,
          queryResults
        },
        loading
      };
    }

    if (routeInfo.type === 'newFile') {
      // Use virtualId from URL, or fallback to created ID from local state
      const virtualId = createOptions?.virtualId || createdVirtualId;
      if (virtualId && filesState[virtualId]) {
        const file = filesState[virtualId];
        return {
          appState: {
            type: 'file',
            id: virtualId,
            fileType: file.type,
            file,
            references: [],
            queryResults: []
          },
          loading: false
        };
      }

      // No virtual file yet (initialization in progress)
      return { appState: null, loading: true };
    }

    if (routeInfo.type === 'folder') {
      const mode = user?.mode || 'org';
      const folderFiles = stripFileContent(
        Object.values(filesState).filter(f => {
          const fileDir = f.path.substring(0, f.path.lastIndexOf('/')) || '/';
          if (fileDir !== routeInfo.path) return false;
          // Hide system folders (e.g., /org/database, /org/logs)
          if (f.type === 'folder' && isHiddenSystemPath(f.path, mode)) return false;
          return true;
        })
      );

      return {
        appState: {
          type: 'folder',
          path: routeInfo.path,
          folder: {
            files: folderFiles,
            loading: false,
            error: null
          }
        },
        loading: false
      };
    }

    return { appState: null, loading: false };
  }, [routeInfo, filesState, queryResultsState, createOptions]);
}
