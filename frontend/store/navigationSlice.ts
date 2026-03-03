import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { RootState } from './store';
import type { FileType } from '@/lib/types';
import type { Mode } from '@/lib/mode/mode-types';
import { resolveHomeFolderSync } from '@/lib/mode/path-resolver';

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
  /** Error from virtual file creation (e.g. no connections available).
   *  Cleared whenever pathname changes. */
  createError: string | null;
}

// ============================================================================
// Slice
// ============================================================================

const initialState: NavigationState = {
  pathname: '',
  searchParams: {},
  activeVirtualId: null,
  createError: null,
};

const navigationSlice = createSlice({
  name: 'navigation',
  initialState,
  reducers: {
    setNavigation(
      state,
      action: PayloadAction<{ pathname: string; searchParams: Record<string, string> }>
    ) {
      // Reset activeVirtualId and createError whenever the page changes
      if (state.pathname !== action.payload.pathname) {
        state.activeVirtualId = null;
        state.createError = null;
      }
      state.pathname = action.payload.pathname;
      state.searchParams = action.payload.searchParams;
    },
    setActiveVirtualId(state, action: PayloadAction<number | null>) {
      state.activeVirtualId = action.payload;
    },
    setCreateError(state, action: PayloadAction<string | null>) {
      state.createError = action.payload;
    },
  },
});

export const { setNavigation, setActiveVirtualId, setCreateError } = navigationSlice.actions;
export default navigationSlice.reducer;

// ============================================================================
// selectPathState — pure computation (not stored in Redux)
// ============================================================================

export function computePathState(
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

// selectAppState has been moved to store/appStateSelector.ts to break the
// circular dependency: navigationSlice → file-state → store → navigationSlice.
// Import selectAppState from '@/store/appStateSelector' instead.
