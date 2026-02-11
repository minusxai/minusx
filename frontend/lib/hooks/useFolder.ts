import { useEffect, useMemo, useState, useRef } from 'react';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import {
  setFolderInfo,
  setFileInfo,
  setLoading,
  selectFileIdByPath,
  selectFile,
  selectIsFolderFresh,
  selectFiles
} from '@/store/filesSlice';
import { selectEffectiveUser } from '@/store/authSlice';
import { getFiles } from '@/lib/data/files';
import { canViewFileType } from '@/lib/auth/access-rules.client';
import { isHiddenSystemPath } from '@/lib/mode/path-resolver';
import { DEFAULT_MODE } from '@/lib/mode/mode-types';
import type { FileState } from '@/store/filesSlice';
import type { LoadError } from '@/lib/types/errors';
import { createLoadErrorFromException } from '@/lib/types/errors';
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
 * useFolder Hook - Simplified with Role-Based Filtering
 *
 * Loads children of a folder with TTL caching and automatically filters
 * files based on the current user's permissions.
 *
 * @param path - Folder path (e.g., '/org', '/team')
 * @param options - Hook options (depth, ttl)
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
  const dispatch = useAppDispatch();

  // Track error locally (not in Redux)
  const [error, setError] = useState<LoadError | null>(null);
  const [failedPath, setFailedPath] = useState<string | null>(null);

  // Reset error when path changes
  const prevPathRef = useRef(path);
  if (prevPathRef.current !== path) {
    prevPathRef.current = path;
    setError(null);
    setFailedPath(null);
  }

  // Look up folder ID by path
  const folderId = useAppSelector(state => selectFileIdByPath(state, path));

  // Get folder file
  const folder = useAppSelector(state => folderId ? selectFile(state, folderId) : undefined);

  // Check if folder is fresh
  const isFresh = useAppSelector(state => selectIsFolderFresh(state, path, ttl));

  // Check if this specific path failed to load
  const hasError = path === failedPath && error !== null;

  // Get effective user for permission filtering
  const effectiveUser = useAppSelector(selectEffectiveUser);

  // Get child files from folder.references
  const childIds = folder?.references || [];
  const allFiles = useAppSelector(state => selectFiles(state, childIds));

  // Filter files based on user permissions and hidden system paths
  const mode = effectiveUser?.mode || DEFAULT_MODE;
  const files = useMemo(() => {
    return allFiles.filter(file => {
      // Filter by role-based type permissions
      if (!canViewFileType(effectiveUser?.role || 'viewer', file.type)) {
        return false;
      }
      // Filter out hidden system folders (they have special views)
      if (file.type === 'folder' && isHiddenSystemPath(file.path, mode)) {
        return false;
      }
      return true;
    });
  }, [allFiles, effectiveUser?.role, mode]);

  // Effect: Load folder if not fresh (or if forceLoad is true)
  useEffect(() => {
    // If fresh AND not forcing, skip
    if (isFresh && !forceLoad) return;

    // If already loading, skip
    if (folder?.loading) return;

    // Don't retry if we already failed for this path
    if (hasError) return;

    // Clear any previous error
    setError(null);
    setFailedPath(null);

    // Start loading (create folder entry if needed, handled by setFolderInfo)
    if (folderId) {
      dispatch(setLoading({ id: folderId, loading: true }));
    }

    // Fetch folder contents
    getFiles({ paths: [path], depth })
      .then(response => {
        // Store folder file itself (for pathIndex)
        if (response.metadata.folders.length > 0) {
          dispatch(setFileInfo(response.metadata.folders));
        }

        // Store children and update folder.references
        dispatch(setFolderInfo({ path, fileInfos: response.data }));
      })
      .catch(err => {
        console.error(`[useFolder] Failed to load folder ${path}:`, err);

        // Store structured error in local state
        const loadError = createLoadErrorFromException(err);
        setError(loadError);
        setFailedPath(path);

        if (folderId) {
          dispatch(setLoading({ id: folderId, loading: false }));
        }
      });
  }, [isFresh, forceLoad, folder?.loading, hasError, folderId, path, depth, dispatch]);

  return {
    files,
    loading: !isFresh || folder?.loading === true,
    error
  };
}
