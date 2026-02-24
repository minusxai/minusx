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
import filesReducer from '../filesSlice';
import queryResultsReducer from '../queryResultsSlice';
import authReducer from '../authSlice';
import { getTestDbPath, initTestDatabase, cleanupTestDatabase } from './test-utils';
import { DocumentDB } from '@/lib/database/documents-db';
import type { QuestionContent, DocumentContent, UserRole } from '@/lib/types';
import { publishAll } from '@/lib/api/file-state';
import type { Mode } from '@/lib/mode/mode-types';
import { POST as batchCreateHandler } from '@/app/api/files/batch-create/route';
import { POST as batchSaveHandler } from '@/app/api/files/batch-save/route';

// ---------------------------------------------------------------------------
// Jest module mocks — hoisted to top of file by Jest
// ---------------------------------------------------------------------------

// Isolated test database
jest.mock('@/lib/database/db-config', () => {
  const path = require('path');
  const dbPath = path.join(process.cwd(), 'data', 'test_publish_all_e2e.db');
  return {
    DB_PATH: dbPath,
    DB_DIR: path.join(process.cwd(), 'data'),
    getDbType: () => 'sqlite'
  };
});

// Make file-state.ts's getStore() return our test store
let testStore: any;
jest.mock('@/store/store', () => ({
  get store() { return testStore; },
  getStore: () => testStore
}));

// Override the global jest.setup.ts mock so we get mode:'org' and home_folder:'/org'
// (matches read-write-e2e.test.ts pattern)
jest.mock('@/lib/auth/auth-helpers', () => ({
  getEffectiveUser: jest.fn().mockResolvedValue({
    userId: 1,
    email: 'test@example.com',
    name: 'Test User',
    role: 'admin',
    companyId: 1,
    companyName: 'test-company',
    home_folder: '/org',
    mode: 'org'
  }),
  isAdmin: jest.fn().mockReturnValue(true)
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
    companyId: 1,
    companyName: 'test-company',
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
// Test suite
// ---------------------------------------------------------------------------

describe('publishAll E2E', () => {
  const dbPath = getTestDbPath('publish_all_e2e');
  let store: ReturnType<typeof makeStore>;
  let question1Id: number;
  let question2Id: number;
  let dashboardId: number;
  let mockFetch: jest.SpyInstance;

  // -------------------------------------------------------------------------
  // DB + fetch mock setup (once per describe block)
  // -------------------------------------------------------------------------

  beforeAll(async () => {
    const { NextRequest } = require('next/server');

    mockFetch = jest.spyOn(global, 'fetch').mockImplementation(
      async (url: string | Request | URL, init?: any) => {
        const urlStr = url.toString();

        if (urlStr.includes('/api/files/batch-create')) {
          const req = new NextRequest('http://localhost:3000/api/files/batch-create', {
            method: 'POST',
            body: init?.body,
            headers: { 'Content-Type': 'application/json' }
          });
          const res = await batchCreateHandler(req);
          const data = await res.json();
          return { ok: res.status === 200, status: res.status, json: async () => data } as Response;
        }

        if (urlStr.includes('/api/files/batch-save')) {
          const req = new NextRequest('http://localhost:3000/api/files/batch-save', {
            method: 'POST',
            body: init?.body,
            headers: { 'Content-Type': 'application/json' }
          });
          const res = await batchSaveHandler(req);
          const data = await res.json();
          return { ok: res.status === 200, status: res.status, json: async () => data } as Response;
        }

        throw new Error(`Unmocked fetch call: ${urlStr}`);
      }
    );

    await initTestDatabase(dbPath);
    const companyId = 1;

    question1Id = await DocumentDB.create(
      'Revenue Query',
      '/org/revenue-query',
      'question',
      {
        description: 'Revenue by month',
        query: 'SELECT month, SUM(revenue) FROM sales GROUP BY month',
        database_name: 'test_db',
        parameters: [],
        vizSettings: { type: 'table' }
      } as QuestionContent,
      [],
      companyId
    );

    question2Id = await DocumentDB.create(
      'User Count',
      '/org/user-count',
      'question',
      {
        description: 'Active user count',
        query: 'SELECT COUNT(*) FROM users WHERE active = true',
        database_name: 'test_db',
        parameters: [],
        vizSettings: { type: 'table' }
      } as QuestionContent,
      [],
      companyId
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
      [question1Id, question2Id],
      companyId
    );
  });

  afterAll(async () => {
    mockFetch.mockRestore();
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
    const q1File = await DocumentDB.getById(question1Id, 1);
    const q2File = await DocumentDB.getById(question2Id, 1);
    const dashFile = await DocumentDB.getById(dashboardId, 1);

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
    const virtualId = -Date.now();

    const virtualContent: QuestionContent = {
      description: 'Brand new question',
      query: 'SELECT id, name FROM new_table LIMIT 10',
      database_name: 'test_db',
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
          company_id: 1,
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
    const dbNewQuestion = await DocumentDB.getById(newQuestionId, 1);
    expect(dbNewQuestion).toBeDefined();
    expect(dbNewQuestion!.name).toBe('New Question');
    const dbNewContent = dbNewQuestion!.content as QuestionContent;
    expect(dbNewContent.description).toBe('Brand new question');
    expect(dbNewContent.query).toBe('SELECT id, name FROM new_table LIMIT 10');
    console.log('✓ Step 6a: new question content correct in DB');

    // -----------------------------------------------------------------------
    // Step 6b: Dashboard references the real ID, not the virtual ID
    // -----------------------------------------------------------------------
    const dbDash = await DocumentDB.getById(dashboardId, 1);
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
    const dbQ1 = await DocumentDB.getById(question1Id, 1);
    const dbQ2 = await DocumentDB.getById(question2Id, 1);
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
    const q1File = await DocumentDB.getById(question1Id, 1);
    store.dispatch({ type: 'files/setFiles', payload: { files: [q1File] } });

    const stateBefore = store.getState() as any;
    const dirtyBefore = Object.values(stateBefore.files.files).filter(
      (f: any) => f && Object.keys(f.persistableChanges || {}).length > 0
    );
    expect(dirtyBefore).toHaveLength(0);

    // publishAll should resolve without making any API calls
    await expect(publishAll()).resolves.toBeUndefined();
    expect(mockFetch).not.toHaveBeenCalled();

    console.log('✓ publishAll() is a no-op when no dirty files exist');
  });
});
