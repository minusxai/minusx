import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { RootState } from './store';

// ============================================================================
// Types
// ============================================================================

export type PathState =
  | { type: 'file'; id: number }
  | { type: 'folder'; path: string }
  | { type: 'explore'}
  | { type: null };

interface NavigationState {
  pathname: string;
  searchParams: Record<string, string>;
}

// ============================================================================
// Slice
// ============================================================================

const initialState: NavigationState = {
  pathname: '',
  searchParams: {},
};

const navigationSlice = createSlice({
  name: 'navigation',
  initialState,
  reducers: {
    setNavigation(
      state,
      action: PayloadAction<{ pathname: string; searchParams: Record<string, string> }>
    ) {
      state.pathname = action.payload.pathname;
      state.searchParams = action.payload.searchParams;
    },
  },
});

export const { setNavigation } = navigationSlice.actions;
export default navigationSlice.reducer;

// ============================================================================
// selectPathState — pure computation (not stored in Redux)
// ============================================================================

export function computePathState(
  pathname: string,
  _searchParams: Record<string, string>,
): PathState {
  // File page: /f/{id}
  const fileMatch = pathname.match(/^\/f\/(\d+)/);
  if (fileMatch) {
    return { type: 'file', id: parseInt(fileMatch[1], 10) };
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
  );
}

// selectAppState has been moved to store/appStateSelector.ts to break the
// circular dependency: navigationSlice → file-state → store → navigationSlice.
// Import selectAppState from '@/store/appStateSelector' instead.
