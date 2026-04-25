/**
 * publishAll E2E Test
 *
 * Tests the full publishAll() flow end-to-end with the draft-file model.
 * All new files get real positive IDs immediately (draft:true in DB).
 * publishAll() batch-saves all dirty files in a single round trip — no
 * topological sort, no batch-create, no virtual→real ID mapping.
 *
 * Pattern: follows read-write-e2e.test.ts — no Python backend, direct route calls.
 */

import { configureStore } from '@reduxjs/toolkit';
import filesReducer, { selectDirtyFiles } from '../filesSlice';
import queryResultsReducer from '../queryResultsSlice';
import authReducer from '../authSlice';
import { getTestDbPath, initTestDatabase, cleanupTestDatabase } from './test-utils';
import { DocumentDB } from '@/lib/database/documents-db';
import type { QuestionContent, DocumentContent, UserRole } from '@/lib/types';
import { publishAll, discardAll } from '@/lib/api/file-state';
import type { Mode } from '@/lib/mode/mode-types';
import { POST as batchSaveHandler } from '@/app/api/files/batch-save/route';
import { setupMockFetch } from '@/test/harness/mock-fetch';

// ---------------------------------------------------------------------------
// Jest module mocks — hoisted to top of file by Jest
// ---------------------------------------------------------------------------

// Isolated test database
jest.mock('@/lib/database/db-config', () => ({
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

// Make file-state.ts's getStore() return our test store
let testStore: any;
jest.mock('@/store/store', () => ({
  get store() { return testStore; },
  getStore: () => testStore
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_AUTH_STATE = {
  user: {
    id: 1,
    email: 'test@example.com',
    name: 'Test User',
    role: 'admin' as UserRole,
    companyName: 'test-workspace',
    home_folder: '/org',
    mode: 'org' as Mode
  },
  loading: false
};

function makeStore() {
  return configureStore({
    reducer: {
      files: filesReducer,
      queryResults: queryResultsReducer,
      auth: authReducer
    },
    preloadedState: { auth: TEST_AUTH_STATE }
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getDirtyFileIds(s: ReturnType<typeof makeStore>): number[] {
  return selectDirtyFiles(s.getState() as any).map(f => f.id);
}

function getFileFromRedux(s: ReturnType<typeof makeStore>, fileId: number) {
  return (s.getState() as any).files.files[fileId];
}

async function loadFilesIntoRedux(s: ReturnType<typeof makeStore>, fileIds: number[]) {
  const files = await Promise.all(fileIds.map(id => DocumentDB.getById(id)));
  s.dispatch({ type: 'files/setFiles', payload: { files } });
}

function editInRedux(s: ReturnType<typeof makeStore>, fileId: number, edits: Record<string, any>) {
  s.dispatch({ type: 'files/setEdit', payload: { fileId, edits } });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('publishAll E2E', () => {
  const dbPath = getTestDbPath('publish_all_e2e');
  let store: ReturnType<typeof makeStore>;
  let question1Id: number;
  let question2Id: number;
  let question3Id: number;  // unrelated question (not in dashboard)
  let dashboardId: number;

  // Route batch API calls to real Next.js handlers (no Python backend needed)
  const mockFetch = setupMockFetch({
    getPythonPort: () => 0,
    interceptors: [
      { includesUrl: ['/api/files/batch-save'], handler: batchSaveHandler },
    ],
  });

  // -------------------------------------------------------------------------
  // DB setup (once per describe block)
  // -------------------------------------------------------------------------

  beforeAll(async () => {
    await initTestDatabase(dbPath);

    question1Id = await DocumentDB.create(
      'Revenue Query',
      '/org/revenue-query',
      'question',
      {
        description: 'Revenue by month',
        query: 'SELECT month, SUM(revenue) FROM sales GROUP BY month',
        connection_name: 'test_db',
        parameters: [],
        vizSettings: { type: 'table' }
      } as QuestionContent,
      []
    );

    question2Id = await DocumentDB.create(
      'User Count',
      '/org/user-count',
      'question',
      {
        description: 'Active user count',
        query: 'SELECT COUNT(*) FROM users WHERE active = true',
        connection_name: 'test_db',
        parameters: [],
        vizSettings: { type: 'table' }
      } as QuestionContent,
      []
    );

    question3Id = await DocumentDB.create(
      'Unrelated Query',
      '/org/unrelated-query',
      'question',
      {
        description: 'Something unrelated',
        query: 'SELECT 1',
        connection_name: 'test_db',
        parameters: [],
        vizSettings: { type: 'table' }
      } as QuestionContent,
      []
    );

    dashboardId = await DocumentDB.create(
      'Analytics Dashboard',
      '/org/analytics-dashboard',
      'dashboard',
      {
        description: 'Analytics overview',
        assets: [
          { type: 'question', id: question1Id },
          { type: 'question', id: question2Id }
        ],
        layout: {
          columns: 12,
          items: [
            { id: question1Id, x: 0, y: 0, w: 6, h: 4 },
            { id: question2Id, x: 6, y: 0, w: 6, h: 4 }
          ]
        }
      } as DocumentContent,
      [question1Id, question2Id]
    );

    // Publish all files (set draft:false)
    await DocumentDB.update(question1Id, 'Revenue Query', '/org/revenue-query', { description: 'Revenue by month', query: 'SELECT month, SUM(revenue) FROM sales GROUP BY month', connection_name: 'test_db', parameters: [], vizSettings: { type: 'table' } } as QuestionContent, [], 'setup');
    await DocumentDB.update(question2Id, 'User Count', '/org/user-count', { description: 'Active user count', query: 'SELECT COUNT(*) FROM users WHERE active = true', connection_name: 'test_db', parameters: [], vizSettings: { type: 'table' } } as QuestionContent, [], 'setup');
    await DocumentDB.update(question3Id, 'Unrelated Query', '/org/unrelated-query', { description: 'Something unrelated', query: 'SELECT 1', connection_name: 'test_db', parameters: [], vizSettings: { type: 'table' } } as QuestionContent, [], 'setup');
    await DocumentDB.update(dashboardId, 'Analytics Dashboard', '/org/analytics-dashboard', { description: 'Analytics overview', assets: [{ type: 'question', id: question1Id }, { type: 'question', id: question2Id }], layout: { columns: 12, items: [{ id: question1Id, x: 0, y: 0, w: 6, h: 4 }, { id: question2Id, x: 6, y: 0, w: 6, h: 4 }] } } as DocumentContent, [question1Id, question2Id], 'setup');
  });

  afterAll(async () => {
    await cleanupTestDatabase(dbPath);
  });

  // Fresh Redux store before each test — prevents state leaking between tests
  beforeEach(() => {
    store = makeStore();
    testStore = store;
    mockFetch.mockClear();
  });

  // -------------------------------------------------------------------------
  // Main test: full publish flow with draft files (real positive IDs)
  // -------------------------------------------------------------------------

  it('batch-saves all dirty files in a single round trip', async () => {

    // Step 1: Load existing files into Redux
    const q1File = await DocumentDB.getById(question1Id);
    const q2File = await DocumentDB.getById(question2Id);
    const dashFile = await DocumentDB.getById(dashboardId);

    store.dispatch({ type: 'files/setFiles', payload: { files: [q1File, q2File, dashFile] } });

    // Sanity: nothing dirty yet
    expect(getDirtyFileIds(store)).toHaveLength(0);
    console.log('✓ Step 1: files loaded into Redux, no dirty state');

    // Step 2: Edit questions and dashboard
    store.dispatch({ type: 'files/setEdit', payload: { fileId: question1Id, edits: { description: 'Updated revenue by month' } }});
    store.dispatch({ type: 'files/setEdit', payload: { fileId: question2Id, edits: { description: 'Updated active user count' } }});
    store.dispatch({ type: 'files/setEdit', payload: { fileId: dashboardId, edits: { description: 'Updated dashboard' } }});

    expect(getDirtyFileIds(store)).toHaveLength(3);
    console.log('✓ Step 2: 3 dirty files (q1, q2, dashboard)');

    // Step 3: publishAll()
    const idMap = await publishAll();
    expect(idMap).toEqual({});  // no virtual→real mapping in new system
    console.log('✓ Step 3: publishAll() completed');

    // Exactly 1 fetch call: batch-save (no batch-create needed)
    const fetchCalls = mockFetch.mock.calls.map((call: any[]) => call[0].toString());
    expect(fetchCalls.some((u: string) => u.includes('batch-save'))).toBe(true);
    expect(fetchCalls).toHaveLength(1);
    console.log('✓ Exactly 1 API call: batch-save');

    // All dirty files are now clean
    expect(getDirtyFileIds(store)).toHaveLength(0);
    console.log('✓ Redux is clean after publishAll');

    // DB reflects the changes
    const dbQ1 = await DocumentDB.getById(question1Id);
    const dbQ2 = await DocumentDB.getById(question2Id);
    const dbDash = await DocumentDB.getById(dashboardId);
    expect((dbQ1!.content as QuestionContent).description).toBe('Updated revenue by month');
    expect((dbQ2!.content as QuestionContent).description).toBe('Updated active user count');
    expect((dbDash!.content as DocumentContent).description).toBe('Updated dashboard');
    console.log('✓ DB reflects all saved changes');

    console.log('\n✓ publishAll E2E PASSED');
  });

  // -------------------------------------------------------------------------
  // Edge case: no-op when nothing is dirty
  // -------------------------------------------------------------------------

  it('is a no-op when no files are dirty', async () => {
    const q1File = await DocumentDB.getById(question1Id);
    store.dispatch({ type: 'files/setFiles', payload: { files: [q1File] } });

    expect(getDirtyFileIds(store)).toHaveLength(0);

    const idMap = await publishAll();
    expect(idMap).toEqual({});
    expect(mockFetch).not.toHaveBeenCalled();

    console.log('✓ publishAll() is a no-op when no dirty files exist');
  });

  // =========================================================================
  // SCOPED PUBLISH — publishAll(fileIds)
  // =========================================================================

  describe('publishAll (scoped)', () => {

    it('saves dashboard + dirty child, leaves unrelated dirty', async () => {
      await loadFilesIntoRedux(store, [question1Id, question2Id, question3Id, dashboardId]);
      editInRedux(store, question1Id, { description: 'Scoped Q1 edit' });
      editInRedux(store, dashboardId, { description: 'Dashboard edit' });
      editInRedux(store, question3Id, { description: 'Unrelated edit' });

      expect(getDirtyFileIds(store)).toHaveLength(3);

      await publishAll([dashboardId]);

      // Dashboard + Q1 (child) saved, Q3 still dirty
      const dirtyAfter = getDirtyFileIds(store);
      expect(dirtyAfter).toHaveLength(1);
      expect(dirtyAfter).toContain(question3Id);

      const q1 = await DocumentDB.getById(question1Id);
      expect((q1!.content as QuestionContent).description).toBe('Scoped Q1 edit');
      const dash = await DocumentDB.getById(dashboardId);
      expect((dash!.content as DocumentContent).description).toBe('Dashboard edit');
    });

    it('saves dirty child when dashboard itself is clean', async () => {
      await loadFilesIntoRedux(store, [question1Id, question2Id, question3Id, dashboardId]);
      editInRedux(store, question1Id, { description: 'Child-only edit' });
      editInRedux(store, question3Id, { description: 'Still unrelated' });

      expect(getDirtyFileIds(store)).toHaveLength(2);

      await publishAll([dashboardId]);

      // Q1 saved (child of clean dashboard), Q3 still dirty
      const dirtyAfter = getDirtyFileIds(store);
      expect(dirtyAfter).toHaveLength(1);
      expect(dirtyAfter).toContain(question3Id);

      const q1 = await DocumentDB.getById(question1Id);
      expect((q1!.content as QuestionContent).description).toBe('Child-only edit');
    });

    it('saves single file with no children', async () => {
      await loadFilesIntoRedux(store, [question1Id, question3Id]);
      editInRedux(store, question1Id, { description: 'Single save' });
      editInRedux(store, question3Id, { description: 'Should stay dirty' });

      await publishAll([question1Id]);

      const dirtyAfter = getDirtyFileIds(store);
      expect(dirtyAfter).toHaveLength(1);
      expect(dirtyAfter).toContain(question3Id);

      const q1 = await DocumentDB.getById(question1Id);
      expect((q1!.content as QuestionContent).description).toBe('Single save');
    });

    it('saves draft question added to dashboard — all references are real positive IDs', async () => {
      await loadFilesIntoRedux(store, [question1Id, question2Id, dashboardId]);

      // Create a draft question directly in DB (simulates createDraftFile outcome)
      const draftQId = await DocumentDB.create(
        'Draft Q',
        '/org/draft-q',
        'question',
        {
          description: 'Draft question',
          query: 'SELECT 1',
          connection_name: 'test_db',
          parameters: [],
          vizSettings: { type: 'table' }
        } as QuestionContent,
        []
      );

      // Load draft into Redux and make it dirty
      const draftFile = await DocumentDB.getById(draftQId);
      store.dispatch({ type: 'files/setFile', payload: { file: draftFile } });
      editInRedux(store, draftQId, { description: 'Updated draft question' });

      // Add draft question to dashboard — its ID is already positive
      store.dispatch({
        type: 'files/addQuestionToDashboard',
        payload: { dashboardId, questionId: draftQId }
      });

      const dirtyBefore = getDirtyFileIds(store);
      expect(dirtyBefore).toContain(dashboardId);
      expect(dirtyBefore).toContain(draftQId);

      await publishAll([dashboardId]);

      expect(getDirtyFileIds(store)).toHaveLength(0);

      // Dashboard in DB has only positive IDs (including the newly saved draft question)
      const dash = await DocumentDB.getById(dashboardId);
      const dashContent = dash!.content as DocumentContent;
      const assetIds = (dashContent.assets || []).map((a: any) => a.id);
      expect(assetIds).toContain(draftQId);
      expect(assetIds.every((id: number) => id > 0)).toBe(true);

      // Draft question was saved with updated content
      const savedDraft = await DocumentDB.getById(draftQId);
      expect((savedDraft!.content as QuestionContent).description).toBe('Updated draft question');
      expect(savedDraft!.draft).toBe(false);
    });
  });

  // =========================================================================
  // DISCARD — discardAll() and discardAll(fileIds)
  // =========================================================================

  describe('discardAll', () => {

    it('no args — discards all dirty files', async () => {
      await loadFilesIntoRedux(store, [question1Id, question3Id, dashboardId]);
      editInRedux(store, question1Id, { description: 'Will be discarded' });
      editInRedux(store, question3Id, { description: 'Also discarded' });
      editInRedux(store, dashboardId, { description: 'Gone too' });

      expect(getDirtyFileIds(store)).toHaveLength(3);

      discardAll();

      expect(getDirtyFileIds(store)).toHaveLength(0);
      // Redux content reverted (persistableChanges cleared)
      const q1 = getFileFromRedux(store, question1Id);
      expect(Object.keys(q1.persistableChanges || {})).toHaveLength(0);
    });

    it('scoped [dashboard] — discards dashboard + dirty child, leaves unrelated', async () => {
      await loadFilesIntoRedux(store, [question1Id, question2Id, question3Id, dashboardId]);
      editInRedux(store, question1Id, { description: 'Child edit' });
      editInRedux(store, dashboardId, { description: 'Dashboard edit' });
      editInRedux(store, question3Id, { description: 'Unrelated edit' });

      expect(getDirtyFileIds(store)).toHaveLength(3);

      discardAll([dashboardId]);

      const dirtyAfter = getDirtyFileIds(store);
      expect(dirtyAfter).toHaveLength(1);
      expect(dirtyAfter).toContain(question3Id);

      const q1 = getFileFromRedux(store, question1Id);
      expect(Object.keys(q1.persistableChanges || {})).toHaveLength(0);
      const dash = getFileFromRedux(store, dashboardId);
      expect(Object.keys(dash.persistableChanges || {})).toHaveLength(0);
    });

    it('scoped [dashboard] — dashboard clean, child dirty → discards child', async () => {
      await loadFilesIntoRedux(store, [question1Id, question2Id, question3Id, dashboardId]);
      editInRedux(store, question1Id, { description: 'Child-only dirty' });
      editInRedux(store, question3Id, { description: 'Unrelated still dirty' });

      expect(getDirtyFileIds(store)).toHaveLength(2);

      discardAll([dashboardId]);

      const dirtyAfter = getDirtyFileIds(store);
      expect(dirtyAfter).toHaveLength(1);
      expect(dirtyAfter).toContain(question3Id);

      const q1 = getFileFromRedux(store, question1Id);
      expect(Object.keys(q1.persistableChanges || {})).toHaveLength(0);
    });

    it('scoped [question] — discards just that file, leaves others dirty', async () => {
      await loadFilesIntoRedux(store, [question1Id, question3Id]);
      editInRedux(store, question1Id, { description: 'Discard me' });
      editInRedux(store, question3Id, { description: 'Keep me dirty' });

      discardAll([question1Id]);

      const dirtyAfter = getDirtyFileIds(store);
      expect(dirtyAfter).toHaveLength(1);
      expect(dirtyAfter).toContain(question3Id);
    });

    it('scoped [dashboard] — draft child edits cleared in Redux on discard', async () => {
      await loadFilesIntoRedux(store, [question1Id, question2Id, dashboardId]);

      // Create a draft question in DB (simulates createDraftFile outcome)
      const draftQId = await DocumentDB.create(
        'Temp Draft',
        '/org/temp-draft',
        'question',
        { description: 'Temp', query: 'SELECT 1', connection_name: 'test_db', parameters: [], vizSettings: { type: 'table' } } as QuestionContent,
        []
      );
      const draftFile = await DocumentDB.getById(draftQId);
      store.dispatch({ type: 'files/setFile', payload: { file: draftFile } });
      editInRedux(store, draftQId, { description: 'Updated temp draft' });
      store.dispatch({
        type: 'files/addQuestionToDashboard',
        payload: { dashboardId, questionId: draftQId }
      });

      expect(getDirtyFileIds(store)).toContain(draftQId);
      expect(getFileFromRedux(store, draftQId)).toBeDefined();

      discardAll([dashboardId]);

      expect(getDirtyFileIds(store)).toHaveLength(0);
      const dash = getFileFromRedux(store, dashboardId);
      expect(Object.keys(dash.persistableChanges || {})).toHaveLength(0);
      // Draft file edits cleared — file stays in Redux (it has a real positive ID)
      const draftInRedux = getFileFromRedux(store, draftQId);
      expect(draftInRedux).toBeDefined();
      expect(Object.keys(draftInRedux.persistableChanges || {})).toHaveLength(0);
    });
  });
});
