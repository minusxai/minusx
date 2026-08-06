import { configureStore } from '@reduxjs/toolkit';
import { describe, expect, it } from 'vitest';
import authReducer from '../authSlice';
import filesReducer, { setFile } from '../filesSlice';
import navigationReducer, { setNavigation } from '../navigationSlice';
import queryResultsReducer from '../queryResultsSlice';
import uiReducer, { setNotebookActiveCell } from '../uiSlice';
import { selectAppState } from '../appStateSelector';
import type { DbFile } from '@/lib/types';

describe('notebook AppState focus', () => {
  it('carries the active cell as explicit UI metadata, not authored content', () => {
    const store = configureStore({
      reducer: {
        auth: authReducer,
        files: filesReducer,
        navigation: navigationReducer,
        queryResults: queryResultsReducer,
        ui: uiReducer,
      },
    });
    store.dispatch(setFile({
      file: {
        id: 77,
        name: 'Notebook',
        path: '/org/notebook',
        type: 'notebook',
        content: { description: null, cells: [] },
        references: [],
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
        version: 1,
        last_edit_id: null,
        draft: false,
        meta: null,
      } as DbFile,
      references: [],
    }));
    store.dispatch(setNotebookActiveCell({ fileId: 77, cellId: 'cell-b' }));
    store.dispatch(setNavigation({ pathname: '/f/77', searchParams: {} }));

    const { appState } = selectAppState(store.getState() as never);
    expect(appState?.ui?.notebookActiveCellId).toBe('cell-b');
    if (appState?.type !== 'file') throw new Error('expected file app state');
    expect(appState.state.fileState.content).not.toHaveProperty('activeCellId');
    expect(appState.state.fileState.markup).not.toContain('activeCellId');
  });
});
