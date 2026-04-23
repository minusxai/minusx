/**
 * Draft File E2E Tests
 *
 * Specification for the draft-file system replacing virtual (negative) IDs:
 *
 *   1. DocumentDB.create() stores files with draft: true by default.
 *   2. listAll() / getFiles() / getByPath() filter out draft files.
 *   3. getById() returns draft files — they are directly accessible.
 *   4. DocumentDB.update() always sets draft: false (first real save publishes the file).
 *   5. DocumentDB.batchSave(files, dryRun: true) wraps in a transaction that always
 *      rolls back — returns per-file success/error without touching the DB.
 *   6. createDraftFile() replaces createVirtualFile(): calls the server, gets a real
 *      positive ID with draft: true, stores the file in Redux with that ID.
 *   7. dryRunSave() collects all dirty Redux files and batch-saves them with dryRun:true.
 *   8. publishAll() no longer needs topological sort or batch-create — all files already
 *      have real positive IDs from createDraftFile(), so one batch-save suffices.
 *
 * Pattern: follows publishAllE2E.test.ts — no Python backend, direct route calls.
 */

import { configureStore } from '@reduxjs/toolkit';
import filesReducer, { selectDirtyFiles } from '../filesSlice';
import queryResultsReducer from '../queryResultsSlice';
import authReducer from '../authSlice';
import { getTestDbPath, initTestDatabase, cleanupTestDatabase } from './test-utils';
import { DocumentDB } from '@/lib/database/documents-db';
import type { QuestionContent, DocumentContent, UserRole } from '@/lib/types';
import { createDraftFile, publishAll, dryRunSave } from '@/lib/api/file-state';
import type { Mode } from '@/lib/mode/mode-types';
import { POST as createFileHandler } from '@/app/api/files/route';
import { POST as batchSaveHandler } from '@/app/api/files/batch-save/route';
import { POST as templateHandler } from '@/app/api/files/template/route';
import { setupMockFetch } from '@/test/harness/mock-fetch';

// ---------------------------------------------------------------------------
// Jest module mocks — hoisted to top of file by Jest
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const TEST_AUTH_STATE = {
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
    reducer: {
      files: filesReducer,
      queryResults: queryResultsReducer,
      auth: authReducer,
    },
    preloadedState: { auth: TEST_AUTH_STATE },
  });
}

/** Create a minimal QuestionContent for test fixtures. */
function questionContent(description: string): QuestionContent {
  return {
    description,
    query: 'SELECT 1',
    connection_name: 'test_db',
    parameters: [],
    vizSettings: { type: 'table' },
  };
}

/** Create a real (non-draft) file in the DB: create → update to clear draft flag. */
async function createPublishedFile(
  name: string,
  path: string,
  type: string,
  content: QuestionContent | DocumentContent,
  references: number[] = []
): Promise<number> {
  const id = await DocumentDB.create(name, path, type, content as any, references);
  await DocumentDB.update(id, name, path, content as any, references, `init-${id}`);
  return id;
}

// ============================================================================
// 1. DocumentDB draft behavior (no Redux, no fetch mock needed)
// ============================================================================

describe('DocumentDB draft behavior', () => {
  const dbPath = getTestDbPath('draft_db_unit');

  beforeAll(async () => {
    await initTestDatabase(dbPath);
  });

  afterAll(async () => {
    await cleanupTestDatabase(dbPath);
  });

  it('create() stores files with draft: true by default', async () => {
    const id = await DocumentDB.create(
      'Draft Question',
      '/org/draft-q-1',
      'question',
      questionContent('draft'),
      []
    );

    const file = await DocumentDB.getById(id);
    expect(file).not.toBeNull();
    expect(file!.id).toBeGreaterThan(0);
    expect(file!.draft).toBe(true);
  });

  it('listAll() excludes draft files', async () => {
    // The draft file created above must NOT appear in listAll
    const all = await DocumentDB.listAll('question', ['/org']);
    const found = all.find(f => f.path === '/org/draft-q-1');
    expect(found).toBeUndefined();
  });

  it('getById() returns draft files directly', async () => {
    const id = await DocumentDB.create(
      'Direct Draft',
      '/org/draft-q-direct',
      'question',
      questionContent('direct'),
      []
    );

    const file = await DocumentDB.getById(id);
    expect(file).not.toBeNull();
    expect(file!.draft).toBe(true);
    expect(file!.id).toBe(id);
  });

  it('update() sets draft: false (first real save publishes the file)', async () => {
    const id = await DocumentDB.create(
      'To Publish',
      '/org/draft-q-publish',
      'question',
      questionContent('original'),
      []
    );

    const before = await DocumentDB.getById(id);
    expect(before!.draft).toBe(true);

    await DocumentDB.update(
      id, 'To Publish', '/org/draft-q-publish',
      questionContent('updated'), [], 'edit-1'
    );

    const after = await DocumentDB.getById(id);
    expect(after!.draft).toBe(false);
    expect((after!.content as QuestionContent).description).toBe('updated');
  });

  it('listAll() includes non-draft files', async () => {
    // The file published in the test above should appear now
    const all = await DocumentDB.listAll('question', ['/org']);
    const found = all.find(f => f.path === '/org/draft-q-publish');
    expect(found).toBeDefined();
    expect(found!.draft).toBe(false);
  });
});

// ============================================================================
// 2. DocumentDB.batchSave with dryRun
// ============================================================================

describe('DocumentDB.batchSave dryRun', () => {
  const dbPath = getTestDbPath('draft_dryrun_unit');
  let fileAId: number;
  let fileBId: number;

  beforeAll(async () => {
    await initTestDatabase(dbPath);
    fileAId = await createPublishedFile('File A', '/org/file-a', 'question', questionContent('file-a'));
    fileBId = await createPublishedFile('File B', '/org/file-b', 'question', questionContent('file-b'));
  });

  afterAll(async () => {
    await cleanupTestDatabase(dbPath);
  });

  it('dryRun:true returns success without committing (DB unchanged)', async () => {
    const fileA = await DocumentDB.getById(fileAId);
    const result = await DocumentDB.batchSave(
      [{
        id: fileAId,
        name: 'File A',
        path: '/org/file-a',
        content: questionContent('dry-run-edit'),
        references: [],
        editId: 'dry-1',
        expectedVersion: fileA!.version,
      }],
      true  // dryRun
    );

    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);

    // DB is UNCHANGED — the transaction was rolled back
    const afterA = await DocumentDB.getById(fileAId);
    expect((afterA!.content as QuestionContent).description).toBe('file-a');
    expect(afterA!.version).toBe(fileA!.version);  // version not incremented
  });

  it('dryRun:false actually commits', async () => {
    const fileA = await DocumentDB.getById(fileAId);
    const result = await DocumentDB.batchSave(
      [{
        id: fileAId,
        name: 'File A',
        path: '/org/file-a',
        content: questionContent('real-edit'),
        references: [],
        editId: 'real-1',
        expectedVersion: fileA!.version,
      }],
      false  // real save
    );

    expect(result.success).toBe(true);

    // DB IS changed
    const afterA = await DocumentDB.getById(fileAId);
    expect((afterA!.content as QuestionContent).description).toBe('real-edit');
  });

  it('dryRun:true returns error on path conflict without committing', async () => {
    // Attempt to move File A to File B's path (UNIQUE constraint violation)
    const fileA = await DocumentDB.getById(fileAId);
    const result = await DocumentDB.batchSave(
      [{
        id: fileAId,
        name: 'File A',
        path: '/org/file-b',  // conflicts with File B
        content: fileA!.content as QuestionContent,
        references: [],
        editId: 'conflict-1',
        expectedVersion: fileA!.version,
      }],
      true  // dryRun
    );

    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].id).toBe(fileAId);

    // DB is UNCHANGED
    const afterA = await DocumentDB.getById(fileAId);
    expect(afterA!.path).toBe('/org/file-a');
  });

  it('dryRun:true with cross-file conflict catches the collective result', async () => {
    // File A moves to /org/cross-target, File B moves to /org/cross-target too (conflict)
    const fileA = await DocumentDB.getById(fileAId);
    const fileB = await DocumentDB.getById(fileBId);

    const result = await DocumentDB.batchSave(
      [
        {
          id: fileAId,
          name: 'File A',
          path: '/org/cross-target',
          content: fileA!.content as QuestionContent,
          references: [],
          editId: 'cross-a',
          expectedVersion: fileA!.version,
        },
        {
          id: fileBId,
          name: 'File B',
          path: '/org/cross-target',  // conflict with the fileA row being inserted above
          content: fileB!.content as QuestionContent,
          references: [],
          editId: 'cross-b',
          expectedVersion: fileB!.version,
        },
      ],
      true  // dryRun
    );

    expect(result.success).toBe(false);

    // DB is UNCHANGED for both
    const afterA = await DocumentDB.getById(fileAId);
    const afterB = await DocumentDB.getById(fileBId);
    expect(afterA!.path).toBe('/org/file-a');
    expect(afterB!.path).toBe('/org/file-b');
  });
});

// ============================================================================
// 3. createDraftFile() — file-state.ts integration
// ============================================================================

describe('createDraftFile', () => {
  const dbPath = getTestDbPath('draft_create_state');
  let store: ReturnType<typeof makeStore>;

  // Order matters: template and batch-save must match before the generic /api/files
  const mockFetch = setupMockFetch({
    getPythonPort: () => 0,
    interceptors: [
      { includesUrl: ['/api/files/template'], handler: templateHandler },
      { includesUrl: ['/api/files/batch-save'], handler: batchSaveHandler },
      { includesUrl: ['/api/files'], handler: createFileHandler },
    ],
  });

  beforeAll(async () => {
    await initTestDatabase(dbPath);
    // Pre-create sub-folders so each test can create draft files in a unique location
    for (let i = 1; i <= 4; i++) {
      const folderId = await DocumentDB.create(`draft-test-${i}`, `/org/draft-test-${i}`, 'folder', { description: '' } as any, []);
      // Publish the folder (draft:false) so it's a valid parent
      await DocumentDB.update(folderId, `draft-test-${i}`, `/org/draft-test-${i}`, { description: '' } as any, [], `folder-init-${i}`);
    }
  });

  afterAll(async () => {
    await cleanupTestDatabase(dbPath);
  });

  beforeEach(() => {
    store = makeStore();
    testStore = store;
    mockFetch.mockClear();
  });

  it('returns a real positive ID (not negative)', async () => {
    const id = await createDraftFile('question', { folder: '/org/draft-test-1' });
    expect(id).toBeGreaterThan(0);
  });

  it('creates a file in DB with draft: true', async () => {
    const id = await createDraftFile('question', { folder: '/org/draft-test-2' });

    const dbFile = await DocumentDB.getById(id);
    expect(dbFile).not.toBeNull();
    expect(dbFile!.draft).toBe(true);
    expect(dbFile!.id).toBe(id);
  });

  it('stores the file in Redux with the same real positive ID and draft: true', async () => {
    const id = await createDraftFile('question', { folder: '/org/draft-test-3' });

    const reduxFile = (store.getState() as any).files.files[id];
    expect(reduxFile).toBeDefined();
    expect(reduxFile.id).toBe(id);
    expect(reduxFile.draft).toBe(true);
  });

  it('draft file does not appear in folder listing (listAll)', async () => {
    const id = await createDraftFile('question', { folder: '/org/draft-test-4' });

    const all = await DocumentDB.listAll('question', ['/org/draft-test-4']);
    expect(all.find(f => f.id === id)).toBeUndefined();
  });
});

// ============================================================================
// 4. dryRunSave() — file-state.ts integration
// ============================================================================

describe('dryRunSave', () => {
  const dbPath = getTestDbPath('draft_dryrun_state');
  let store: ReturnType<typeof makeStore>;
  let fileId: number;

  const mockFetch = setupMockFetch({
    getPythonPort: () => 0,
    interceptors: [
      { includesUrl: ['/api/files/batch-save'], handler: batchSaveHandler },
    ],
  });

  beforeAll(async () => {
    await initTestDatabase(dbPath);
    fileId = await createPublishedFile('DryRun File', '/org/dryrun-file', 'question', questionContent('original'));
  });

  afterAll(async () => {
    await cleanupTestDatabase(dbPath);
  });

  beforeEach(async () => {
    store = makeStore();
    testStore = store;
    mockFetch.mockClear();
    const file = await DocumentDB.getById(fileId);
    store.dispatch({ type: 'files/setFile', payload: { file } });
  });

  it('returns success and leaves DB unchanged when all edits are valid', async () => {
    store.dispatch({ type: 'files/setEdit', payload: { fileId, edits: { description: 'dry-run-edit' } } });

    const result = await dryRunSave();

    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);

    // DB is UNCHANGED
    const dbFile = await DocumentDB.getById(fileId);
    expect((dbFile!.content as QuestionContent).description).toBe('original');
  });

  it('is a no-op when no files are dirty', async () => {
    // Nothing dirty
    const result = await dryRunSave();
    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ============================================================================
// 5. publishAll() simplified — no batch-create, no topological sort
// ============================================================================

describe('publishAll with draft files', () => {
  const dbPath = getTestDbPath('draft_publish_e2e');
  let store: ReturnType<typeof makeStore>;
  let existingQuestionId: number;
  let dashboardId: number;

  // Intercept template, create (for createDraftFile), and batch-save (for publishAll)
  const mockFetch = setupMockFetch({
    getPythonPort: () => 0,
    interceptors: [
      { includesUrl: ['/api/files/template'], handler: templateHandler },
      { includesUrl: ['/api/files/batch-save'], handler: batchSaveHandler },
      { includesUrl: ['/api/files'], handler: createFileHandler },
    ],
  });

  beforeAll(async () => {
    await initTestDatabase(dbPath);

    existingQuestionId = await createPublishedFile(
      'Existing Q', '/org/existing-q', 'question', questionContent('original-q')
    );

    dashboardId = await createPublishedFile(
      'Dashboard', '/org/dashboard', 'dashboard',
      {
        description: 'dashboard',
        assets: [{ type: 'question', id: existingQuestionId }],
        layout: { columns: 12, items: [{ id: existingQuestionId, x: 0, y: 0, w: 12, h: 4 }] },
      } as DocumentContent,
      [existingQuestionId]
    );
  });

  afterAll(async () => {
    await cleanupTestDatabase(dbPath);
  });

  beforeEach(async () => {
    store = makeStore();
    testStore = store;
    mockFetch.mockClear();
    const q = await DocumentDB.getById(existingQuestionId);
    const dash = await DocumentDB.getById(dashboardId);
    store.dispatch({ type: 'files/setFiles', payload: { files: [q, dash] } });
  });

  it('saves draft + existing files without calling batch-create', async () => {
    // createDraftFile returns a real positive ID immediately — no negative ID
    const draftId = await createDraftFile('question', { folder: '/org' });
    expect(draftId).toBeGreaterThan(0);

    // Verify it's draft in DB
    const draftBefore = await DocumentDB.getById(draftId);
    expect(draftBefore!.draft).toBe(true);

    // Edit the draft (real positive ID in Redux)
    store.dispatch({ type: 'files/setEdit', payload: { fileId: draftId, edits: questionContent('new-question') } });

    // Add draft to dashboard using its REAL positive ID — no negative ID remapping needed
    store.dispatch({ type: 'files/addQuestionToDashboard', payload: { dashboardId, questionId: draftId } });

    // Edit the existing question too
    store.dispatch({ type: 'files/setEdit', payload: { fileId: existingQuestionId, edits: { description: 'updated-q' } } });

    const dirtyIds = selectDirtyFiles((store.getState() as any)).map(f => f.id);
    expect(dirtyIds).toContain(draftId);
    expect(dirtyIds).toContain(dashboardId);
    expect(dirtyIds).toContain(existingQuestionId);

    // -----------------------------------------------------------------------
    // publishAll — must NOT call batch-create; one batch-save suffices
    // -----------------------------------------------------------------------
    await publishAll();

    const fetchUrls = mockFetch.mock.calls.map((c: any[]) => c[0].toString());
    expect(fetchUrls.some((u: string) => u.includes('batch-create'))).toBe(false);
    expect(fetchUrls.some((u: string) => u.includes('batch-save'))).toBe(true);

    // Draft question is now published (draft: false)
    const savedDraft = await DocumentDB.getById(draftId);
    expect(savedDraft).not.toBeNull();
    expect(savedDraft!.draft).toBe(false);
    expect((savedDraft!.content as QuestionContent).description).toBe('new-question');

    // Dashboard references the real positive ID — no ID remapping occurred
    const savedDash = await DocumentDB.getById(dashboardId);
    const assetIds = ((savedDash!.content as DocumentContent).assets || []).map((a: any) => a.id);
    expect(assetIds).toContain(draftId);
    expect(assetIds).toContain(existingQuestionId);
    expect(assetIds.every((id: number) => id > 0)).toBe(true);

    // Existing question edit saved
    const savedQ = await DocumentDB.getById(existingQuestionId);
    expect((savedQ!.content as QuestionContent).description).toBe('updated-q');

    // Redux is clean
    const dirtyAfter = selectDirtyFiles((store.getState() as any));
    expect(dirtyAfter).toHaveLength(0);
  });

  it('is a no-op when nothing is dirty', async () => {
    const result = await publishAll();
    expect(result).toEqual({});
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
