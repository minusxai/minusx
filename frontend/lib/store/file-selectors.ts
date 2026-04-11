/**
 * Pure Redux selectors for files — no async, no side-effects.
 *
 * These selectors read from Redux state and return derived data. Pair them with
 * the async load functions in file-state.ts to ensure data is present first.
 *
 * Separated from file-state.ts so they can be imported on both client and server
 * without pulling in the full async machinery.
 */

import type { RootState } from '@/store/store';
import { selectFile, selectFileIdByPath, type FileState } from '@/store/filesSlice';
import { canViewFileType } from '@/lib/auth/access-rules.client';
import { isHiddenSystemPath } from '@/lib/mode/path-resolver';
import type { AugmentedFile, FileType } from '@/lib/types';
import type { LoadError } from '@/lib/types/errors';
import { getRootParams, buildEffectiveReference, augmentWithParams } from '@/lib/data/helpers/param-resolution';

// ============================================================================
// selectAugmentedFiles
// ============================================================================

// Simple per-key memoization cache: returns the same reference when state hasn't changed,
// which suppresses React Redux dev-mode "selector returned a different result" warnings.
// eslint-disable-next-line no-restricted-syntax -- client-side Redux memoization; keyed by fileIds, invalidated by state reference
const _augmentedFilesCache = new Map<string, { state: RootState; result: AugmentedFile[] }>();

/**
 * selectAugmentedFiles - Pure selector: read files + references + query results from Redux
 *
 * No async, no side-effects. Can be used in hooks via useSelector.
 * Pair with loadFiles() to ensure data is present.
 *
 * @param state - Redux state
 * @param fileIds - File IDs to select
 * @returns AugmentedFile[]
 */
export function selectAugmentedFiles(state: RootState, fileIds: number[]): AugmentedFile[] {
  const key = fileIds.join(',');
  const cached = _augmentedFilesCache.get(key);
  if (cached && cached.state === state) return cached.result;

  const result = fileIds
    .map(id => {
      const fileState = selectFile(state, id);
      if (!fileState) {
        if (id < 0) console.error(`[selectAugmentedFiles] Virtual file ${id} not found in Redux`);
        return undefined;
      }
      const references = (fileState.references || [])
        .map(refId => selectFile(state, refId))
        .filter((f): f is FileState => f !== undefined);

      // Collect query results: start with the root file's effective params and
      // let augmentWithParams cascade them through the entire reference tree.
      const inheritedParams = getRootParams(state, fileState);
      const queryResultMap = augmentWithParams(state, fileState, inheritedParams);

      const effectiveReferences = references.map(ref => buildEffectiveReference(ref, inheritedParams));
      return { fileState, references: effectiveReferences, queryResults: Array.from(queryResultMap.values()) };
    })
    .filter((a): a is AugmentedFile => a !== undefined);

  _augmentedFilesCache.set(key, { state, result });
  return result;
}

// ============================================================================
// selectAugmentedFolder
// ============================================================================

export interface AugmentedFolder {
  files: FileState[];
  loading: boolean;
  error: LoadError | null;
}

/**
 * selectAugmentedFolder - Pure selector: read folder children from Redux
 *
 * Maps folder references to FileState[], filters by user permissions and hidden paths.
 * No async, no side-effects. Pair with readFolder() to ensure data is loaded.
 *
 * @param state - Redux state
 * @param path - Folder path (e.g. '/org')
 * @returns AugmentedFolder
 */
export function selectAugmentedFolder(state: RootState, path: string): AugmentedFolder {
  const folderId = selectFileIdByPath(state, path);
  const folder = folderId ? selectFile(state, folderId) : undefined;

  if (!folder) return { files: [], loading: true, error: null };

  const user = state.auth.user;
  const mode = user?.mode || 'org';
  const role = user?.role || 'viewer';

  const files = (folder.references || [])
    .map(id => selectFile(state, id))
    .filter((f): f is FileState => {
      if (!f) return false;
      if (!canViewFileType(role, f.type)) return false;
      if (f.type === 'folder' && isHiddenSystemPath(f.path, mode)) return false;
      return true;
    });

  return { files, loading: folder.loading ?? false, error: folder.loadError ?? null };
}

// ============================================================================
// selectFilesByCriteria
// ============================================================================

/**
 * selectFilesByCriteria - Pure selector: filter files from Redux by criteria
 *
 * No async, no side-effects. Pair with readFilesByCriteria() to ensure data is loaded.
 * Uses startsWith for path matching (equivalent to unlimited depth), matching the
 * server-populated Redux state.
 *
 * @param state - Redux state
 * @param criteria - Filter criteria (type, paths)
 * @returns FileState[] matching criteria
 */
export function selectFilesByCriteria(
  state: RootState,
  criteria: { type?: FileType; paths?: string[] }
): FileState[] {
  return Object.values(state.files.files).filter(file => {
    if (criteria.type && file.type !== criteria.type) return false;
    if (criteria.paths) {
      return criteria.paths.some(path => file.path.startsWith(path));
    }
    return true;
  });
}

// ============================================================================
// selectFileByPath
// ============================================================================

/**
 * selectFileByPath - Pure selector: get a file by path from Redux
 *
 * @param state - Redux state
 * @param path - File path
 * @returns FileState if found, undefined otherwise
 */
export function selectFileByPath(state: RootState, path: string | null): FileState | undefined {
  if (!path) return undefined;
  const id = selectFileIdByPath(state, path);
  return id ? selectFile(state, id) : undefined;
}
