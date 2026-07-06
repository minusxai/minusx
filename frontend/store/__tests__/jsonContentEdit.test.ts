/**
 * JSON-view editing E2E — covers `applyJsonContentEdit` (the JSON tab's edit
 * path) and the full-replace save semantics it requires.
 *
 * The JSON editor provides the FULL new content on each change, so edits are
 * stored via `setFullContent` (replace) rather than `setEdit` (merge). The
 * save paths (`publishFile`, `publishAll`) must honor that: a top-level key
 * deleted in the JSON view must NOT be resurrected by merging
 * persistableChanges over the original content.
 */

import { configureStore } from '@reduxjs/toolkit';
import filesReducer, { setFile, setEdit, selectIsDirty, selectPersistableContent } from '../filesSlice';
import queryResultsReducer from '../queryResultsSlice';
import authReducer from '../authSlice';
import { getTestDbPath, initTestDatabase, cleanupTestDatabase, mkPublished } from './test-utils';
import { DocumentDB } from '@/lib/database/documents-db';
import type { QuestionContent, UserRole } from '@/lib/types';
import { applyJsonContentEdit, publishFile, publishAll } from '@/lib/file-state/file-state';
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

function makeQuestion(query = 'SELECT 1', description: string | null = 'q'): QuestionContent {
  return {
    description,
    query,
    connection_name: 'test_db',
    parameters: [],
    vizSettings: { type: 'table' },
  } as QuestionContent;
}

async function loadIntoStore(store: ReturnType<typeof makeStore>, id: number) {
  const file = await DocumentDB.getById(id);
  store.dispatch(setFile({ file: file as any }));
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('JSON view editing (applyJsonContentEdit + full-replace save)', () => {
  const dbPath = getTestDbPath('json_content_edit');
  let store: ReturnType<typeof makeStore>;

  const mockFetch = setupMockFetch({
    interceptors: [
      { includesUrl: ['/api/files/batch-save'], handler: batchSaveHandler },
    ],
    additionalInterceptors: [
      async (urlStr, init) => {
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
  // (a) Redux-level behavior
  // -------------------------------------------------------------------------

  it('valid JSON edit replaces content and marks the file dirty', async () => {
    const id = await mkPublished('jq-a', '/org/jq-a', 'question', makeQuestion('SELECT 1'), []);
    await loadIntoStore(store, id);

    const newContent = makeQuestion('SELECT 99', 'edited via json');
    const result = applyJsonContentEdit({ fileId: id, jsonString: JSON.stringify(newContent) });

    expect(result.success).toBe(true);
    expect(selectIsDirty(store.getState() as any, id)).toBe(true);
    expect(selectPersistableContent(store.getState() as any, id)).toEqual(newContent);
  });

  it('rejects malformed JSON without touching state', async () => {
    const id = await mkPublished('jq-b', '/org/jq-b', 'question', makeQuestion(), []);
    await loadIntoStore(store, id);

    const result = applyJsonContentEdit({ fileId: id, jsonString: '{ not valid json' });

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(selectIsDirty(store.getState() as any, id)).toBe(false);
  });

  it('rejects schema-invalid content without touching state', async () => {
    const id = await mkPublished('jq-c', '/org/jq-c', 'question', makeQuestion(), []);
    await loadIntoStore(store, id);

    const bad = { ...makeQuestion(), vizSettings: { type: 'bogus' } };
    const result = applyJsonContentEdit({ fileId: id, jsonString: JSON.stringify(bad) });

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(selectIsDirty(store.getState() as any, id)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // (b) Save semantics — full replace, deletions survive
  // -------------------------------------------------------------------------

  it('deleting an optional key in the JSON view persists through publishFile', async () => {
    const id = await mkPublished('jq-d', '/org/jq-d', 'question', makeQuestion('SELECT 1', 'delete me'), []);
    await loadIntoStore(store, id);

    const edited: any = makeQuestion('SELECT 42', 'x');
    delete edited.description;
    const result = applyJsonContentEdit({ fileId: id, jsonString: JSON.stringify(edited) });
    expect(result.success).toBe(true);

    await publishFile({ fileId: id });

    const after = await DocumentDB.getById(id);
    const content = after!.content as QuestionContent;
    expect(content.query).toBe('SELECT 42');
    expect('description' in (content as any)).toBe(false);
  });

  it('deleting an optional key in the JSON view persists through publishAll', async () => {
    const id = await mkPublished('jq-e', '/org/jq-e', 'question', makeQuestion('SELECT 1', 'delete me too'), []);
    await loadIntoStore(store, id);

    const edited: any = makeQuestion('SELECT 43', 'x');
    delete edited.description;
    const result = applyJsonContentEdit({ fileId: id, jsonString: JSON.stringify(edited) });
    expect(result.success).toBe(true);

    await publishAll([id]);

    const after = await DocumentDB.getById(id);
    const content = after!.content as QuestionContent;
    expect(content.query).toBe('SELECT 43');
    expect('description' in (content as any)).toBe(false);
  });

  it('a visual-tab merge edit after a JSON edit keeps full-replace semantics', async () => {
    const id = await mkPublished('jq-f', '/org/jq-f', 'question', makeQuestion('SELECT 1', 'delete me three'), []);
    await loadIntoStore(store, id);

    const edited: any = makeQuestion('SELECT 1', 'x');
    delete edited.description;
    expect(applyJsonContentEdit({ fileId: id, jsonString: JSON.stringify(edited) }).success).toBe(true);

    // A subsequent merge-style edit (visual tab) merges ONTO the full content.
    store.dispatch(setEdit({ fileId: id, edits: { query: 'SELECT 7' } }));

    await publishFile({ fileId: id });

    const after = await DocumentDB.getById(id);
    const content = after!.content as QuestionContent;
    expect(content.query).toBe('SELECT 7');
    expect('description' in (content as any)).toBe(false);
  });

  it('merge-style edits alone (no JSON edit) still merge over original content', async () => {
    const id = await mkPublished('jq-g', '/org/jq-g', 'question', makeQuestion('SELECT 1', 'kept'), []);
    await loadIntoStore(store, id);

    store.dispatch(setEdit({ fileId: id, edits: { query: 'SELECT 8' } }));

    await publishFile({ fileId: id });

    const after = await DocumentDB.getById(id);
    const content = after!.content as QuestionContent;
    expect(content.query).toBe('SELECT 8');
    expect(content.description).toBe('kept');
  });
});
