import { createListenerMiddleware } from '@reduxjs/toolkit';
import type { AppDispatch, RootState } from './store';
import { setNavigation, setActiveVirtualId, selectPathState } from './navigationSlice';
import { generateVirtualId } from './filesSlice';
import { readFiles, readFolder, createVirtualFile } from '@/lib/api/file-state';

export const navigationListenerMiddleware = createListenerMiddleware();

/**
 * Listen for setNavigation → load the appropriate data for the current route.
 *
 * - /f/{id}     → loadFiles([id])
 * - /new/{type} → createVirtualFile (first visit) or reuse existing virtualId
 * - /p/path     → readFolder(path)
 *
 * This listener runs headless: tests dispatch setNavigation directly
 * (no React, no router, no NavigationSync component needed).
 */
navigationListenerMiddleware.startListening({
  actionCreator: setNavigation,
  effect: async (action, { dispatch, getState }) => {
    const typedDispatch = dispatch as AppDispatch;
    const pathState = selectPathState(getState() as RootState);

    if (pathState.type === 'file' && pathState.id > 0) {
      await readFiles([pathState.id]);

    } else if (pathState.type === 'newFile') {
      let virtualId = pathState.createOptions.virtualId;

      if (!virtualId) {
        // Generate a new virtualId and store it in Redux so all consumers agree
        virtualId = generateVirtualId();
        typedDispatch(setActiveVirtualId(virtualId));
      }

      // Only create if the virtual file doesn't already exist in Redux
      const currentState = getState() as RootState;
      const exists = currentState.files.files[virtualId];
      if (!exists) {
        await createVirtualFile(pathState.fileType, {
          ...pathState.createOptions,
          virtualId,
        });
      }

    } else if (pathState.type === 'folder') {
      await readFolder(pathState.path);
    }
  },
});
