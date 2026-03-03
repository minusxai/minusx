import { createSelector } from '@reduxjs/toolkit';
import type { RootState } from './store';
import type { FileState } from './filesSlice';
import type { AppState } from '@/lib/appState';
import { isHiddenSystemPath } from '@/lib/mode/path-resolver';
import { selectAugmentedFiles, compressAugmentedFile } from '@/lib/api/file-state';
import { computePathState } from './navigationSlice';

/**
 * selectAppState — derives AppState + loading from Redux.
 *
 * Extracted from navigationSlice to break the circular dependency:
 *   navigationSlice → file-state → store → navigationSlice
 *
 * Memoized via createSelector; only recomputes when relevant inputs change.
 */
export const selectAppState = createSelector(
  (state: RootState) => state.navigation.pathname,
  (state: RootState) => state.navigation.searchParams,
  (state: RootState) => state.navigation.activeVirtualId,
  (state: RootState) => state.files.files,
  (state: RootState) => state.files.pathIndex,
  (state: RootState) => state.auth.user,
  (state: RootState) => state.queryResults.results,
  (
    pathname,
    searchParams,
    activeVirtualId,
    filesState,
    pathIndex,
    user,
    queryResultsMap
  ): { appState: AppState | null; loading: boolean } => {
    const pathState = computePathState(pathname, searchParams, activeVirtualId, user);

    // Minimal partial state for selectAugmentedFiles — it only reads files.files and queryResults.results
    const partialState = { files: { files: filesState }, queryResults: { results: queryResultsMap } } as RootState;

    if (pathState.type === 'file') {
      const file = filesState[pathState.id];
      if (!file) return { appState: null, loading: true };
      const [augmented] = selectAugmentedFiles(partialState, [pathState.id]);
      if (!augmented) return { appState: null, loading: true };
      return {
        appState: { type: 'file', state: compressAugmentedFile(augmented) },
        loading: file.loading || false,
      };
    }

    if (pathState.type === 'newFile') {
      const virtualId = pathState.createOptions.virtualId;
      if (virtualId !== undefined && filesState[virtualId]) {
        const file = filesState[virtualId];
        const [augmented] = selectAugmentedFiles(partialState, [virtualId]);
        if (!augmented) return { appState: null, loading: true };
        return {
          appState: { type: 'file', state: compressAugmentedFile(augmented) },
          loading: file.loading || false,
        };
      }
      // If virtualId is defined but not in Redux yet, still loading.
      // If virtualId is undefined (cleared after error or not yet assigned), stop loading.
      return { appState: null, loading: virtualId !== undefined };
    }

    if (pathState.type === 'folder') {
      const mode = user?.mode || 'org';
      const folderId = pathIndex[pathState.path];
      const folder = folderId !== undefined ? filesState[folderId] : undefined;

      if (!folder) {
        return {
          appState: {
            type: 'folder',
            state: { files: [], loading: true, error: null },
          },
          loading: true,
        };
      }

      const files = (folder.references || [])
        .map(id => filesState[id])
        .filter((f): f is FileState => {
          if (!f) return false;
          if (f.type === 'folder' && isHiddenSystemPath(f.path, mode)) return false;
          return true;
        });

      const folderLoading = folder.loading ?? false;
      return {
        appState: {
          type: 'folder',
          state: {
            files,
            loading: folderLoading,
            error: folder.loadError?.message ?? null,
          },
        },
        loading: folderLoading,
      };
    }

    if (pathState.type === 'explore') {
      return {
        appState: { type: 'explore', state: null },
        loading: false,
      };
    }

    return { appState: null, loading: false };
  }
);
