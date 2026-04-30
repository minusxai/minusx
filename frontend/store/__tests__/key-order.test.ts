/**
 * Tests for JSON key ordering consistency in the EditFile tool flow.
 *
 * Root cause of production EditFile failures: DashboardLayoutItem key order
 * varies between write paths (PGLite JSONB sorts length-first-then-alpha,
 * LLM writes arbitrary order), so oldMatch strings don't match
 * buildCurrentFileStr output.
 *
 * Fix: sortObjectKeysDeep called at both Redux write points:
 *   1. dbFileToFileState (compress-augmented.ts) — normalises on DB load
 *   2. setEdit / setFullContent (filesSlice.ts) — normalises on LLM writes
 */
import { getTestDbPath, initTestDatabase } from './test-utils';
import { readFiles, buildCurrentFileStr, editFileStr } from '@/lib/api/file-state';
import { setEdit } from '@/store/filesSlice';
import { DashboardContent } from '@/lib/types';
import { configureStore } from '@reduxjs/toolkit';
import filesReducer from '../filesSlice';
import queryResultsReducer from '../queryResultsSlice';
import authReducer from '../authSlice';

jest.mock('@/lib/database/db-config', () => ({
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

let testStore: any;
jest.mock('@/store/store', () => ({
  get store() { return testStore; },
  getStore: () => testStore,
}));

describe('key-order - JSON key ordering consistency', () => {
  const dbPath = getTestDbPath('key_order');
  let dashId: number;

  const { POST: batchPostHandler } = require('@/app/api/files/batch/route');

  function setupStore() {
    return configureStore({
      reducer: {
        files: filesReducer,
        queryResults: queryResultsReducer,
        auth: authReducer,
      },
    });
  }

  beforeAll(() => {
    global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('/api/files/batch')) {
        const fullUrl = urlStr.startsWith('http') ? urlStr : `http://localhost:3000${urlStr}`;
        const request = new Request(fullUrl, {
          method: 'POST',
          ...init,
          headers: { ...init?.headers, 'x-user-id': '1' },
        });
        const response = await batchPostHandler(request);
        const data = await response.json();
        return { ok: response.status === 200, status: response.status, json: async () => data } as Response;
      }
      throw new Error(`Unmocked fetch call to ${urlStr}`);
    });
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  beforeEach(async () => {
    await initTestDatabase(dbPath);

    const { DocumentDB } = await import('@/lib/database/documents-db');
    // Insert with template/frontend insertion order {id, x, y, w, h}.
    // PGLite JSONB will round-trip to {h, w, x, y, id} (1-char keys first, then 2-char).
    dashId = await DocumentDB.create(
      'key-order-dashboard',
      '/org/key-order-dashboard',
      'dashboard',
      {
        assets: [{ type: 'question', id: 99 }],
        layout: { columns: 12, items: [{ id: 99, x: 0, y: 0, w: 6, h: 4 }] },
      } as DashboardContent,
      []
    );

    testStore = setupStore();
    jest.clearAllMocks();
  });

  afterEach(() => {
    testStore = null;
    if (global.gc) global.gc();
  });

  /**
   * Case 1 — JSONB round-trip changes key order (dbFileToFileState source)
   *
   * Given: dashboard inserted into DB with layout items in {id,x,y,w,h} order
   * When:  file loaded via readFiles → dbFileToFileState
   * Then:  buildCurrentFileStr contains items in canonical alphabetical order {h,id,w,x,y}
   *
   * Red reason: dbFileToFileState doesn't normalise; PGLite returns {h,w,x,y,id}.
   */
  it('Case 1: buildCurrentFileStr produces canonical key order after DB round-trip', async () => {
    await readFiles([dashId]);

    const state = testStore.getState();
    const built = buildCurrentFileStr(state as any, dashId);
    expect(built.success).toBe(true);
    if (!built.success) return;

    // PGLite JSONB sorts keys by length-first then alpha:
    //   1-char: h, w, x, y  →  2-char: id
    //   Result: "h":4,"w":6,"x":0,"y":0,"id":99
    //
    // Canonical alphabetical (h < id < w < x < y):
    //   Result: "h":4,"id":99,"w":6,"x":0,"y":0
    //
    // After fix, dbFileToFileState normalises via sortObjectKeysDeep.
    expect(built.fullFileStr).toContain('"h":4,"id":99,"w":6,"x":0,"y":0');
  });

  /**
   * Case 2 — EditFile write stores one key order; subsequent EditFile expects canonical order
   *
   * Given: setEdit called with layout items in LLM-written {h,w,x,y,id} order
   * When:  editFileStr uses canonical-order oldMatch {h,id,w,x,y} for that same item
   * Then:  editFileStr succeeds
   *
   * Red reason: setEdit stores LLM-written key order; canonical oldMatch doesn't match.
   */
  it('Case 2: editFileStr with canonical oldMatch succeeds after setEdit with LLM-written key order', async () => {
    await readFiles([dashId]);

    // Simulate LLM writing a layout item in non-canonical {h,w,x,y,id} order
    testStore.dispatch(setEdit({
      fileId: dashId,
      edits: {
        layout: {
          columns: 12,
          items: [{ h: 4, w: 4, x: 6, y: 0, id: 100 }],
        },
      } as any,
    }));

    // A subsequent edit uses canonical-order oldMatch {h,id,w,x,y}
    const result = await editFileStr({
      fileId: dashId,
      oldMatch: '"h":4,"id":100,"w":4,"x":6,"y":0',
      newMatch: '"h":6,"id":100,"w":4,"x":6,"y":0',
    });

    expect(result.success).toBe(true);
  });

  /**
   * Case 3 — buildCurrentFileStr always produces canonical key order
   *
   * Given: dashboard state in Redux with items in {h,w,x,y,id} order (via setEdit)
   * When:  buildCurrentFileStr is called
   * Then:  every layout item in the resulting file string has keys in alphabetical order
   *
   * Red reason: setEdit doesn't normalise; encodeFileStr preserves insertion order.
   */
  it('Case 3: buildCurrentFileStr produces canonical key order after setEdit with wrong-order content', async () => {
    await readFiles([dashId]);

    // Simulate setEdit storing {h,w,x,y,id} order (non-canonical, as LLM might write)
    testStore.dispatch(setEdit({
      fileId: dashId,
      edits: {
        layout: {
          columns: 12,
          items: [{ h: 4, w: 6, x: 0, y: 0, id: 99 }],
        },
      } as any,
    }));

    const state = testStore.getState();
    const built = buildCurrentFileStr(state as any, dashId);
    expect(built.success).toBe(true);
    if (!built.success) return;

    // Non-canonical {h,w,x,y,id} order must NOT appear
    expect(built.fullFileStr).not.toContain('"h":4,"w":6,"x":0,"y":0,"id":99');
    // Canonical {h,id,w,x,y} order MUST appear
    expect(built.fullFileStr).toContain('"h":4,"id":99,"w":6,"x":0,"y":0');
  });
});
