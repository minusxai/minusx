import { useEffect, useState } from 'react';
import { readFolder } from '@/lib/api/file-state';
import type { FileState } from '@/store/filesSlice';
import type { LoadError } from '@/lib/types/errors';
import { CACHE_TTL } from '@/lib/constants/cache';

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
