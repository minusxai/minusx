import { createSelector } from '@reduxjs/toolkit';
import type { RootState } from './store';
import type { FileState } from './filesSlice';
import type { AppState } from '@/lib/appState';
import { isHiddenSystemPath } from '@/lib/mode/path-resolver';
import { selectAugmentedFiles } from '@/lib/store/file-selectors';
import { compressAugmentedFile, APP_STATE_LIMIT_CHARS } from '@/lib/api/compress-augmented';
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
  (state: RootState) => state.files.files,
  (state: RootState) => state.files.pathIndex,
  (state: RootState) => state.auth.user,
  (state: RootState) => state.queryResults.results,
  (
    pathname,
    searchParams,
    filesState,
    pathIndex,
    user,
    queryResultsMap
  ): { appState: AppState | null; loading: boolean } => {
    const pathState = computePathState(pathname, searchParams);

    // Minimal partial state for selectAugmentedFiles — it only reads files.files and queryResults.results
    const partialState = { files: { files: filesState }, queryResults: { results: queryResultsMap } } as RootState;

    if (pathState.type === 'file') {
      const file = filesState[pathState.id];
      if (!file) return { appState: null, loading: true };
      const [augmented] = selectAugmentedFiles(partialState, [pathState.id]);
      if (!augmented) return { appState: null, loading: true };
      return {
        appState: { type: 'file', state: compressAugmentedFile(augmented, APP_STATE_LIMIT_CHARS) },
        loading: file.loading || false,
      };
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
        })
        .map(f => {
          // Strip parentSchema from context files in folder view — it's the parent's offering
          // before this context's own whitelist is applied, so it's only relevant when editing
          // the context file itself. In folder view the agent must only see the whitelisted schema.
          if (f.type === 'context' && f.content) {
            const { parentSchema: _ps, ...contentWithout } = f.content as any;
            return { ...f, content: contentWithout };
          }
          return f;
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

/**
 * Attaches ui.openModal to appState when a question overlay is active (edit or create).
 * Includes the question's current CompressedFileState so the agent can read
 * its content for oldMatch values without calling ReadFiles.
 */
export const selectAppStateWithUI = createSelector(
  selectAppState,
  (state: RootState) => state.ui.viewStack,
  (state: RootState) => state.files.files,
  (state: RootState) => state.queryResults.results,
  ({ appState, loading }, viewStack, filesState, queryResultsMap): { appState: AppState | null; loading: boolean } => {
    if (!appState) return { appState, loading };
    const top = viewStack[viewStack.length - 1];
    if (!top) return { appState, loading };

    const partialState = { files: { files: filesState }, queryResults: { results: queryResultsMap } } as RootState;
    const [augmented] = selectAugmentedFiles(partialState, [top.fileId]);
    const fileState = augmented ? compressAugmentedFile(augmented, APP_STATE_LIMIT_CHARS).fileState : undefined;

    return {
      appState: {
        ...appState,
        ui: {
          openModal: {
            type: top.type,
            fileId: top.fileId,
            ...(top.type === 'create-question' ? { dashboardId: top.dashboardId } : {}),
            ...(fileState ? { fileState } : {}),
          },
        },
      },
      loading,
    };
  }
);
