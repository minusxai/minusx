import { useEffect, useMemo, useState } from 'react';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { setFiles } from '@/store/filesSlice';
import type { FileState } from '@/store/filesSlice';
import { readFiles } from '@/lib/api/file-state';
import type { LoadError } from '@/lib/types/errors';

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
