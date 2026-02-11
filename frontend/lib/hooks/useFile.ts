import { useEffect, useCallback, useState, useRef } from 'react';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import {
  setFile,
  setLoading,
  setEdit,
  clearEdits,
  setSaving,
  updateFileContent,
  selectFile,
  selectIsFileFresh,
  selectIsFileLoaded,
  isVirtualFileId,
  addFile,
  setMetadataEdit,
  clearMetadataEdits,
  selectEffectiveName,
  selectEffectivePath,
  type FileId
} from '@/store/filesSlice';
import { FilesAPI } from '@/lib/data/files';
import { slugify } from '@/lib/slug-utils';
import type { FileState } from '@/store/filesSlice';
import type { DbFile } from '@/lib/types';
import type { LoadError } from '@/lib/types/errors';
import { createLoadErrorFromException } from '@/lib/types/errors';
import { CACHE_TTL } from '@/lib/constants/cache';

/**
 * Options for useFile hook
 */
export interface UseFileOptions {
  ttl?: number;      // Time-to-live in ms (default: CACHE_TTL.FILE = 10 hours)
  skip?: boolean;    // Skip loading (for conditional use)
}

/**
 * Result of save operation
 */
export interface SaveResult {
  id: number;
  name: string;
}

/**
 * Return type for useFile hook
 */
export interface UseFileReturn {
  file: FileState | undefined;
  loading: boolean;
  saving: boolean;  // Phase 2: Track save operations
  error: LoadError | null;

  // Phase 2: Edit/save/reload/cancel methods
  edit: (changes: Partial<DbFile['content']>) => void;
  editMetadata: (changes: { name?: string; path?: string }) => void; // Phase 5: Metadata editing
  save: () => Promise<SaveResult | undefined>; // Returns { id, name } for redirect logic
  reload: (skipLoading?: boolean) => void; // skipLoading: true for silent background refresh
  cancel: () => void; // Discard local changes without reloading
}

/**
 * useFile Hook - Phase 2 Implementation
 *
 * Loads a file by ID with automatic TTL-based caching and reference loading.
 * Implements Core Patterns architecture.
 *
 * @param id - File ID (positive number for real files, negative number for virtual files)
 * @param options - Hook options (ttl, skip)
 * @returns {file, loading, error, edit, save, reload}
 *
 * Behavior:
 * 1. Checks if file exists in Redux and is fresh (within TTL)
 * 2. If fresh, returns immediately without fetching
 * 3. If stale/missing, fetches file + references from API (only for positive IDs)
 * 4. Virtual files (negative IDs) are assumed to be pre-populated in Redux
 * 5. Updates Redux with file + all referenced files
 * 6. Sets loading state during fetch
 *
 * Example:
 * ```tsx
 * function FileComponent({ fileId }: { fileId: FileId }) {
 *   const { file, loading, error } = useFile(fileId);
 *
 *   if (loading) return <Spinner />;
 *   if (error) return <Error message={error} />;
 *   if (!file) return <NotFound />;
 *
 *   return <FileContent file={file} />;
 * }
 * ```
 *
 * Note: This hook uses useEffect internally - this is expected and follows
 * the standard pattern for data-fetching hooks. Components should NOT use
 * useEffect for data loading - they should use this hook instead.
 */
export function useFile(id: FileId | undefined, options: UseFileOptions = {}): UseFileReturn {
  const { ttl = CACHE_TTL.FILE, skip = false } = options;
  const dispatch = useAppDispatch();

  // Track error locally (not in Redux)
  const [error, setError] = useState<LoadError | null>(null);
  const [failedId, setFailedId] = useState<FileId | null>(null);

  // Reset error when ID changes
  const prevIdRef = useRef(id);
  if (prevIdRef.current !== id) {
    prevIdRef.current = id;
    setError(null);
    setFailedId(null);
  }

  // Select file from Redux
  const file = useAppSelector(state => id ? selectFile(state, id) : undefined);

  // Check if file is loaded and fresh
  const isLoaded = useAppSelector(state => id ? selectIsFileLoaded(state, id) : false);
  const isFresh = useAppSelector(state => id ? selectIsFileFresh(state, id, ttl) : false);

  // Check if this specific ID failed to load
  const hasError = id === failedId && error !== null;

  // Determine if we need to fetch
  // Virtual files (negative IDs) are pre-populated in Redux, so skip fetching
  // Don't retry if we already failed for this ID
  const needsFetch = !skip && !!id && !isVirtualFileId(id) && (!isLoaded || !isFresh) && !hasError;

  // Determine loading state
  // Return loading: true if we need to fetch OR if Redux says we're actively loading
  // For virtual files: show loading if file doesn't exist in Redux yet (prevents "File not found" flash)
  // This prevents the flash of "File not found" on first render
  const loading = needsFetch || file?.loading === true || Boolean(id && isVirtualFileId(id) && !file);

  // Effect: Load file if needed
  useEffect(() => {
    // Skip if we don't need to fetch
    if (!needsFetch) return;

    // Skip if already loading (check Redux state, not our computed loading flag)
    if (file?.loading === true) return;

    // Clear any previous error
    setError(null);
    setFailedId(null);

    // Set loading state
    dispatch(setLoading({ id, loading: true }));

    // Fetch file + references
    FilesAPI.loadFile(id)
      .then(response => {
        const { data: file, metadata: { references } } = response;
        dispatch(setFile({ file, references }));
      })
      .catch(err => {
        console.error(`[useFile] Failed to load file ${id}:`, err);

        // Store structured error in local state
        const loadError = createLoadErrorFromException(err);
        setError(loadError);
        setFailedId(id);

        dispatch(setLoading({ id, loading: false }));
      });

      // Note: We don't set loading to false here because setFile will do it
  }, [needsFetch, file?.loading, id, dispatch]);

  // Phase 2: Get saving state
  const saving = file?.saving || false;

  // Phase 2: Edit function - update persistableChanges in Redux
  const edit = useCallback((changes: Partial<DbFile['content']>) => {
    if (!id) return;
    dispatch(setEdit({ fileId: id, edits: changes }));
  }, [id, dispatch]);

  // Phase 5: Edit metadata function - update metadataChanges in Redux
  const editMetadata = useCallback((changes: { name?: string; path?: string }) => {
    if (!id) return;
    dispatch(setMetadataEdit({ fileId: id, changes }));
  }, [id, dispatch]);

  // Phase 2: Save function - persist changes to API
  const save = useCallback(async (): Promise<SaveResult | undefined> => {
    if (!id || !file) return;

    // Merge content with persistableChanges
    const mergedContent = {
      ...file.content,
      ...file.persistableChanges
    };

    // Phase 5: Use effective name/path (with metadata changes)
    const effectiveName = file.metadataChanges.name ?? file.name;
    const effectivePath = file.metadataChanges.path;

    dispatch(setSaving({ id, saving: true }));

    try {
      // Virtual file (create mode) - Use FilesAPI.createFile
      if (isVirtualFileId(id)) {
        // Construct path from effective name if not explicitly set
        const folderPath = file.path.substring(0, file.path.lastIndexOf('/')) || '/org';
        const slug = slugify(effectiveName);
        const newPath = effectivePath ?? `${folderPath}/${slug}`;

        // Phase 6: Extract references on client before sending to server
        const { extractReferencesFromContent } = await import('@/lib/data/helpers/extract-references');
        const references = extractReferencesFromContent(mergedContent, file.type);

        const result = await FilesAPI.createFile({
          name: effectiveName,
          path: newPath,
          type: file.type,
          content: mergedContent,
          references
        });

        const newFile = result.data;
        const newFileId = newFile.id;

        // Add new file to Redux and clear all edits
        dispatch(addFile(newFile));
        dispatch(clearEdits(newFileId));
        dispatch(clearMetadataEdits(newFileId));

        return { id: newFileId, name: newFile.name }; // Return id and name for redirect
      }

      // Real file (edit mode) - Use FilesAPI.saveFile
      // Construct path from effective name if not explicitly set
      const folderPath = file.path.substring(0, file.path.lastIndexOf('/')) || '/org';
      const slug = slugify(effectiveName);
      const newPath = effectivePath ?? `${folderPath}/${slug}`;

      // Phase 6: Extract references on client before sending to server
      const { extractReferencesFromContent } = await import('@/lib/data/helpers/extract-references');
      const references = extractReferencesFromContent(mergedContent, file.type);

      const result = await FilesAPI.saveFile(id, effectiveName, newPath, mergedContent, references);
      dispatch(updateFileContent({ id, file: result.data }));
      dispatch(clearEdits(id));
      dispatch(clearMetadataEdits(id));
      return { id, name: result.data.name }; // Return id and name for redirect
    } catch (error) {
      console.error(`[useFile] Failed to save file ${id}:`, error);
      throw error; // Re-throw so container can handle
    } finally {
      dispatch(setSaving({ id, saving: false }));
    }
  }, [id, file, dispatch]);

  // Phase 2: Reload function - force refetch
  const reload = useCallback((skipLoading?: boolean, forceRefresh?: boolean) => {
    if (!id) return;

    // Skip reload for virtual files
    if (isVirtualFileId(id)) {
      console.warn('[useFile] Cannot reload virtual file.');
      return;
    }

    // Set loading state (unless skipLoading is true for silent background refresh)
    if (!skipLoading) {
      dispatch(setLoading({ id, loading: true }));
    }

    const options = forceRefresh ? { refresh: true } : undefined;

    FilesAPI.loadFile(id, undefined, options)
      .then(response => {
        const { data: file, metadata: { references } } = response;
        dispatch(setFile({ file, references }));
      })
      .catch(error => {
        console.error(`[useFile] Failed to reload file ${id}:`, error);
        if (!skipLoading) {
          dispatch(setLoading({ id, loading: false }));
        }
      });
  }, [id, dispatch]);

  // Phase 2: Cancel function - discard local changes without reloading
  const cancel = useCallback(() => {
    if (!id) return;
    dispatch(clearEdits(id));
    dispatch(clearMetadataEdits(id)); // Phase 5: Also clear metadata edits
  }, [id, dispatch]);

  return {
    file,
    loading,
    saving,
    error,
    edit,
    editMetadata,
    save,
    reload,
    cancel
  };
}
