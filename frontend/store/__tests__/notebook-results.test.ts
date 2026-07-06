/**
 * Notebook cell result persistence (capture → save → reopen → rehydrate).
 *
 * Verifies that a freshly-run SQL cell result is cached into NotebookContent
 * (marking the notebook dirty, so a normal Save persists it), and that on reopen
 * a matching snapshot rehydrates into the query cache + cellExecuted so the cell
 * renders without a rerun. A query change invalidates the snapshot; oversized
 * results are capped.
 */
import { configureStore } from '@reduxjs/toolkit';
import filesReducer, {
  setFile, selectMergedContent, selectIsDirty, selectNotebookCellExecuted, type FileId,
} from '../filesSlice';
import queryResultsReducer, { selectQueryResult } from '../queryResultsSlice';
import authReducer from '../authSlice';
import uiReducer from '../uiSlice';
import { getQueryHash } from '@/lib/utils/query-hash';
import type { DbFile } from '@/lib/types';

let testStore: any;
vi.mock('@/store/store', () => ({
  get store() { return testStore; },
  getStore: () => testStore,
}));

import { captureNotebookCellResult, rehydrateNotebookResults, removeNotebookCellResult } from '@/lib/file-state/file-state';

function setupStore() {
  return configureStore({
    reducer: { files: filesReducer, queryResults: queryResultsReducer, auth: authReducer, ui: uiReducer },
  });
}

function notebookFile(over: Partial<DbFile> = {}, cellOver: Record<string, unknown> = {}): DbFile {
  return {
    id: 5001,
    name: 'nb',
    path: '/org/nb',
    type: 'notebook',
    content: {
      description: null,
      cells: [{
        type: 'sql', id: 'cell-1', name: null, query: 'SELECT 1',
        vizSettings: { type: 'table' }, parameters: [], parameterValues: {},
        connection_name: 'mxfood', references: [], ...cellOver,
      }],
    },
    references: [],
    created_at: '2026-01-01', updated_at: '2026-01-01',
    version: 1, last_edit_id: null, draft: false, meta: null,
    ...over,
  } as DbFile;
}

const DATA = { columns: ['n'], types: ['int'], rows: [{ n: 1 }, { n: 2 }] };

beforeEach(() => { testStore = setupStore(); });
afterEach(() => { testStore = null; });

describe('captureNotebookCellResult', () => {
  it('caches the result into content.cellResults and marks the notebook dirty', () => {
    testStore.dispatch(setFile({ file: notebookFile() }));
    captureNotebookCellResult(5001 as FileId, 'cell-1',
      { query: 'SELECT 1', params: {}, database: 'mxfood' }, DATA);

    const content = selectMergedContent(testStore.getState(), 5001 as FileId) as any;
    const snap = content.cellResults['cell-1'];
    expect(snap.queryHash).toBe(getQueryHash('SELECT 1', {}, 'mxfood'));
    expect(snap.data.rows).toEqual(DATA.rows);
    expect(selectIsDirty(testStore.getState(), 5001 as FileId)).toBe(true);
  });

  it('is a no-op when the identical result is already stored (no spurious dirty)', () => {
    const withResults = notebookFile();
    (withResults.content as any).cellResults = {
      'cell-1': { queryHash: getQueryHash('SELECT 1', {}, 'mxfood'), executedAt: 1, data: DATA },
    };
    testStore.dispatch(setFile({ file: withResults }));

    captureNotebookCellResult(5001 as FileId, 'cell-1',
      { query: 'SELECT 1', params: {}, database: 'mxfood' }, DATA);

    expect(selectIsDirty(testStore.getState(), 5001 as FileId)).toBe(false);
  });

  it('preserves already-saved snapshots for OTHER cells when capturing a new one', () => {
    // A notebook reopened with a saved result for cell-1, plus a second cell.
    const f = notebookFile();
    (f.content as any).cells.push({
      type: 'sql', id: 'cell-2', name: null, query: 'SELECT 2',
      vizSettings: { type: 'table' }, parameters: [], parameterValues: {},
      connection_name: 'mxfood', references: [],
    });
    (f.content as any).cellResults = {
      'cell-1': { queryHash: getQueryHash('SELECT 1', {}, 'mxfood'), executedAt: 1, data: DATA },
    };
    testStore.dispatch(setFile({ file: f }));

    captureNotebookCellResult(5001 as FileId, 'cell-2',
      { query: 'SELECT 2', params: {}, database: 'mxfood' }, DATA);

    const content = selectMergedContent(testStore.getState(), 5001 as FileId) as any;
    expect(content.cellResults['cell-1']).toBeDefined(); // not dropped
    expect(content.cellResults['cell-2']).toBeDefined();
  });

  it('caps oversized results and flags them truncated', () => {
    testStore.dispatch(setFile({ file: notebookFile() }));
    const bigRows = Array.from({ length: 2500 }, (_, i) => ({ n: i }));
    captureNotebookCellResult(5001 as FileId, 'cell-1',
      { query: 'SELECT 1', params: {}, database: 'mxfood' },
      { columns: ['n'], types: ['int'], rows: bigRows });

    const content = selectMergedContent(testStore.getState(), 5001 as FileId) as any;
    expect(content.cellResults['cell-1'].data.rows).toHaveLength(2000);
    expect(content.cellResults['cell-1'].truncated).toBe(true);
  });
});

describe('removeNotebookCellResult', () => {
  it('prunes a deleted cell\'s snapshot while keeping the others, and marks dirty', () => {
    const f = notebookFile();
    (f.content as any).cellResults = {
      'cell-1': { queryHash: getQueryHash('SELECT 1', {}, 'mxfood'), executedAt: 1, data: DATA },
      'cell-2': { queryHash: getQueryHash('SELECT 2', {}, 'mxfood'), executedAt: 1, data: DATA },
    };
    testStore.dispatch(setFile({ file: f }));

    removeNotebookCellResult(5001 as FileId, 'cell-1');

    const content = selectMergedContent(testStore.getState(), 5001 as FileId) as any;
    expect(content.cellResults['cell-1']).toBeUndefined();
    expect(content.cellResults['cell-2']).toBeDefined();
    expect(selectIsDirty(testStore.getState(), 5001 as FileId)).toBe(true);
  });

  it('is a no-op when the cell has no stored result', () => {
    testStore.dispatch(setFile({ file: notebookFile() }));
    removeNotebookCellResult(5001 as FileId, 'cell-1');
    expect(selectIsDirty(testStore.getState(), 5001 as FileId)).toBe(false);
  });
});

describe('rehydrateNotebookResults', () => {
  it('seeds the cache + cellExecuted for a snapshot matching the cell query', () => {
    const f = notebookFile();
    (f.content as any).cellResults = {
      'cell-1': { queryHash: getQueryHash('SELECT 1', {}, 'mxfood'), executedAt: 1, data: DATA },
    };
    testStore.dispatch(setFile({ file: f }));

    rehydrateNotebookResults(5001 as FileId);

    const cached = selectQueryResult(testStore.getState(), 'SELECT 1', {}, 'mxfood');
    expect(cached?.data?.rows).toEqual(DATA.rows);
    const executed = selectNotebookCellExecuted(testStore.getState(), 5001 as FileId);
    expect(executed?.['cell-1']?.query).toBe('SELECT 1');
    // Rehydrate must not dirty the notebook (results came from saved content).
    expect(selectIsDirty(testStore.getState(), 5001 as FileId)).toBe(false);
  });

  it('ignores a snapshot whose query no longer matches the cell', () => {
    // Cell query is now 'SELECT 2' but the snapshot was captured for 'SELECT 1'.
    const f = notebookFile({}, { query: 'SELECT 2' });
    (f.content as any).cellResults = {
      'cell-1': { queryHash: getQueryHash('SELECT 1', {}, 'mxfood'), executedAt: 1, data: DATA },
    };
    testStore.dispatch(setFile({ file: f }));

    rehydrateNotebookResults(5001 as FileId);

    expect(selectQueryResult(testStore.getState(), 'SELECT 2', {}, 'mxfood')?.data).toBeUndefined();
    expect(selectNotebookCellExecuted(testStore.getState(), 5001 as FileId)?.['cell-1']).toBeUndefined();
  });
});
