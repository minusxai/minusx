import { useAppSelector } from '@/store/hooks';
import { selectFile, isVirtualFileId, type FileId } from '@/store/filesSlice';
import type { FileState } from '@/store/filesSlice';
import type { LoadError } from '@/lib/types/errors';
import { CACHE_TTL } from '@/lib/constants/cache';
import { useFiles } from './useFiles';

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

  // For virtual files: show loading if file doesn't exist in Redux yet
  // This prevents the flash of "File not found" on first render
  const effectiveLoading = loading || Boolean(id && isVirtualFileId(id) && !file);

  return {
    file,
    loading: effectiveLoading,
    saving,
    error
  };
}
