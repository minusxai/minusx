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
 * a deterministic, schema-driven jsx document (`<assets>`/`<layout>` with nested `<item>`
 * elements and scalar position tags like `<w>6</w>`). Layout positions are emitted in a
 * fixed, schema-defined order, so the order in which `content` keys happen to be stored
 * no longer affects the projection.
 *
 * The invariants this file now guards:
 *   1. buildCurrentFileStr produces deterministic, stable markup after a DB round-trip.
 *   2. editFileStr with a markup oldMatch (a layout-item position element) succeeds
 *      and updates Redux.
 *   3. Re-deriving markup after setEdit with reordered content keys yields IDENTICAL
 *      markup — the projection is independent of content key order (the new guarantee
 *      that replaces the old key-order fix).
 */
import { getTestDbPath, initTestDatabase } from './test-utils';
import { readFiles, buildCurrentFileStr, editFileStr } from '@/lib/file-state/file-state';
import { setEdit } from '@/store/filesSlice';
import { fileToMarkup } from '@/lib/data/file-markup';
import { DashboardContent } from '@/lib/types';
import { configureStore } from '@reduxjs/toolkit';
import filesReducer from '../filesSlice';
import queryResultsReducer from '../queryResultsSlice';
import authReducer from '../authSlice';
import { NextRequest } from "next/server";
import { POST as batchPostHandler } from '@/app/api/files/batch/route';

let testStore: any;
vi.mock('@/store/store', () => ({
  get store() { return testStore; },
  getStore: () => testStore,
}));

describe('key-order - deterministic markup projection', () => {
  const dbPath = getTestDbPath('key_order');
  let dashId: number;

  // Canonical markup the dashboard projects to. Under the uniform schema-driven
  // content⇄jsx converter, assets and layout nest as `<item>` elements with scalar
  // child tags; layout positions are nested scalar elements (`<w>6</w>`), not jsx
  // attributes — but the projection is still fixed by the schema, independent of
  // how the underlying content keys happen to be ordered.
  const EXPECTED_MARKUP =
    '<assets>\n' +
    '  <item>\n' +
    '    <type>question</type>\n' +
    '    <id>99</id>\n' +
    '  </item>\n' +
    '</assets>\n' +
    '<layout>\n' +
    '  <columns>12</columns>\n' +
    '  <items>\n' +
    '    <item>\n' +
    '      <id>99</id>\n' +
    '      <x>0</x>\n' +
    '      <y>0</y>\n' +
    '      <w>6</w>\n' +
    '      <h>4</h>\n' +
    '    </item>\n' +
    '  </items>\n' +
    '</layout>';

  function setupStore() {
    return configureStore({
      reducer: {
        files: filesReducer,
        queryResults: queryResultsReducer,
        auth: authReducer,
      },
    });
  }

  // DB boots ONCE for the whole file: no test mutates the document (edits stay in
  // Redux; each test gets a fresh store below), so re-initializing PGLite per test
  // was pure fixed cost (~3.5s × 3 tests).
  beforeAll(async () => {
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
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
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
   * When:  editFileStr changes a layout-item position element (<w>6</w> → <w>8</w>)
   * Then:  the edit applies and the new layout width is reflected in Redux + re-projected markup
   */
  it('Case 2: editFileStr with a markup oldMatch (layout position) updates Redux', async () => {
    await readFiles([dashId]);

    const result = await editFileStr({
      fileId: dashId,
      oldMatch: '<w>6</w>',
      newMatch: '<w>8</w>',
    });

    expect(result.success).toBe(true);

    // Redux content reflects the new width.
    const built = buildCurrentFileStr(testStore.getState() as any, dashId);
    expect(built.success).toBe(true);
    if (!built.success) return;
    const item = (built.mergedContent as DashboardContent).layout!.items![0];
    expect(item.w).toBe(8);
    expect(item).toMatchObject({ id: 99, x: 0, y: 0, h: 4 });

    // Re-projected markup carries the edited width and nothing else changed.
    expect(built.fullFileStr).toContain('<w>8</w>');
  });

  /**
   * Case 3 — markup is independent of content key order.
   *
   * Given: dashboard state mutated via setEdit with layout items in a DIFFERENT key
   *        order ({h,w,x,y,id}) than the original ({id,x,y,w,h})
   * When:  buildCurrentFileStr is called
   * Then:  the projected markup is byte-identical to the canonical projection — the
   *        element order is fixed by the schema-driven converter, not by content key order.
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
