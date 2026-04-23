/**
 * publishAll E2E Test
 *
 * Tests the full publishAll() flow end-to-end:
 *
 *   1. A dashboard with 2 existing questions is set up in DB.
 *   2. Both existing questions get content edits in Redux.
 *   3. A brand-new virtual question (negative ID) is added to Redux.
 *   4. The virtual question is added to the dashboard via addQuestionToDashboard
 *      → dashboard's persistableChanges contain a negative ID in assets + layout.
 *   5. publishAll() is called.
 *   6. Assertions:
 *      a. New question exists in DB with a real positive ID.
 *      b. Dashboard assets and layout items no longer reference the virtual ID —
 *         they reference the newly-assigned real ID.
 *      c. Both existing questions have their description changes saved in DB.
 *      d. Redux has no remaining dirty files (all persistableChanges cleared).
 *
 * Pattern: follows read-write-e2e.test.ts — no Python backend, direct route calls.
 *
 * Auth: re-mocks getEffectiveUser (same as read-write-e2e.test.ts) to ensure the
 * test user has mode:'org' and home_folder:'/org', which allows creating files
 * under /org and is consistent with what DocumentDB.create uses in beforeAll.
 */

import { configureStore } from '@reduxjs/toolkit';
import filesReducer, { generateVirtualId, selectDirtyFiles } from '../filesSlice';
import queryResultsReducer from '../queryResultsSlice';
import authReducer from '../authSlice';
import { getTestDbPath, initTestDatabase, cleanupTestDatabase } from './test-utils';
import { DocumentDB } from '@/lib/database/documents-db';
import type { QuestionContent, DocumentContent, UserRole } from '@/lib/types';
import { publishAll, discardAll } from '@/lib/api/file-state';
import type { Mode } from '@/lib/mode/mode-types';
import { POST as batchCreateHandler } from '@/app/api/files/batch-create/route';
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

function addVirtualQuestion(s: ReturnType<typeof makeStore>, name: string, path: string): number {
  const virtualId = generateVirtualId();
  const content: QuestionContent = {
    description: `${name} description`,
    query: `SELECT * FROM ${name.toLowerCase().replace(/\s/g, '_')}`,
    connection_name: 'test_db',
    parameters: [],
    vizSettings: { type: 'table' }
  };
  s.dispatch({
    type: 'files/setFile',
    payload: {
      file: {
        id: virtualId, name, path, type: 'question',
        content, references: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
    }
  });
  s.dispatch({ type: 'files/setEdit', payload: { fileId: virtualId, edits: content } });
  return virtualId;
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
      { includesUrl: ['/api/files/batch-create'], handler: batchCreateHandler },
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
  // Main test: full publish flow
  // -------------------------------------------------------------------------

  it('creates virtual question, rewires dashboard references, and saves all dirty files', async () => {

    // -----------------------------------------------------------------------
    // Step 1: Load existing files into Redux (simulate page load)
    // -----------------------------------------------------------------------
    const q1File = await DocumentDB.getById(question1Id);
    const q2File = await DocumentDB.getById(question2Id);
    const dashFile = await DocumentDB.getById(dashboardId);

    expect(q1File).toBeDefined();
    expect(q2File).toBeDefined();
    expect(dashFile).toBeDefined();

    store.dispatch({ type: 'files/setFiles', payload: { files: [q1File, q2File, dashFile] } });

    // Sanity: nothing dirty yet
    const stateAfterLoad = store.getState() as any;
    const dirtyAtLoad = Object.values(stateAfterLoad.files.files).filter(
      (f: any) => f && Object.keys(f.persistableChanges || {}).length > 0
    );
    expect(dirtyAtLoad).toHaveLength(0);
    console.log('✓ Step 1: files loaded into Redux, no dirty state');

    // -----------------------------------------------------------------------
    // Step 2: Edit question 1 and question 2 (description changes)
    // -----------------------------------------------------------------------
    store.dispatch({
      type: 'files/setEdit',
      payload: { fileId: question1Id, edits: { description: 'Updated revenue by month' } }
    });
    store.dispatch({
      type: 'files/setEdit',
      payload: { fileId: question2Id, edits: { description: 'Updated active user count' } }
    });

    const stateAfterEdits = store.getState() as any;
    expect(stateAfterEdits.files.files[question1Id].persistableChanges.description)
      .toBe('Updated revenue by month');
    expect(stateAfterEdits.files.files[question2Id].persistableChanges.description)
      .toBe('Updated active user count');
    console.log('✓ Step 2: questions 1 & 2 have unsaved description changes');

    // -----------------------------------------------------------------------
    // Step 3: Create a virtual new question in Redux (negative ID)
    // -----------------------------------------------------------------------
    const virtualId = generateVirtualId();

    const virtualContent: QuestionContent = {
      description: 'Brand new question',
      query: 'SELECT id, name FROM new_table LIMIT 10',
      connection_name: 'test_db',
      parameters: [],
      vizSettings: { type: 'table' }
    };

    // Add to Redux, then mark dirty with its own content
    store.dispatch({
      type: 'files/setFile',
      payload: {
        file: {
          id: virtualId,
          name: 'New Question',
          path: '/org/new-question',
          type: 'question',
          content: virtualContent,
          references: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        },
        references: []
      }
    });
    store.dispatch({ type: 'files/setEdit', payload: { fileId: virtualId, edits: virtualContent } });

    const stateAfterVirtual = store.getState() as any;
    expect(stateAfterVirtual.files.files[virtualId]).toBeDefined();
    expect(Object.keys(stateAfterVirtual.files.files[virtualId].persistableChanges).length)
      .toBeGreaterThan(0);
    console.log(`✓ Step 3: virtual question in Redux with ID: ${virtualId}`);

    // -----------------------------------------------------------------------
    // Step 4: Add virtual question to the dashboard
    //   addQuestionToDashboard puts the negative virtualId in persistableChanges.assets
    //   and in layout.items (as a string, since the reducer calls questionId.toString()).
    //   publishAll must detect and rewrite both.
    // -----------------------------------------------------------------------
    store.dispatch({
      type: 'files/addQuestionToDashboard',
      payload: { dashboardId, questionId: virtualId }
    });

    const stateAfterDashEdit = store.getState() as any;
    const dashChanges = stateAfterDashEdit.files.files[dashboardId].persistableChanges;

    // assets must contain the virtual ID
    const assetIdsBefore = (dashChanges.assets || []).map((a: any) => a.id);
    expect(assetIdsBefore).toContain(virtualId);

    // layout items contain the virtual ID (stored as string by addQuestionToDashboard)
    const layoutItemIdsBefore = (dashChanges.layout?.items || []).map((item: any) =>
      typeof item.id === 'string' ? parseInt(item.id, 10) : item.id
    );
    expect(layoutItemIdsBefore).toContain(virtualId);
    console.log(`✓ Step 4: dashboard assets + layout contain virtual ID ${virtualId}`);

    // Total dirty files before publish: q1 + q2 + dashboard + virtualQuestion = 4
    const allFilesBefore = Object.values(stateAfterDashEdit.files.files) as any[];
    const dirtyBefore = allFilesBefore.filter(
      (f: any) => f && Object.keys(f.persistableChanges || {}).length > 0
    );
    expect(dirtyBefore).toHaveLength(4);
    console.log('✓ 4 dirty files before publishAll (q1, q2, dashboard, virtual question)');

    // -----------------------------------------------------------------------
    // Step 5: publishAll()
    //
    // Internally this runs three steps:
    //   1. POST /api/files/batch-create  → creates virtual question, gets real ID
    //   2. dispatch(replaceVirtualIds(idMap))  → single atomic Redux action that
    //      rewrites the negative ID in dashboard's persistableChanges.assets and
    //      layout.items before anything is persisted
    //   3. POST /api/files/batch-save  → saves dashboard (now with real IDs) +
    //      both question edits in one round trip
    // -----------------------------------------------------------------------
    await publishAll();
    console.log('✓ Step 5: publishAll() completed');

    // Exactly 2 fetch calls: one batch-create, one batch-save (no per-file calls)
    const fetchCalls = mockFetch.mock.calls.map((call: any[]) => call[0].toString());
    expect(fetchCalls.some((u: string) => u.includes('batch-create'))).toBe(true);
    expect(fetchCalls.some((u: string) => u.includes('batch-save'))).toBe(true);
    expect(fetchCalls).toHaveLength(2);
    console.log('✓ Exactly 2 API calls: batch-create + batch-save');

    // replaceVirtualIds acted atomically: dashboard should have no negative IDs
    // in its Redux persistableChanges right after publishAll resolves
    // (clearEdits was dispatched afterward, so check the real DB — see step 6b)
    const statePostPublish = store.getState() as any;
    const dashAfter = statePostPublish.files.files[dashboardId];
    // persistableChanges are cleared after save — verify no leftover negative IDs
    if (dashAfter?.persistableChanges?.assets) {
      const leftoverNegative = dashAfter.persistableChanges.assets.some((a: any) => a.id < 0);
      expect(leftoverNegative).toBe(false);
    }

    // -----------------------------------------------------------------------
    // Step 6a: New question was created with a real positive ID
    // -----------------------------------------------------------------------
    const stateAfterPublish = store.getState() as any;

    // addFile() was dispatched → the real file now exists in Redux
    const allFilesAfter = Object.values(stateAfterPublish.files.files) as any[];
    const newQuestion = allFilesAfter.find(
      (f: any) => f.id > 0 && f.name === 'New Question' && f.type === 'question'
    );
    expect(newQuestion).toBeDefined();
    const newQuestionId: number = newQuestion!.id;
    expect(newQuestionId).toBeGreaterThan(0);
    console.log(`✓ Step 6a: virtual ${virtualId} → real ID ${newQuestionId}`);

    // Verify content in DB
    const dbNewQuestion = await DocumentDB.getById(newQuestionId);
    expect(dbNewQuestion).toBeDefined();
    expect(dbNewQuestion!.name).toBe('New Question');
    const dbNewContent = dbNewQuestion!.content as QuestionContent;
    expect(dbNewContent.description).toBe('Brand new question');
    expect(dbNewContent.query).toBe('SELECT id, name FROM new_table LIMIT 10');
    console.log('✓ Step 6a: new question content correct in DB');

    // -----------------------------------------------------------------------
    // Step 6b: Dashboard references the real ID, not the virtual ID
    // -----------------------------------------------------------------------
    const dbDash = await DocumentDB.getById(dashboardId);
    expect(dbDash).toBeDefined();
    const dbDashContent = dbDash!.content as DocumentContent;

    // assets: newQuestionId present, virtualId absent, original IDs intact
    const dbAssetIds = (dbDashContent.assets || []).map((a: any) => a.id);
    expect(dbAssetIds).toContain(newQuestionId);
    expect(dbAssetIds).not.toContain(virtualId);
    expect(dbAssetIds).toContain(question1Id);
    expect(dbAssetIds).toContain(question2Id);
    console.log(`✓ Step 6b: dashboard assets rewritten — ${virtualId} → ${newQuestionId}`);

    // layout items: all IDs are positive, newQuestionId present
    const dbLayoutItems: any[] = (dbDashContent.layout as any)?.items || [];
    const dbLayoutItemIds = dbLayoutItems.map((item: any) =>
      typeof item.id === 'string' ? parseInt(item.id, 10) : item.id
    );
    expect(dbLayoutItemIds).toContain(newQuestionId);
    expect(dbLayoutItemIds.every((id: number) => id > 0)).toBe(true);
    console.log('✓ Step 6b: dashboard layout items all positive, new question present');

    // file_references column updated (used for sidebar reference counts etc.)
    const dbDashRefs: number[] = (dbDash!.references as any) || [];
    expect(dbDashRefs).toContain(newQuestionId);
    expect(dbDashRefs).not.toContain(virtualId);
    console.log('✓ Step 6b: dashboard file_references column correct');

    // -----------------------------------------------------------------------
    // Step 6c: Existing question edits were persisted
    // -----------------------------------------------------------------------
    const dbQ1 = await DocumentDB.getById(question1Id);
    const dbQ2 = await DocumentDB.getById(question2Id);
    expect((dbQ1!.content as QuestionContent).description).toBe('Updated revenue by month');
    expect((dbQ2!.content as QuestionContent).description).toBe('Updated active user count');
    console.log('✓ Step 6c: description changes saved for both existing questions');

    // -----------------------------------------------------------------------
    // Step 6d: Redux is clean — no dirty files remain
    // -----------------------------------------------------------------------
    const allFilesClean = Object.values(stateAfterPublish.files.files) as any[];
    const dirtyAfter = allFilesClean.filter(
      (f: any) => f && Object.keys(f.persistableChanges || {}).length > 0
    );
    expect(dirtyAfter).toHaveLength(0);
    console.log('✓ Step 6d: all persistableChanges cleared — Redux is clean');

    console.log('\n✓ publishAll E2E PASSED');
    console.log(`  virtual ${virtualId} → real question ${newQuestionId}`);
    console.log(`  saved: q${question1Id}, q${question2Id}, dashboard ${dashboardId}`);
  });

  // -------------------------------------------------------------------------
  // Edge case: no-op when nothing is dirty
  // -------------------------------------------------------------------------

  it('is a no-op when no files are dirty', async () => {
    // Load a file with no edits → nothing is dirty
    const q1File = await DocumentDB.getById(question1Id);
    store.dispatch({ type: 'files/setFiles', payload: { files: [q1File] } });

    const stateBefore = store.getState() as any;
    const dirtyBefore = Object.values(stateBefore.files.files).filter(
      (f: any) => f && Object.keys(f.persistableChanges || {}).length > 0
    );
    expect(dirtyBefore).toHaveLength(0);

    // publishAll should resolve without making any API calls
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

    it('creates virtual child and rewires dashboard refs', async () => {
      await loadFilesIntoRedux(store, [question1Id, question2Id, dashboardId]);

      const virtualId = addVirtualQuestion(store, 'Virtual Q', '/org/virtual-q');
      store.dispatch({
        type: 'files/addQuestionToDashboard',
        payload: { dashboardId, questionId: virtualId }
      });

      const dirtyBefore = getDirtyFileIds(store);
      expect(dirtyBefore).toContain(dashboardId);
      expect(dirtyBefore).toContain(virtualId);

      await publishAll([dashboardId]);

      expect(getDirtyFileIds(store)).toHaveLength(0);

      // Dashboard in DB has only positive IDs
      const dash = await DocumentDB.getById(dashboardId);
      const dashContent = dash!.content as DocumentContent;
      const assetIds = (dashContent.assets || []).map((a: any) => a.id);
      expect(assetIds.every((id: number) => id > 0)).toBe(true);
      expect(assetIds).not.toContain(virtualId);

      // Virtual file now exists in DB — find it by name among the new asset IDs
      const unknownIds = assetIds.filter((id: number) => id !== question1Id && id !== question2Id);
      const newQs = await Promise.all(unknownIds.map((id: number) => DocumentDB.getById(id)));
      const virtualQ = newQs.find(q => q?.name === 'Virtual Q');
      expect(virtualQ).toBeDefined();
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

    it('scoped [dashboard] — virtual child removed from Redux', async () => {
      await loadFilesIntoRedux(store, [question1Id, question2Id, dashboardId]);

      const virtualId = addVirtualQuestion(store, 'Temp Virtual', '/org/temp-virtual');
      store.dispatch({
        type: 'files/addQuestionToDashboard',
        payload: { dashboardId, questionId: virtualId }
      });

      expect(getDirtyFileIds(store)).toContain(virtualId);
      expect(getFileFromRedux(store, virtualId)).toBeDefined();

      discardAll([dashboardId]);

      expect(getDirtyFileIds(store)).toHaveLength(0);
      const dash = getFileFromRedux(store, dashboardId);
      expect(Object.keys(dash.persistableChanges || {})).toHaveLength(0);
      // Virtual file removed entirely from Redux
      expect(getFileFromRedux(store, virtualId)).toBeUndefined();
    });
  });
});
