import { createListenerMiddleware } from '@reduxjs/toolkit';
import type { AppDispatch, RootState } from './store';
import { setNavigation, selectPathState } from './navigationSlice';
import { readFiles, readFolder } from '@/lib/api/file-state';

export const navigationListenerMiddleware = createListenerMiddleware();

/**
 * Listen for setNavigation → load the appropriate data for the current route.
 *
 * - /f/{id}   → loadFiles([id])
 * - /p/path   → readFolder(path)
 */
navigationListenerMiddleware.startListening({
  actionCreator: setNavigation,
  effect: async (action, { getState }) => {
    const pathState = selectPathState(getState() as RootState);

    if (pathState.type === 'file' && pathState.id > 0) {
      await readFiles([pathState.id]);
    } else if (pathState.type === 'folder') {
      await readFolder(pathState.path);
    }
  },
});
