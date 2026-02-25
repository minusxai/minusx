import { createSlice, PayloadAction, createSelector } from '@reduxjs/toolkit';
import type { RootState } from './store';
import type { FileState } from './filesSlice';
import type { FileType } from '@/lib/types';
import type { Mode } from '@/lib/mode/mode-types';
import type { AppState } from '@/lib/appState';
import { resolveHomeFolderSync, isHiddenSystemPath } from '@/lib/mode/path-resolver';
import { selectAugmentedFiles } from '@/lib/api/file-state';

// ============================================================================
// Types
// ============================================================================

export interface NavCreateOptions {
  folder?: string;
  databaseName?: string;
  query?: string;
  virtualId?: number;
}

export type PathState =
  | { type: 'file'; id: number }
  | { type: 'newFile'; fileType: FileType; createOptions: NavCreateOptions }
  | { type: 'folder'; path: string }
  | { type: 'explore'}
  | { type: null };

interface NavigationState {
  pathname: string;
  searchParams: Record<string, string>;
  /** Holds the effective virtualId for /new/ routes.
   *  Set by navigationListener after generating a virtualId.
   *  Cleared (null) whenever pathname changes. */
  activeVirtualId: number | null;
}

// ============================================================================
// Slice
// ============================================================================

const initialState: NavigationState = {
  pathname: '',
  searchParams: {},
  activeVirtualId: null,
};

const navigationSlice = createSlice({
  name: 'navigation',
  initialState,
  reducers: {
    setNavigation(
      state,
      action: PayloadAction<{ pathname: string; searchParams: Record<string, string> }>
    ) {
      // Reset activeVirtualId whenever the page changes
      if (state.pathname !== action.payload.pathname) {
        state.activeVirtualId = null;
      }
      state.pathname = action.payload.pathname;
      state.searchParams = action.payload.searchParams;
    },
    setActiveVirtualId(state, action: PayloadAction<number | null>) {
      state.activeVirtualId = action.payload;
    },
  },
});

export const { setNavigation, setActiveVirtualId } = navigationSlice.actions;
export default navigationSlice.reducer;

// ============================================================================
// selectPathState — pure computation (not stored in Redux)
// ============================================================================

function computePathState(
  pathname: string,
  searchParams: Record<string, string>,
  activeVirtualId: number | null,
  user: { mode: Mode; home_folder?: string } | null
): PathState {
  // File page: /f/{id}
  const fileMatch = pathname.match(/^\/f\/(\d+)/);
  if (fileMatch) {
    return { type: 'file', id: parseInt(fileMatch[1], 10) };
  }

  // New file page: /new/{type}
  const newFileMatch = pathname.match(/^\/new\/([^/?]+)/);
  if (newFileMatch) {
    const fileType = newFileMatch[1] as FileType;

    const folderParam = searchParams['folder'];
    const databaseParam = searchParams['databaseName'];
    const queryB64 = searchParams['queryB64'];
    const virtualIdParam = searchParams['virtualId'];

    const query = queryB64
      ? new TextDecoder().decode(Uint8Array.from(atob(queryB64), c => c.charCodeAt(0)))
      : undefined;

    const folder =
      folderParam ||
      (user ? resolveHomeFolderSync(user.mode, user.home_folder || '') : '/org');

    const parsedVirtualId = virtualIdParam ? parseInt(virtualIdParam, 10) : undefined;
    const urlVirtualId =
      parsedVirtualId && !isNaN(parsedVirtualId) && parsedVirtualId < 0
        ? parsedVirtualId
        : undefined;

    // Use URL param if present, otherwise fall back to Redux activeVirtualId
    const virtualId = urlVirtualId ?? (activeVirtualId !== null ? activeVirtualId : undefined);

    return {
      type: 'newFile',
      fileType,
      createOptions: {
        folder,
        databaseName: databaseParam || undefined,
        query,
        virtualId,
      },
    };
  }

  // Folder page: /p/path
  const folderMatch = pathname.match(/^\/p\/(.*)/);
  if (folderMatch) {
    return { type: 'folder', path: '/' + (folderMatch[1] || '') };
  }

  // Explore page: /explore or /explore/{conversationId}
  const exploreMatch = pathname.match(/^\/explore(?:\/(\d+))?/);
  if (exploreMatch) {
    return { type: 'explore' };
  }

  return { type: null };
}

/**
 * selectPathState — derives structured route info from navigation state.
 * Pure computation, not stored in Redux.
 */
export function selectPathState(state: RootState): PathState {
  return computePathState(
    state.navigation.pathname,
    state.navigation.searchParams,
    state.navigation.activeVirtualId,
    state.auth.user
  );
}

// ============================================================================
// selectAppState — full AppState derivation (memoized)
// ============================================================================

/**
 * selectAppState — derives AppState + loading from Redux.
 *
 * Replaces all logic from the old useAppState hook (useMemo + useState).
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
        appState: { type: 'file', state: augmented },
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
          appState: { type: 'file', state: augmented },
          loading: file.loading || false,
        };
      }
      return { appState: null, loading: true };
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
