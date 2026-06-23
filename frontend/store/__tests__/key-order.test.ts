/**
 * Tests for deterministic MARKUP projection in the EditFile tool flow (File Arch v2).
 *
 * History: the agent's file-edit surface used to be escaped JSON, and the JSON
 * key-ordering of layout items (DashboardLayoutItem `{id,x,y,w,h}`) varied between
 * write paths (PGLite JSONB sorts length-first-then-alpha, the LLM wrote arbitrary
 * order). That made `oldMatch` strings fail to match `buildCurrentFileStr` output —
 * the bug this file used to guard against.
 *
 * Under the markup model that whole class of bug is DISSOLVED: a dashboard projects to
 * a deterministic jsx body (`<Dashboard cols><Question id x y w h/></Dashboard>`) plus
 * a `<props>` block. Layout positions are jsx ATTRIBUTES, not JSON object keys, so the
 * order in which `content` keys happen to be stored no longer affects the projection.
 *
 * The invariants this file now guards:
 *   1. buildCurrentFileStr produces deterministic, stable markup after a DB round-trip.
 *   2. editFileStr with a markup oldMatch (a `<Question>` position attribute) succeeds
 *      and updates Redux.
 *   3. Re-deriving markup after setEdit with reordered content keys yields IDENTICAL
 *      markup — the projection is independent of content key order (the new guarantee
 *      that replaces the old key-order fix).
 */
import { getTestDbPath, initTestDatabase } from './test-utils';
import { readFiles, buildCurrentFileStr, editFileStr } from '@/lib/api/file-state';
import { setEdit } from '@/store/filesSlice';
import { fileToMarkup } from '@/lib/data/file-markup';
import { DashboardContent } from '@/lib/types';
import { configureStore } from '@reduxjs/toolkit';
import filesReducer from '../filesSlice';
import queryResultsReducer from '../queryResultsSlice';
import authReducer from '../authSlice';
import { NextRequest } from "next/server";
import { POST as batchPostHandler } from '@/app/api/files/batch/route';

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

let testStore: any;
vi.mock('@/store/store', () => ({
  get store() { return testStore; },
  getStore: () => testStore,
}));

describe('key-order - deterministic markup projection', () => {
  const dbPath = getTestDbPath('key_order');
  let dashId: number;

  // Canonical markup the dashboard projects to. Positions are jsx attributes;
  // the dashboard has no description so props is the empty self-closing form.
  const EXPECTED_MARKUP =
    '<jsx>\n' +
    '<Dashboard cols={12}>\n' +
    '  <Question id={99} x={0} y={0} w={6} h={4} />\n' +
    '</Dashboard>\n' +
    '</jsx>\n' +
    '<props/>';

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
    global.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('/api/files/batch')) {
        const fullUrl = urlStr.startsWith('http') ? urlStr : `http://localhost:3000${urlStr}`;
        const request = new NextRequest(fullUrl, { method: 'POST', ...init, headers: { ...init?.headers, 'x-user-id': '1' } } as any);
        const response = await batchPostHandler(request as NextRequest);
        const data = await response.json();
        return { ok: response.status === 200, status: response.status, json: async () => data } as Response;
      }
      throw new Error(`Unmocked fetch call to ${urlStr}`);
    });
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  beforeEach(async () => {
    await initTestDatabase(dbPath);

    const { DocumentDB } = await import('@/lib/database/documents-db');
    // Insert with frontend insertion order {id, x, y, w, h}. PGLite JSONB will
    // round-trip the layout item to a different key order ({h, w, x, y, id}) —
    // which, under the markup model, must NOT affect the projected attributes.
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
    vi.clearAllMocks();
  });

  afterEach(() => {
    testStore = null;
    if (global.gc) global.gc();
  });

  /**
   * Case 1 — buildCurrentFileStr produces deterministic markup after a DB round-trip.
   *
   * Given: dashboard inserted into DB with layout items in {id,x,y,w,h} order
   * When:  file loaded via readFiles and buildCurrentFileStr called (twice)
   * Then:  the markup equals the canonical projection and is byte-identical on repeat,
   *        regardless of how PGLite JSONB reordered the underlying content keys.
   */
  it('Case 1: buildCurrentFileStr produces deterministic markup after DB round-trip', async () => {
    await readFiles([dashId]);

    const state = testStore.getState();
    const first = buildCurrentFileStr(state as any, dashId);
    expect(first.success).toBe(true);
    if (!first.success) return;

    // Matches the canonical projection computed straight from content.
    expect(first.fullFileStr).toBe(EXPECTED_MARKUP);
    expect(first.fullFileStr).toBe(fileToMarkup('dashboard', first.mergedContent));

    // Stable: building again yields byte-identical markup.
    const second = buildCurrentFileStr(testStore.getState() as any, dashId);
    expect(second.success).toBe(true);
    if (!second.success) return;
    expect(second.fullFileStr).toBe(first.fullFileStr);
  });

  /**
   * Case 2 — editFileStr with a markup oldMatch succeeds and updates Redux.
   *
   * Given: the loaded dashboard projected to markup
   * When:  editFileStr changes a <Question> position attribute (w={6} → w={8})
   * Then:  the edit applies and the new layout width is reflected in Redux + re-projected markup
   */
  it('Case 2: editFileStr with a markup oldMatch (Question position) updates Redux', async () => {
    await readFiles([dashId]);

    const result = await editFileStr({
      fileId: dashId,
      oldMatch: '<Question id={99} x={0} y={0} w={6} h={4} />',
      newMatch: '<Question id={99} x={0} y={0} w={8} h={4} />',
    });

    expect(result.success).toBe(true);

    // Redux content reflects the new width.
    const built = buildCurrentFileStr(testStore.getState() as any, dashId);
    expect(built.success).toBe(true);
    if (!built.success) return;
    const item = (built.mergedContent as DashboardContent).layout!.items![0];
    expect(item.w).toBe(8);
    expect(item).toMatchObject({ id: 99, x: 0, y: 0, h: 4 });

    // Re-projected markup carries the edited attribute and nothing else changed.
    expect(built.fullFileStr).toContain('<Question id={99} x={0} y={0} w={8} h={4} />');
  });

  /**
   * Case 3 — markup is independent of content key order.
   *
   * Given: dashboard state mutated via setEdit with layout items in a DIFFERENT key
   *        order ({h,w,x,y,id}) than the original ({id,x,y,w,h})
   * When:  buildCurrentFileStr is called
   * Then:  the projected markup is byte-identical to the canonical projection — the jsx
   *        attribute order is fixed by dashboardToJsx, not by the content key order.
   */
  it('Case 3: re-deriving markup after setEdit with reordered content keys yields identical markup', async () => {
    await readFiles([dashId]);

    const before = buildCurrentFileStr(testStore.getState() as any, dashId);
    expect(before.success).toBe(true);
    if (!before.success) return;

    // Same item values, deliberately different key order, as an LLM might write.
    testStore.dispatch(setEdit({
      fileId: dashId,
      edits: {
        assets: [{ type: 'question', id: 99 }],
        layout: {
          columns: 12,
          items: [{ h: 4, w: 6, x: 0, y: 0, id: 99 }],
        },
      } as any,
    }));

    const after = buildCurrentFileStr(testStore.getState() as any, dashId);
    expect(after.success).toBe(true);
    if (!after.success) return;

    expect(after.fullFileStr).toBe(EXPECTED_MARKUP);
    expect(after.fullFileStr).toBe(before.fullFileStr);
  });
});
