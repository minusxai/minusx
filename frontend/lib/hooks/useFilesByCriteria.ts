import { useEffect, useMemo, useCallback, useState } from 'react';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { setFiles } from '@/store/filesSlice';
import type { FileState } from '@/store/filesSlice';
import { readFilesByCriteria } from '@/lib/api/file-state';
import type { GetFilesOptions } from '@/lib/data/types';

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
