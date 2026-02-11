import { useEffect, useState, useRef } from 'react';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import {
  setFile,
  setLoading,
  selectFile
} from '@/store/filesSlice';
import { FilesAPI } from '@/lib/data/files';
import type { FileState } from '@/store/filesSlice';
import type { LoadError } from '@/lib/types/errors';
import { createLoadErrorFromException } from '@/lib/types/errors';
import { CACHE_TTL } from '@/lib/constants/cache';

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
