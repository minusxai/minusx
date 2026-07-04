/**
 * Stale-tab save E2E — guards against the bug where a content-save
 * silently relocated a file because the client's Redux `path` was stale.
 *
 * Scenario: tab A moves a question; tab B (with the file cached) edits
 * content and Saves. Before this fix, B's stale `path` overwrote the DB
 * column → file moves back. After the fix:
 *   - `moveFile` bumps `version` (updateMetadata, moveFolderAndChildren).
 *   - `publishFile` conflict-retry takes serverFile.name/path unconditionally.
 *   - `publishAll` passes `expectedVersion`; server returns per-file conflicts;
 *     client retries each via `publishFile`.
 */

import { configureStore } from '@reduxjs/toolkit';
import filesReducer from '../filesSlice';
import queryResultsReducer from '../queryResultsSlice';
import authReducer from '../authSlice';
import { getTestDbPath, initTestDatabase, cleanupTestDatabase, mkPublished } from './test-utils';
import { DocumentDB } from '@/lib/database/documents-db';
import type { QuestionContent, UserRole } from '@/lib/types';
import { publishFile, publishAll } from '@/lib/api/file-state';
import type { Mode } from '@/lib/mode/mode-types';
import { POST as batchSaveHandler } from '@/app/api/files/batch-save/route';
import { PATCH as filePatchHandler } from '@/app/api/files/[id]/route';
import { setupMockFetch } from '@/test/harness/mock-fetch';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

let testStore: any;
vi.mock('@/store/store', () => ({
  get store() { return testStore; },
  getStore: () => testStore,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_AUTH = {
  user: {
    id: 1,
    email: 'test@example.com',
    name: 'Test User',
    role: 'admin' as UserRole,
    companyName: 'test-workspace',
    home_folder: '/org',
    mode: 'org' as Mode,
  },
  loading: false,
};

function makeStore() {
  return configureStore({
    reducer: { files: filesReducer, queryResults: queryResultsReducer, auth: authReducer },
    preloadedState: { auth: TEST_AUTH },
  });
}

function makeQuestion(query = 'SELECT 1'): QuestionContent {
  return {
    description: 'q',
    query,
    connection_name: 'test_db',
    parameters: [],
    vizSettings: { type: 'table' },
  } as QuestionContent;
}

// Simulate "another tab moved the file" without touching this test's Redux.
async function externalMove(fileId: number, name: string, newPath: string) {
  await DocumentDB.updateMetadata(fileId, name, newPath);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Stale-tab save does not relocate moved files', () => {
  const dbPath = getTestDbPath('stale_save_bug_e2e');
  let store: ReturnType<typeof makeStore>;

  // Route /api/files/{id} (PATCH) and /api/files/batch-save (POST) to real handlers.
  const mockFetch = setupMockFetch({
    interceptors: [
      { includesUrl: ['/api/files/batch-save'], handler: batchSaveHandler },
    ],
    additionalInterceptors: [
      async (urlStr, init) => {
        // Match /api/files/{numeric-id} but NOT /api/files/batch-* (handled above)
        const m = urlStr.match(/\/api\/files\/(\d+)(?:\?|$)/);
        if (!m) return null;
        const id = m[1];
        const req = new NextRequest(`http://localhost:3000/api/files/${id}`, {
          method: init?.method || 'PATCH',
          body: init?.body,
          headers: init?.headers,
        });
        const res = await filePatchHandler(req, { params: { id } as any });
        const data = await res.json();
        return { ok: res.status === 200, status: res.status, json: async () => data } as Response;
      },
    ],
  });

  beforeAll(async () => {
    await initTestDatabase(dbPath);
    await mkPublished('staram', '/org/staram', 'folder', { description: '' }, []);
  }, 120000);

  afterAll(async () => {
    await cleanupTestDatabase(dbPath);
  }, 60000);

  beforeEach(() => {
    store = makeStore();
    testStore = store;
    mockFetch.mockClear();
  });

  // -------------------------------------------------------------------------
  // (a) Move bumps version
  // -------------------------------------------------------------------------

  it('updateMetadata bumps version', async () => {
    const id = await mkPublished('q-a', '/org/q-a', 'question', makeQuestion(), []);
    const before = await DocumentDB.getById(id);
    expect(before!.version).toBe(1);

    await DocumentDB.updateMetadata(id, 'q-a', '/org/staram/q-a');

    const after = await DocumentDB.getById(id);
    expect(after!.path).toBe('/org/staram/q-a');
    expect(after!.version).toBe(2);
  });

  it('moveFolderAndChildren bumps version on folder + every descendant', async () => {
    const folderId = await mkPublished('mvfolder', '/org/mvfolder', 'folder', { description: '' }, []);
    const childId = await mkPublished('child', '/org/mvfolder/child', 'question', makeQuestion(), []);
    const folderBefore = await DocumentDB.getById(folderId);
    const childBefore = await DocumentDB.getById(childId);

    await DocumentDB.moveFolderAndChildren(folderId, [childId], '/org/mvfolder', '/org/staram/mvfolder', 'mvfolder');

    const folderAfter = await DocumentDB.getById(folderId);
    const childAfter = await DocumentDB.getById(childId);
    expect(folderAfter!.version).toBe((folderBefore!.version ?? 1) + 1);
    expect(childAfter!.version).toBe((childBefore!.version ?? 1) + 1);
    expect(childAfter!.path).toBe('/org/staram/mvfolder/child');
  });

  // -------------------------------------------------------------------------
  // (b) publishFile (single-file PATCH) — stale tab content save
  // -------------------------------------------------------------------------

  it('publishFile with stale path does not relocate after external move', async () => {
    const id = await mkPublished('q-b', '/org/q-b', 'question', makeQuestion('SELECT 1'), []);

    const file = await DocumentDB.getById(id);
    store.dispatch({ type: 'files/setFile', payload: { file } });

    await externalMove(id, 'q-b', '/org/staram/q-b');

    store.dispatch({ type: 'files/setEdit', payload: { fileId: id, edits: { query: 'SELECT 42' } } });

    await publishFile({ fileId: id });

    const after = await DocumentDB.getById(id);
    expect(after!.path).toBe('/org/staram/q-b');
    expect((after!.content as QuestionContent).query).toBe('SELECT 42');
  });

  // -------------------------------------------------------------------------
  // (c) publishAll (batch-save) — stale tab content save
  // -------------------------------------------------------------------------

  it('publishAll with stale path does not relocate after external move', async () => {
    const id = await mkPublished('q-c', '/org/q-c', 'question', makeQuestion('SELECT 1'), []);

    const file = await DocumentDB.getById(id);
    store.dispatch({ type: 'files/setFile', payload: { file } });

    await externalMove(id, 'q-c', '/org/staram/q-c');

    store.dispatch({ type: 'files/setEdit', payload: { fileId: id, edits: { query: 'SELECT 42' } } });

    await publishAll([id]);

    const after = await DocumentDB.getById(id);
    expect(after!.path).toBe('/org/staram/q-c');
    expect((after!.content as QuestionContent).query).toBe('SELECT 42');
  });

  // -------------------------------------------------------------------------
  // (d) Multi-file batch — clean files commit, conflicting file auto-retries
  // -------------------------------------------------------------------------

  it('publishAll: clean files commit, conflicting file auto-retries against server state', async () => {
    const idA = await mkPublished('q-d-a', '/org/q-d-a', 'question', makeQuestion('SELECT 1'), []);
    const idB = await mkPublished('q-d-b', '/org/q-d-b', 'question', makeQuestion('SELECT 1'), []);
    const idC = await mkPublished('q-d-c', '/org/q-d-c', 'question', makeQuestion('SELECT 1'), []);

    const fA = await DocumentDB.getById(idA);
    const fB = await DocumentDB.getById(idB);
    const fC = await DocumentDB.getById(idC);
    store.dispatch({ type: 'files/setFiles', payload: { files: [fA, fB, fC] } });

    // Only B is moved externally.
    await externalMove(idB, 'q-d-b', '/org/staram/q-d-b');

    store.dispatch({ type: 'files/setEdit', payload: { fileId: idA, edits: { query: 'SELECT 100' } } });
    store.dispatch({ type: 'files/setEdit', payload: { fileId: idB, edits: { query: 'SELECT 200' } } });
    store.dispatch({ type: 'files/setEdit', payload: { fileId: idC, edits: { query: 'SELECT 300' } } });

    await publishAll();

    const afterA = await DocumentDB.getById(idA);
    const afterB = await DocumentDB.getById(idB);
    const afterC = await DocumentDB.getById(idC);

    expect(afterA!.path).toBe('/org/q-d-a');
    expect((afterA!.content as QuestionContent).query).toBe('SELECT 100');
    expect(afterC!.path).toBe('/org/q-d-c');
    expect((afterC!.content as QuestionContent).query).toBe('SELECT 300');

    expect(afterB!.path).toBe('/org/staram/q-d-b');
    expect((afterB!.content as QuestionContent).query).toBe('SELECT 200');
  });

  // -------------------------------------------------------------------------
  // (e) Sanity: rename without concurrent move still works
  // -------------------------------------------------------------------------

  it('rename in same folder still moves the file to the new slug', async () => {
    const id = await mkPublished('q-e', '/org/q-e', 'question', makeQuestion(), []);
    const file = await DocumentDB.getById(id);
    store.dispatch({ type: 'files/setFile', payload: { file } });

    store.dispatch({ type: 'files/setMetadataEdit', payload: { fileId: id, changes: { name: 'renamed' } } });
    store.dispatch({ type: 'files/setEdit', payload: { fileId: id, edits: { query: 'SELECT 1' } } });

    await publishAll([id]);

    const after = await DocumentDB.getById(id);
    expect(after!.name).toBe('renamed');
    expect(after!.path).toBe('/org/renamed');
  });
});
