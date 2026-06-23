/**
 * Test for editFile functionality - verifies that editing a file properly
 * updates persistableChanges and isDirty state
 */
import { getTestDbPath, waitFor, initTestDatabase, cleanupTestDatabase } from './test-utils';
import { editFile, editFileStr, readFiles } from '@/lib/api/file-state';
import { selectIsDirty, selectMergedContent, selectFile, selectNotebookCellExecuted } from '@/store/filesSlice';
import { executeToolCall } from '@/lib/api/tool-handlers';
import { FilesAPI } from '@/lib/data/files';
import { QuestionContent, DashboardContent } from '@/lib/types';
import { configureStore } from '@reduxjs/toolkit';
import filesReducer from '../filesSlice';
import queryResultsReducer from '../queryResultsSlice';
import authReducer from '../authSlice';
import uiReducer from '../uiSlice';
import { NextRequest } from "next/server";
import { POST as batchPostHandler } from '@/app/api/files/batch/route';
import { DocumentDB } from '@/lib/database/documents-db';
import { getModules } from '@/lib/modules/registry';

// Mock db-config to use test database
vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

// Mock the store import so file-state.ts uses the test store
let testStore: any;
vi.mock('@/store/store', () => ({
  get store() {
    return testStore;
  },
  getStore: () => testStore
}));

// All DB-touching describes below share this PGLite (in-memory; module-mocked
// db-config → all dbPaths resolve to the same instance). Init the schema +
// workspace template ONCE per file instead of in every beforeEach — between
// tests we just clear non-template files via DELETE.
const SHARED_DB_PATH = getTestDbPath('edit_file');
beforeAll(async () => {
  await initTestDatabase(SHARED_DB_PATH);
});
afterAll(async () => {
  await cleanupTestDatabase(SHARED_DB_PATH);
});

async function clearFilesExceptOrg(): Promise<void> {
  await getModules().db.exec("DELETE FROM files WHERE path != '/org'", []);
}

describe('editFile - Question Editing Flow', () => {
  const dbPath = SHARED_DB_PATH;
  let questionId1: number;
  let questionId2: number;
  let questionId3: number;

  // Import API handlers (defined below at top-level static import)

  // Set up test store
  function setupStore() {
    return configureStore({
      reducer: {
        files: filesReducer,
        queryResults: queryResultsReducer,
        auth: authReducer
      }
    });
  }

  // Mock fetch to call API handlers
  beforeAll(() => {
    global.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url.toString();

      // Mock /api/files/batch (batch load)
      if (urlStr.includes('/api/files/batch')) {
        // Need full URL for Request constructor
        const fullUrl = urlStr.startsWith('http') ? urlStr : `http://localhost:3000${urlStr}`;
        const request = new NextRequest(fullUrl, { method: 'POST', ...init, headers: { ...init?.headers, 'x-user-id': '1' } } as any);
        const response = await batchPostHandler(request as NextRequest);
        const data = await response.json();
        return {
          ok: response.status === 200,
          status: response.status,
          json: async () => data
        } as Response;
      }

      throw new Error(`Unmocked fetch call to ${urlStr}`);
    });
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  beforeEach(async () => {
    await clearFilesExceptOrg();

    questionId1 = await DocumentDB.create('test-question-1', '/org/test-question-1', 'question', {
      query: 'SELECT 1', connection_name: 'test_db', parameters: [], references: [],
      vizSettings: { type: 'table', xCols: [], yCols: [] }
    } as QuestionContent, []);
    questionId2 = await DocumentDB.create('test-question-2', '/org/test-question-2', 'question', {
      query: 'SELECT 2', connection_name: 'test_db', parameters: [], references: [],
      vizSettings: { type: 'table', xCols: [], yCols: [] }
    } as QuestionContent, []);
    questionId3 = await DocumentDB.create('test-question-3', '/org/test-question-3', 'question', {
      query: 'SELECT 3', connection_name: 'test_db', parameters: [], references: [],
      vizSettings: { type: 'table', xCols: [], yCols: [] }
    } as QuestionContent, []);

    testStore = setupStore();
    vi.clearAllMocks();
  });

  afterEach(() => {
    testStore = null;
    if (global.gc) global.gc();
  });

  // Helper to get store in tests
  const getStore = () => testStore;

  it('should mark file as dirty when query is edited', async () => {
    const store = getStore();
    const fileId = questionId1;

    // Load the file into Redux
    await readFiles([fileId]);

    // Verify file exists and is not dirty initially
    const initialState = store.getState();
    const file = initialState.files.files[fileId];
    expect(file).toBeDefined();
    expect(selectIsDirty(initialState, fileId)).toBe(false);

    // Get original query
    const originalContent = selectMergedContent(initialState, fileId) as QuestionContent;
    const originalQuery = originalContent.query;
    console.log('Original query:', originalQuery);

    // Edit the query
    const newQuery = originalQuery + '\n-- test edit';
    console.log('Editing query to:', newQuery);

    editFile({
      fileId,
      changes: {
        content: {
          query: newQuery
        }
      }
    });

    // Wait for Redux state to update
    await waitFor(() => {
      const updatedState = store.getState();
      return selectIsDirty(updatedState, fileId) === true;
    }, 1000);

    // Verify file is now dirty
    const finalState = store.getState();
    const isDirty = selectIsDirty(finalState, fileId);
    console.log('isDirty after edit:', isDirty);
    expect(isDirty).toBe(true);

    // Verify mergedContent reflects the change
    const updatedContent = selectMergedContent(finalState, fileId) as QuestionContent;
    console.log('Updated query:', updatedContent.query);
    expect(updatedContent.query).toBe(newQuery);

    // Verify persistableChanges contains the edit
    const fileState = selectFile(finalState, fileId);
    console.log('persistableChanges:', fileState?.persistableChanges);
    expect(fileState?.persistableChanges).toMatchObject({
      query: newQuery
    });
    // Note: queryResultId is computed at the FileState level (not in persistableChanges)
  });

  it('should merge multiple edits correctly', async () => {
    const store = getStore();
    const fileId = questionId2;

    // Load the file into Redux
    await readFiles([fileId]);

    // Get original content
    const initialState = store.getState();
    const originalContent = selectMergedContent(initialState, fileId) as QuestionContent;

    // Edit query
    editFile({
      fileId,
      changes: {
        content: {
          query: 'SELECT * FROM test'
        }
      }
    });

    // Edit database
    editFile({
      fileId,
      changes: {
        content: {
          connection_name: 'new_db'
        }
      }
    });

    // Wait for updates
    await waitFor(() => {
      const state = store.getState();
      const content = selectMergedContent(state, fileId) as QuestionContent;
      return content.query === 'SELECT * FROM test' && content.connection_name === 'new_db';
    }, 1000);

    const finalState = store.getState();
    const fileState = selectFile(finalState, fileId);

    // Both changes should be in persistableChanges
    console.log('persistableChanges after multiple edits:', fileState?.persistableChanges);
    expect(fileState?.persistableChanges).toMatchObject({
      query: 'SELECT * FROM test',
      connection_name: 'new_db'
    });

    // Merged content should have both changes plus original fields
    const mergedContent = selectMergedContent(finalState, fileId) as QuestionContent;
    expect(mergedContent.query).toBe('SELECT * FROM test');
    expect(mergedContent.connection_name).toBe('new_db');

    // File should be dirty
    expect(selectIsDirty(finalState, fileId)).toBe(true);
  });

  it('should trigger selector updates (component re-render)', async () => {
    const store = getStore();
    const fileId = questionId1;

    // Load the file into Redux
    await readFiles([fileId]);

    // Get initial values from selectors (like QuestionContainerV2 does)
    const initialState = store.getState();
    const initialIsDirty = selectIsDirty(initialState, fileId);
    const initialMergedContent = selectMergedContent(initialState, fileId) as QuestionContent;

    console.log('BEFORE EDIT:');
    console.log('  isDirty:', initialIsDirty);
    console.log('  mergedContent.query:', initialMergedContent.query);

    expect(initialIsDirty).toBe(false);

    // Edit the query (like handleChange does)
    const newQuery = initialMergedContent.query + '\n-- edited';
    editFile({
      fileId,
      changes: {
        content: {
          query: newQuery
        }
      }
    });

    // Get values after edit
    const finalState = store.getState();
    const finalIsDirty = selectIsDirty(finalState, fileId);
    const finalMergedContent = selectMergedContent(finalState, fileId) as QuestionContent;

    console.log('AFTER EDIT:');
    console.log('  isDirty:', finalIsDirty);
    console.log('  mergedContent.query:', finalMergedContent.query);

    // These should be different - if they're the same, component won't re-render!
    expect(finalIsDirty).toBe(true);
    expect(finalMergedContent.query).toBe(newQuery);
    expect(finalMergedContent).not.toBe(initialMergedContent); // Different reference!
  });

  it('should handle nested property edits (vizSettings)', async () => {
    const store = getStore();
    const fileId = questionId3;

    // Load the file into Redux
    await readFiles([fileId]);

    // Edit vizSettings.type
    editFile({
      fileId,
      changes: {
        content: {
          vizSettings: {
            type: 'bar'
          }
        }
      }
    });

    await waitFor(() => {
      const state = store.getState();
      return selectIsDirty(state, fileId) === true;
    }, 1000);

    const finalState = store.getState();
    const mergedContent = selectMergedContent(finalState, fileId) as QuestionContent;

    console.log('vizSettings after edit:', mergedContent.vizSettings);
    expect(mergedContent.vizSettings?.type).toBe('bar');

    // File should be dirty
    expect(selectIsDirty(finalState, fileId)).toBe(true);
  });
});

describe('editFile - Question content validation', () => {
  const dbPath = getTestDbPath('edit_file'); // same mock path as db-config module mock above
  let questionId: number;



  function setupStore() {
    return configureStore({
      reducer: {
        files: filesReducer,
        queryResults: queryResultsReducer,
        auth: authReducer
      }
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
    await clearFilesExceptOrg();

    questionId = await DocumentDB.create('viz-validation-question', '/org/viz-validation-question', 'question', {
      query: 'SELECT 1', connection_name: 'test_db', parameters: [], references: [],
      vizSettings: { type: 'table', xCols: [], yCols: [] }
    } as QuestionContent, []);

    testStore = setupStore();
    vi.clearAllMocks();
  });

  afterEach(() => {
    testStore = null;
    if (global.gc) global.gc();
  });

  // Markup note: query/connection_name are schema `string` fields, so the markup
  // projection always coerces them to a valid string (an empty `<query></query>`
  // round-trips to "" which the schema accepts) — they can't be made null/invalid via
  // the markup surface. To preserve this test's intent (the validation gate rejects
  // schema-invalid question content with "Invalid question content"), we empty the
  // required `<vizSettings>` so its required `type` goes missing.
  it('rejects required vizSettings.type going missing', async () => {
    await readFiles([questionId]);
    const result = await editFileStr({
      fileId: questionId,
      oldMatch: `<vizSettings>
    <type>table</type>
    <xCols/>
    <yCols/>
  </vizSettings>`,
      newMatch: '<vizSettings/>',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid question content/);
  });

  // Markup note: see above — instead of nulling connection_name (impossible via markup),
  // we inject a wrong-typed value into a required array field (xCols expects an array of
  // strings) via the JSON-literal escape hatch, which the validator rejects.
  it('rejects wrong-typed xCols (object instead of array)', async () => {
    await readFiles([questionId]);
    const result = await editFileStr({
      fileId: questionId,
      oldMatch: '<xCols/>',
      newMatch: '<xCols>{{"a":1}}</xCols>',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid question content/);
  });

  it('rejects invalid visualization type', async () => {
    await readFiles([questionId]);
    const result = await editFileStr({
      fileId: questionId,
      oldMatch: '<type>table</type>',
      newMatch: '<type>invalid_chart_type</type>',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid question content/);
  });

  it('rejects pivot type without pivotConfig', async () => {
    await readFiles([questionId]);
    const result = await editFileStr({
      fileId: questionId,
      oldMatch: '<type>table</type>',
      newMatch: '<type>pivot</type>',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/pivotConfig is required/);
  });

  it('rejects pivot with missing required pivotConfig fields', async () => {
    await readFiles([questionId]);
    const result = await editFileStr({
      fileId: questionId,
      oldMatch: `<vizSettings>
    <type>table</type>
    <xCols/>
    <yCols/>
  </vizSettings>`,
      newMatch: '<vizSettings>\n    <type>pivot</type>\n    <pivotConfig>\n      <rows>\n        <item>region</item>\n      </rows>\n    </pivotConfig>\n  </vizSettings>',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid question content/);
  });

  it('accepts valid table viz (no xCols/yCols needed)', async () => {
    await readFiles([questionId]);
    const result = await editFileStr({
      fileId: questionId,
      oldMatch: `<vizSettings>
    <type>table</type>
    <xCols/>
    <yCols/>
  </vizSettings>`,
      newMatch: '<vizSettings>\n    <type>table</type>\n  </vizSettings>',
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid pivot with full pivotConfig', async () => {
    await readFiles([questionId]);
    const pivotViz = `<vizSettings>
    <type>pivot</type>
    <pivotConfig>
      <rows>
        <item>region</item>
      </rows>
      <columns>
        <item>year</item>
      </columns>
      <values>
        <item>
          <column>revenue</column>
          <aggFunction>SUM</aggFunction>
        </item>
      </values>
    </pivotConfig>
  </vizSettings>`;
    const result = await editFileStr({
      fileId: questionId,
      oldMatch: `<vizSettings>
    <type>table</type>
    <xCols/>
    <yCols/>
  </vizSettings>`,
      newMatch: pivotViz,
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid bar chart with xCols/yCols', async () => {
    await readFiles([questionId]);
    const result = await editFileStr({
      fileId: questionId,
      oldMatch: `<vizSettings>
    <type>table</type>
    <xCols/>
    <yCols/>
  </vizSettings>`,
      newMatch: '<vizSettings>\n    <type>bar</type>\n    <xCols>\n      <item>category</item>\n    </xCols>\n    <yCols>\n      <item>revenue</item>\n    </yCols>\n  </vizSettings>',
    });
    expect(result.success).toBe(true);
  });
});

describe('editFile - Dashboard content validation', () => {
  const dbPath = getTestDbPath('edit_file'); // same db-config mock path
  let dashboardId: number;



  // Initial dashboard content — serialises to a known JSON string for oldMatch
  const initialContent: DashboardContent = {
    assets: [{ type: 'question', id: 99 }],
    layout: { columns: 12, items: [{ id: 99, x: 0, y: 0, w: 6, h: 4 }] },
  };

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
    await clearFilesExceptOrg();

    dashboardId = await DocumentDB.create('test-dashboard', '/org/test-dashboard', 'dashboard', initialContent, []);

    testStore = setupStore();
    vi.clearAllMocks();
  });

  afterEach(() => {
    testStore = null;
    if (global.gc) global.gc();
  });

  // Markup note: a dashboard projects to a `<jsx>` body of `<Question id={N} .../>`
  // embeds. The asset *type* is derived from the tag (Question/text/img/hr), so an
  // "invalid discriminator" can't be expressed — and a non-numeric `id={...}` is simply
  // dropped (not invalid). To preserve the intent (the validation gate rejects malformed
  // dashboard content with "Invalid dashboard content"), we set a non-integer id, which
  // both AssetReference (Type.Integer) and the layout item id reject.
  it('rejects non-integer id in FileAssetRef', async () => {
    await readFiles([dashboardId]);
    const result = await editFileStr({
      fileId: dashboardId,
      oldMatch: 'id={99}',
      newMatch: 'id={99.5}',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid dashboard content/);
  });

  it('rejects non-integer layout x coordinate', async () => {
    await readFiles([dashboardId]);
    const result = await editFileStr({
      fileId: dashboardId,
      oldMatch: 'x={0}',
      newMatch: 'x={0.5}',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid dashboard content/);
  });

  it('rejects layout item w below minimum (2)', async () => {
    await readFiles([dashboardId]);
    const result = await editFileStr({
      fileId: dashboardId,
      oldMatch: 'w={6}',
      newMatch: 'w={1}',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid dashboard content/);
  });

  it('rejects layout item h below minimum (1)', async () => {
    await readFiles([dashboardId]);
    const result = await editFileStr({
      fileId: dashboardId,
      oldMatch: 'h={4}',
      newMatch: 'h={0}',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid dashboard content/);
  });

  it('accepts valid inline (text) asset', async () => {
    await readFiles([dashboardId]);
    const result = await editFileStr({
      fileId: dashboardId,
      oldMatch: '<Question id={99} x={0} y={0} w={6} h={4} />',
      newMatch: '<text x={0} y={0} w={6} h={4}>{`Section header`}</text>',
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid layout dimension change', async () => {
    await readFiles([dashboardId]);
    const result = await editFileStr({
      fileId: dashboardId,
      oldMatch: 'x={0} y={0} w={6} h={4}',
      newMatch: 'x={0} y={0} w={4} h={6}',
    });
    expect(result.success).toBe(true);
  });
});

describe('CreateFile tool - auto-execute query results', () => {
  function makeToolCall(args: Record<string, unknown>) {
    return {
      id: 'test-call-1',
      type: 'function' as const,
      function: { name: 'CreateFile', arguments: args },
    };
  }

  beforeAll(() => {
    global.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('/api/query')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: {
              columns: ['total_orders'],
              types: ['BIGINT'],
              rows: [{ total_orders: 42 }],
            },
          }),
        } as Response;
      }
      throw new Error(`Unmocked fetch call to ${urlStr}`);
    });
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    testStore = configureStore({
      reducer: { files: filesReducer, queryResults: queryResultsReducer, auth: authReducer, ui: uiReducer },
    });
    vi.spyOn(FilesAPI, 'getTemplate').mockImplementation(async (type) => {
      if (type === 'question') return {
        fileName: 'Untitled Question',
        content: {
          query: 'SELECT 1',
          connection_name: 'test_db',
          parameters: [],
          references: [],
          vizSettings: { type: 'table', xCols: [], yCols: [] },
        },
      };
      return { fileName: 'Untitled', content: {} };
    });
    let mockFileIdCounter = 9001;
    vi.spyOn(FilesAPI, 'createFile').mockImplementation(async (input) => ({
      data: {
        id: mockFileIdCounter++,
        name: input.name,
        path: input.path,
        type: input.type,
        content: input.content,
        references: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        version: 1,
        last_edit_id: null,
        draft: true,
        meta: null,
      },
    }));
  });

  afterEach(() => {
    vi.clearAllMocks();
    testStore = null;
  });

  it('populates queryResults with actual row data when CreateFile is called with a question + query', async () => {
    const result = await executeToolCall(
      makeToolCall({
        file_type: 'question',
        name: 'Total Overall Orders',
        content: {
          query: "SELECT COUNT(*) as total_orders FROM orders WHERE status = 'completed'",
          connection_name: 'mxfood',
        },
      }),
      {} as any
    );
    const parsed = JSON.parse(result.content as string);
    expect(parsed.success).toBe(true);

    const qr = parsed.state.queryResults[0];
    expect(qr).toBeDefined();
    expect(qr.totalRows).toBe(1);
    expect(qr.shownRows).toBe(1);
    expect(qr.truncated).toBe(false);
    expect(qr.data).toContain('| 42 |');
  });
});

describe('CreateFile tool - content validation', () => {
  const questionTemplate = {
    fileName: 'Untitled Question',
    content: {
      query: 'SELECT 1',
      connection_name: 'test_db',
      parameters: [],
      references: [],
      vizSettings: { type: 'table', xCols: [], yCols: [] },
    },
  };

  const dashboardTemplate = {
    fileName: 'Untitled Dashboard',
    content: {
      assets: [],
      layout: { columns: 12, items: [] },
    },
  };

  function makeToolCall(args: Record<string, unknown>) {
    return {
      id: 'test-call-1',
      type: 'function' as const,
      function: { name: 'CreateFile', arguments: args },
    };
  }

  beforeEach(() => {
    testStore = configureStore({
      reducer: { files: filesReducer, queryResults: queryResultsReducer, auth: authReducer, ui: uiReducer },
    });
    vi.spyOn(FilesAPI, 'getTemplate').mockImplementation(async (type) => {
      if (type === 'question') return questionTemplate;
      if (type === 'dashboard') return dashboardTemplate;
      return { fileName: 'Untitled', content: {} };
    });
    let mockFileIdCounter = 9001;
    vi.spyOn(FilesAPI, 'createFile').mockImplementation(async (input) => ({
      data: {
        id: mockFileIdCounter++,
        name: input.name,
        path: input.path,
        type: input.type,
        content: input.content,
        references: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        version: 1,
        last_edit_id: null,
        draft: true,
        meta: null,
      },
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    testStore = null;
  });

  it('creates a question with no content override and returns success', async () => {
    const result = await executeToolCall(
      makeToolCall({ file_type: 'question' }),
      {} as any
    );
    const parsed = JSON.parse(result.content as string);
    expect(parsed.success).toBe(true);
    expect(parsed.state.fileState.type).toBe('question');
    expect(parsed.state.fileState.isDirty).toBe(false);
  });

  it('creates a question with valid content override', async () => {
    const result = await executeToolCall(
      makeToolCall({
        file_type: 'question',
        name: 'My Query',
        content: { query: 'SELECT * FROM users', connection_name: 'prod' },
      }),
      {} as any
    );
    const parsed = JSON.parse(result.content as string);
    expect(parsed.success).toBe(true);
    expect(parsed.state.fileState.content.query).toBe('SELECT * FROM users');
  });

  it('rejects question with invalid vizSettings type', async () => {
    const result = await executeToolCall(
      makeToolCall({
        file_type: 'question',
        content: { vizSettings: { type: 'invalid_chart_type' } },
      }),
      {} as any
    );
    const parsed = JSON.parse(result.content as string);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toMatch(/Invalid content/);
  });

  it('rejects question with pivot vizSettings but no pivotConfig', async () => {
    const result = await executeToolCall(
      makeToolCall({
        file_type: 'question',
        content: { vizSettings: { type: 'pivot' } },
      }),
      {} as any
    );
    const parsed = JSON.parse(result.content as string);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toMatch(/pivotConfig/);
  });

  it('creates a question with valid pivot content', async () => {
    const result = await executeToolCall(
      makeToolCall({
        file_type: 'question',
        content: {
          vizSettings: {
            type: 'pivot',
            pivotConfig: {
              rows: ['region'],
              columns: ['year'],
              values: [{ column: 'revenue', aggFunction: 'SUM' }],
            },
          },
        },
      }),
      {} as any
    );
    const parsed = JSON.parse(result.content as string);
    expect(parsed.success).toBe(true);
  });

  it('rejects dashboard creation in the background', async () => {
    const result = await executeToolCall(
      makeToolCall({
        file_type: 'dashboard',
        name: 'My Dashboard',
        content: { description: 'Revenue overview' },
      }),
      {} as any
    );
    const parsed = JSON.parse(result.content as string);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toMatch(/Cannot create a dashboard in the background/);
  });

  it('returns vizWarning when line chart has no xCols', async () => {
    const result = await executeToolCall(
      makeToolCall({
        file_type: 'question',
        name: 'Bad Viz',
        content: {
          vizSettings: { type: 'line', xCols: [], yCols: ['revenue'] },
        },
      }),
      {} as any
    );
    const parsed = JSON.parse(result.content as string);
    expect(parsed.success).toBe(true);
    expect(parsed.vizWarning).toBeTruthy();
    expect(parsed.vizWarning).toMatch(/X-axis/i);
  });

  it('returns vizWarning when single_value has multiple yCols', async () => {
    const result = await executeToolCall(
      makeToolCall({
        file_type: 'question',
        name: 'Multi Metric',
        content: {
          vizSettings: { type: 'single_value', yCols: ['a', 'b'] },
        },
      }),
      {} as any
    );
    const parsed = JSON.parse(result.content as string);
    expect(parsed.success).toBe(true);
    expect(parsed.vizWarning).toBeTruthy();
  });

  it('does not return vizWarning for valid vizSettings', async () => {
    const result = await executeToolCall(
      makeToolCall({
        file_type: 'question',
        name: 'Valid Viz',
        content: {
          vizSettings: { type: 'bar', xCols: ['category'], yCols: ['revenue'] },
        },
      }),
      {} as any
    );
    const parsed = JSON.parse(result.content as string);
    expect(parsed.success).toBe(true);
    expect(parsed.vizWarning).toBeUndefined();
  });

  it('does not return vizWarning for table type', async () => {
    const result = await executeToolCall(
      makeToolCall({
        file_type: 'question',
        name: 'Table',
        content: {
          vizSettings: { type: 'table' },
        },
      }),
      {} as any
    );
    const parsed = JSON.parse(result.content as string);
    expect(parsed.success).toBe(true);
    expect(parsed.vizWarning).toBeUndefined();
  });
});

describe('EditFile - Context post-edit guard', () => {
  let contextId: number;

  // Markup note: context content is projected to schemaless keyvalue XML, where an
  // empty array round-trips to "" (an empty `<tag/>`). The post-edit guard diffs the
  // pre-edit (typed) content against the post-edit (markup-round-tripped) content, so
  // empty `whitelist` arrays would spuriously read as a non-docs change. Populating the
  // whitelist arrays keeps them round-tripping as arrays, so the guard only fires on a
  // genuine non-docs edit.
  const contextContent = {
    versions: [{
      version: 1,
      whitelist: { databases: [{ databaseName: 'test_db', whitelist: ['orders'] }] },
      docs: [{ content: '# Original doc', draft: false }],
      createdAt: new Date().toISOString(),
      createdBy: 1,
    }],
    published: { all: 1 },
    databases: [{ databaseName: 'test_db', whitelist: ['orders'] }],
    docs: [{ content: '# Original doc', draft: false }],
  };

  // Markup note: the context loader injects derived, always-empty arrays
  // (fullAnnotations/fullDocs/fullMetrics/fullSchema/fullSkills/parentSchema) into the
  // loaded content. Schemaless keyvalue markup round-trips an empty array to "" (an empty
  // `<tag/>` parses back as empty text), which the post-edit guard would read as a non-docs
  // change. Dropping those `<tag/>` lines from the markup means the parsed content omits the
  // keys, so editFileStr's merge preserves the original [] values — the guard then only
  // fires on a genuine non-docs edit. Prepend this change to doc-only ("allows") edits.
  const dropDerivedArrays = {
    oldMatch: '  <fullAnnotations/>\n  <fullDocs/>\n  <fullMetrics/>\n  <fullSchema/>\n  <fullSkills/>\n  <parentSchema/>\n',
    newMatch: '',
  };

  function makeEditToolCall(args: Record<string, unknown>) {
    return {
      id: 'test-edit-ctx',
      type: 'function' as const,
      function: { name: 'EditFile', arguments: args },
    };
  }

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
    await clearFilesExceptOrg();
    contextId = await DocumentDB.create('test-context', '/org/test-context', 'context', contextContent, []);
    testStore = setupStore();
    vi.clearAllMocks();
  });

  afterEach(() => {
    testStore = null;
    if (global.gc) global.gc();
  });

  it('allows editing doc content text', async () => {
    await readFiles([contextId]);
    const result = await executeToolCall(
      makeEditToolCall({
        fileId: contextId,
        changes: [dropDerivedArrays, { oldMatch: '# Original doc', newMatch: '# Updated doc with new info' }],
      }),
      {} as any,
    );
    expect(result.details?.success).toBe(true);
  });

  it('allows adding a new doc entry', async () => {
    await readFiles([contextId]);
    const result = await executeToolCall(
      makeEditToolCall({
        fileId: contextId,
        changes: [dropDerivedArrays, {
          // Append a second <item> inside the docs block (both the versions[].docs
          // and the top-level docs[] are exempt from the post-edit guard).
          oldMatch: '<content># Original doc</content>\n          <draft>false</draft>\n        </item>',
          newMatch: '<content># Original doc</content>\n          <draft>false</draft>\n        </item>\n        <item>\n          <content># New doc</content>\n          <draft>true</draft>\n        </item>',
        }],
      }),
      {} as any,
    );
    expect(result.details?.success).toBe(true);
  });

  it('allows removing a doc entry', async () => {
    await readFiles([contextId]);
    const result = await executeToolCall(
      makeEditToolCall({
        fileId: contextId,
        changes: [dropDerivedArrays, {
          // Empty the docs blocks (versions[].docs and top-level docs are exempt).
          oldMatch: '<docs>\n        <item>\n          <content># Original doc</content>\n          <draft>false</draft>\n        </item>\n      </docs>',
          newMatch: '<docs/>',
        }],
      }),
      {} as any,
    );
    expect(result.details?.success).toBe(true);
  });

  it('allows toggling doc draft status', async () => {
    await readFiles([contextId]);
    const result = await executeToolCall(
      makeEditToolCall({
        fileId: contextId,
        changes: [dropDerivedArrays, {
          oldMatch: '<draft>false</draft>',
          newMatch: '<draft>true</draft>',
        }],
      }),
      {} as any,
    );
    expect(result.details?.success).toBe(true);
  });

  it('rejects editing databases field', async () => {
    await readFiles([contextId]);
    const result = await executeToolCall(
      makeEditToolCall({
        fileId: contextId,
        changes: [{
          oldMatch: '<databaseName>test_db</databaseName>',
          newMatch: '<databaseName>hacked_db</databaseName>',
        }],
      }),
      {} as any,
    );
    expect(result.details?.success).toBe(false);
    expect(result.details?.error).toMatch(/can only modify docs/);
  });

  it('rejects editing published field', async () => {
    await readFiles([contextId]);
    const result = await executeToolCall(
      makeEditToolCall({
        fileId: contextId,
        changes: [{
          oldMatch: '<published>\n    <all>1</all>\n  </published>',
          newMatch: '<published>\n    <all>99</all>\n  </published>',
        }],
      }),
      {} as any,
    );
    expect(result.details?.success).toBe(false);
    expect(result.details?.error).toMatch(/can only modify docs/);
  });
});

describe('EditFile - notebook cell auto-execute', () => {
  let notebookId: number;

  const notebookContent = {
    description: null,
    cells: [{
      type: 'sql', id: 'cell-1', name: null, query: 'SELECT 1',
      vizSettings: { type: 'table' }, parameters: [], parameterValues: {},
      connection_name: 'mxfood', references: [],
    }],
  };

  function makeEditToolCall(args: Record<string, unknown>) {
    return {
      id: 'test-edit-nb',
      type: 'function' as const,
      function: { name: 'EditFile', arguments: args },
    };
  }

  function setupStore() {
    return configureStore({
      reducer: { files: filesReducer, queryResults: queryResultsReducer, auth: authReducer, ui: uiReducer },
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
      if (urlStr.includes('/api/query')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: { columns: ['n'], types: ['BIGINT'], rows: [{ n: 2 }] },
          }),
        } as Response;
      }
      throw new Error(`Unmocked fetch call to ${urlStr}`);
    });
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  beforeEach(async () => {
    await clearFilesExceptOrg();
    notebookId = await DocumentDB.create('test-notebook', '/org/test-notebook', 'notebook', notebookContent, []);
    testStore = setupStore();
    vi.clearAllMocks();
  });

  afterEach(() => {
    testStore = null;
    if (global.gc) global.gc();
  });

  it('runs the changed cell and records its executed snapshot in Redux', async () => {
    await readFiles([notebookId]);
    const result = await executeToolCall(
      makeEditToolCall({
        fileId: notebookId,
        changes: [{ oldMatch: 'SELECT 1', newMatch: 'SELECT 2' }],
      }),
      {} as any,
    );
    expect(result.details?.success).toBe(true);

    // The edited cell's executed snapshot is written to ephemeral state so
    // NotebookView shows the result without a manual Run.
    const executed = selectNotebookCellExecuted(testStore.getState(), notebookId);
    expect(executed?.['cell-1']?.query).toBe('SELECT 2');
    expect(executed?.['cell-1']?.database).toBe('mxfood');

    // The fresh result flows back to the agent in the response.
    const parsed = JSON.parse(result.content as string);
    const qr = parsed.queryResults?.[0];
    expect(qr).toBeDefined();
    expect(qr.data).toContain('| 2 |');
  });

  it('does not execute when the edit leaves the cell query unchanged', async () => {
    await readFiles([notebookId]);
    // Edit only the notebook description, not any cell query. The notebook's
    // description is null so it isn't emitted in the markup — add the element by
    // anchoring on the <cells> opening tag.
    const result = await executeToolCall(
      makeEditToolCall({
        fileId: notebookId,
        changes: [{ oldMatch: '  <cells>', newMatch: '  <description>updated</description>\n  <cells>' }],
      }),
      {} as any,
    );
    expect(result.details?.success).toBe(true);
    const executed = selectNotebookCellExecuted(testStore.getState(), notebookId);
    expect(executed?.['cell-1']).toBeUndefined();
  });
});
