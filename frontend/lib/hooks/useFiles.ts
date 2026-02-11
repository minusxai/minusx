import { useEffect, useMemo, useCallback, useState } from 'react';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { setFiles } from '@/store/filesSlice';
import type { FileState } from '@/store/filesSlice';
import type { FileType } from '@/lib/types';
import { FilesAPI } from '@/lib/data/files';

/**
 * Options for querying files by criteria
 * Maps to GetFilesOptions from files.server.ts
 */
export interface GetFilesOptions {
  paths?: string[];
  type?: FileType;
  depth?: number;
}

/**
 * Options for useFiles hook
 */
export interface UseFilesOptions {
  /** Load specific files by ID */
  ids?: number[];
  /** Or query files by criteria */
  criteria?: GetFilesOptions;
  /** Time-to-live for cache freshness (ms) */
  ttl?: number;
  /** Skip loading (for conditional fetching) */
  skip?: boolean;
  /**
   * Partial loading (default: false)
   * - true: Only load metadata (fast, for lists/dropdowns)
   * - false: Fully load files with content (triggers loaders for schemas, etc.)
   */
  partial?: boolean;
}

/**
 * Return type for useFiles hook
 */
export interface UseFilesReturn {
  files: FileState[];
  loading: boolean;
  reload: () => void;
}

/**
 * Check if a file is stale based on TTL
 */
function isFileStale(file: FileState, ttl: number = 60000): boolean {
  return Date.now() - file.updatedAt > ttl;
}

/**
 * useFiles - Core primitive for file loading
 *
 * Handles all file operations: searching, loading, caching, TTL
 * All other file hooks should compose this.
 *
 * Usage:
 * ```typescript
 * // Load by IDs (always full load)
 * const { files, loading } = useFiles({ ids: [1, 2, 3] });
 *
 * // Query by criteria with full load (default, triggers loaders for schemas)
 * const { files, loading } = useFiles({
 *   criteria: { type: 'connection', depth: 1 },
 *   partial: false  // or omit (default)
 * });
 *
 * // Query by criteria with partial load (metadata only, fast)
 * const { files, loading } = useFiles({
 *   criteria: { type: 'context', depth: -1 },
 *   partial: true
 * });
 *
 * // With cache control
 * const { files, loading, reload } = useFiles({
 *   ids: [1],
 *   ttl: 300000,
 *   skip: false
 * });
 * ```
 */
export function useFiles(options: UseFilesOptions): UseFilesReturn {
  const { ids, criteria, ttl = 60000, skip = false, partial = false } = options;
  const dispatch = useAppDispatch();

  const [loading, setLoading] = useState(false);
  const [reloadCounter, setReloadCounter] = useState(0);

  // Stable key from options for dependency tracking
  const optionsKey = useMemo(
    () => JSON.stringify({ ids, criteria, ttl, skip, partial }),
    [ids, criteria, ttl, skip, partial]
  );

  // Get existing files from Redux (memoized to prevent unnecessary re-renders)
  const allFiles = useAppSelector(state => state.files.files);
  const existingFiles = useMemo(() => {
    if (ids) {
      return ids
        .map(id => allFiles[id])
        .filter((file): file is FileState => file !== undefined);
    } else if (criteria) {
      return Object.values(allFiles).filter(file => {
        if (criteria.type && file.type !== criteria.type) return false;
        if (criteria.paths) {
          return criteria.paths.some(path => file.path.startsWith(path));
        }
        return true;
      });
    }
    return [];
  }, [ids, criteria, allFiles]);

  // Main fetch effect - runs when options change or reload requested
  useEffect(() => {
    if (skip) return;

    const fetchFiles = async () => {
      setLoading(true);
      try {
        if (ids && ids.length > 0) {
          // Determine which IDs need loading (forced reload fetches all)
          const idsToLoad = reloadCounter > 0
            ? ids
            : ids.filter(id => {
                const file = existingFiles.find(f => f.id === id);
                if (!file) return true;
                if (file.loading === true) return false;
                if (!file.content) return true;
                return isFileStale(file, ttl);
              });

          if (idsToLoad.length > 0) {
            // Use FilesAPI for batch loading
            const result = await FilesAPI.loadFiles(idsToLoad);
            if (result.data && Array.isArray(result.data)) {
              dispatch(setFiles({ files: result.data }));
            }
          }
        } else if (criteria) {
          // For criteria queries, check if we need to fetch
          const needsFetch =
            reloadCounter > 0 ||
            existingFiles.length === 0 ||
            existingFiles.some(file => isFileStale(file, ttl));

          if (needsFetch) {
            // Step 1: Get files by criteria (metadata)
            const result = await FilesAPI.getFiles({
              paths: criteria.paths,
              type: criteria.type,
              depth: criteria.depth
            });

            if (result.data && Array.isArray(result.data)) {
              // If partial: true, stop here (metadata only)
              if (partial) {
                // Convert FileInfo[] to DbFile[] by adding content: null
                const partialFiles = result.data.map(fileInfo => ({
                  ...fileInfo,
                  content: null
                }));
                dispatch(setFiles({ files: partialFiles }));
              } else {
                // Step 2: Fully load files with content (triggers loaders)
                const fileIds = result.data.map(f => f.id);
                if (fileIds.length > 0) {
                  const fullResult = await FilesAPI.loadFiles(fileIds);
                  if (fullResult.data && Array.isArray(fullResult.data)) {
                    dispatch(setFiles({ files: fullResult.data }));
                  }
                }
              }
            }
          }
        }
      } catch (error) {
        console.error('[useFiles] Failed to fetch:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchFiles();
    // Note: existingFiles not in deps to avoid re-runs on Redux updates
    // Uses closure value when effect runs
  }, [optionsKey, reloadCounter, dispatch, partial]);

  // Reload function - increments counter to trigger refetch
  const reload = useCallback(() => {
    setReloadCounter(c => c + 1);
  }, []);

  return {
    files: existingFiles,
    loading,
    reload
  };
}
