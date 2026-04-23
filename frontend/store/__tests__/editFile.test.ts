/**
 * Test for editFile functionality - verifies that editing a file properly
 * updates persistableChanges and isDirty state
 */
import { getTestDbPath, waitFor, initTestDatabase, cleanupTestDatabase } from './test-utils';
import { editFile, editFileStr, readFiles, createVirtualFile } from '@/lib/api/file-state';
import { selectIsDirty, selectMergedContent, selectFile } from '@/store/filesSlice';
import { executeToolCall } from '@/lib/api/tool-handlers';
import { FilesAPI } from '@/lib/data/files';
import { QuestionContent, DashboardContent } from '@/lib/types';
import { configureStore } from '@reduxjs/toolkit';
import filesReducer from '../filesSlice';
import queryResultsReducer from '../queryResultsSlice';
import authReducer from '../authSlice';
import uiReducer from '../uiSlice';

// Mock db-config to use test database
jest.mock('@/lib/database/db-config', () => ({
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

// Mock the store import so file-state.ts uses the test store
let testStore: any;
jest.mock('@/store/store', () => ({
  get store() {
    return testStore;
  },
  getStore: () => testStore
}));

describe('editFile - Question Editing Flow', () => {
  const dbPath = getTestDbPath('edit_file');
  let questionId1: number;
  let questionId2: number;
  let questionId3: number;

  // Import API handlers
  const { POST: batchPostHandler } = require('@/app/api/files/batch/route');

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
    global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url.toString();

      // Mock /api/files/batch (batch load)
      if (urlStr.includes('/api/files/batch')) {
        // Need full URL for Request constructor
        const fullUrl = urlStr.startsWith('http') ? urlStr : `http://localhost:3000${urlStr}`;
        const request = new Request(fullUrl, {
          method: 'POST',
          ...init,
          headers: {
            ...init?.headers,
            'x-user-id': '1'
          }
        });
        const response = await batchPostHandler(request);
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

  afterAll(async () => {
    jest.restoreAllMocks();
    await cleanupTestDatabase(dbPath);
  });

  beforeEach(async () => {
    // Reset adapter to ensure fresh connection
    const { resetAdapter } = await import('@/lib/database/adapter/factory');
    await resetAdapter();

    // Initialize test database
    await initTestDatabase(dbPath);

    // Create test questions
    const { DocumentDB } = await import('@/lib/database/documents-db');

    // Create test question 1
    questionId1 = await DocumentDB.create(
      'test-question-1',
      '/org/test-question-1',
      'question',
      {
        query: 'SELECT 1',
        connection_name: 'test_db',
        parameters: [],
        references: [],
        vizSettings: {
          type: 'table',
          xCols: [],
          yCols: []
        }
      } as QuestionContent,
      []
    );

    // Create test question 2
    questionId2 = await DocumentDB.create(
      'test-question-2',
      '/org/test-question-2',
      'question',
      {
        query: 'SELECT 2',
        connection_name: 'test_db',
        parameters: [],
        references: [],
        vizSettings: {
          type: 'table',
          xCols: [],
          yCols: []
        }
      } as QuestionContent,
      []
    );

    // Create test question 3
    questionId3 = await DocumentDB.create(
      'test-question-3',
      '/org/test-question-3',
      'question',
      {
        query: 'SELECT 3',
        connection_name: 'test_db',
        parameters: [],
        references: [],
        vizSettings: {
          type: 'table',
          xCols: [],
          yCols: []
        }
      } as QuestionContent,
      []
    );

    // Create test store
    testStore = setupStore();
    jest.clearAllMocks();
  });

  afterEach(async () => {
    // Clean up database adapter after each test
    const { resetAdapter } = await import('@/lib/database/adapter/factory');
    await resetAdapter();

    // Clear store reference
    testStore = null;

    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
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

  const { POST: batchPostHandler } = require('@/app/api/files/batch/route');

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
    global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('/api/files/batch')) {
        const fullUrl = urlStr.startsWith('http') ? urlStr : `http://localhost:3000${urlStr}`;
        const request = new Request(fullUrl, {
          method: 'POST',
          ...init,
          headers: { ...init?.headers, 'x-user-id': '1' }
        });
        const response = await batchPostHandler(request);
        const data = await response.json();
        return { ok: response.status === 200, status: response.status, json: async () => data } as Response;
      }
      throw new Error(`Unmocked fetch call to ${urlStr}`);
    });
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    // dbPath is shared with the first describe; only clean up if still present
    await cleanupTestDatabase(dbPath);
  });

  beforeEach(async () => {
    const { resetAdapter } = await import('@/lib/database/adapter/factory');
    await resetAdapter();
    await initTestDatabase(dbPath);

    const { DocumentDB } = await import('@/lib/database/documents-db');
    questionId = await DocumentDB.create(
      'viz-validation-question',
      '/org/viz-validation-question',
      'question',
      {
        query: 'SELECT 1',
        connection_name: 'test_db',
        parameters: [],
        references: [],
        vizSettings: { type: 'table', xCols: [], yCols: [] }
      } as QuestionContent,
      []
    );

    testStore = setupStore();
    jest.clearAllMocks();
  });

  afterEach(async () => {
    const { resetAdapter } = await import('@/lib/database/adapter/factory');
    await resetAdapter();
    testStore = null;
    if (global.gc) global.gc();
  });

  it('rejects missing query field', async () => {
    await readFiles([questionId]);
    const result = await editFileStr({
      fileId: questionId,
      oldMatch: '"query":"SELECT 1"',
      newMatch: '"query":null',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid question content/);
  });

  it('rejects missing connection_name field', async () => {
    await readFiles([questionId]);
    const result = await editFileStr({
      fileId: questionId,
      oldMatch: '"connection_name":"test_db"',
      newMatch: '"connection_name":null',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid question content/);
  });

  it('rejects invalid visualization type', async () => {
    await readFiles([questionId]);
    const result = await editFileStr({
      fileId: questionId,
      oldMatch: '"type":"table"',
      newMatch: '"type":"invalid_chart_type"',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid question content/);
  });

  it('rejects pivot type without pivotConfig', async () => {
    await readFiles([questionId]);
    const result = await editFileStr({
      fileId: questionId,
      oldMatch: '"type":"table"',
      newMatch: '"type":"pivot"',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/pivotConfig is required/);
  });

  it('rejects pivot with missing required pivotConfig fields', async () => {
    await readFiles([questionId]);
    const result = await editFileStr({
      fileId: questionId,
      oldMatch: '"vizSettings":{"type":"table","xCols":[],"yCols":[]}',
      newMatch: '"vizSettings":{"type":"pivot","pivotConfig":{"rows":["region"]}}',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid question content/);
  });

  it('accepts valid table viz (no xCols/yCols needed)', async () => {
    await readFiles([questionId]);
    const result = await editFileStr({
      fileId: questionId,
      oldMatch: '"vizSettings":{"type":"table","xCols":[],"yCols":[]}',
      newMatch: '"vizSettings":{"type":"table"}',
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid pivot with full pivotConfig', async () => {
    await readFiles([questionId]);
    const pivotViz = JSON.stringify({
      type: 'pivot',
      pivotConfig: {
        rows: ['region'],
        columns: ['year'],
        values: [{ column: 'revenue', aggFunction: 'SUM' }],
      },
    });
    const result = await editFileStr({
      fileId: questionId,
      oldMatch: '"vizSettings":{"type":"table","xCols":[],"yCols":[]}',
      newMatch: `"vizSettings":${pivotViz}`,
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid bar chart with xCols/yCols', async () => {
    await readFiles([questionId]);
    const result = await editFileStr({
      fileId: questionId,
      oldMatch: '"vizSettings":{"type":"table","xCols":[],"yCols":[]}',
      newMatch: '"vizSettings":{"type":"bar","xCols":["category"],"yCols":["revenue"]}',
    });
    expect(result.success).toBe(true);
  });
});

describe('editFile - Dashboard content validation', () => {
  const dbPath = getTestDbPath('edit_file'); // same db-config mock path
  let dashboardId: number;

  const { POST: batchPostHandler } = require('@/app/api/files/batch/route');

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

  afterAll(async () => {
    jest.restoreAllMocks();
    await cleanupTestDatabase(dbPath);
  });

  beforeEach(async () => {
    const { resetAdapter } = await import('@/lib/database/adapter/factory');
    await resetAdapter();
    await initTestDatabase(dbPath);

    const { DocumentDB } = await import('@/lib/database/documents-db');
    dashboardId = await DocumentDB.create(
      'test-dashboard',
      '/org/test-dashboard',
      'dashboard',
      initialContent,
      []
    );

    testStore = setupStore();
    jest.clearAllMocks();
  });

  afterEach(async () => {
    const { resetAdapter } = await import('@/lib/database/adapter/factory');
    await resetAdapter();
    testStore = null;
    if (global.gc) global.gc();
  });

  it('rejects invalid asset type discriminator', async () => {
    await readFiles([dashboardId]);
    const result = await editFileStr({
      fileId: dashboardId,
      oldMatch: '{"type":"question","id":99}',
      newMatch: '{"type":"chart","id":99}',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid dashboard content/);
  });

  it('rejects non-integer id in FileAssetRef', async () => {
    await readFiles([dashboardId]);
    const result = await editFileStr({
      fileId: dashboardId,
      oldMatch: '{"type":"question","id":99}',
      newMatch: '{"type":"question","id":"ninety-nine"}',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid dashboard content/);
  });

  it('rejects layout item w below minimum (2)', async () => {
    await readFiles([dashboardId]);
    const result = await editFileStr({
      fileId: dashboardId,
      oldMatch: '"w":6',
      newMatch: '"w":1',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid dashboard content/);
  });

  it('rejects layout item h below minimum (1)', async () => {
    await readFiles([dashboardId]);
    const result = await editFileStr({
      fileId: dashboardId,
      oldMatch: '"h":4',
      newMatch: '"h":0',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid dashboard content/);
  });

  it('accepts valid inline (text) asset', async () => {
    await readFiles([dashboardId]);
    const result = await editFileStr({
      fileId: dashboardId,
      oldMatch: '{"type":"question","id":99}',
      newMatch: '{"type":"text","content":"Section header"}',
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid layout dimension change', async () => {
    await readFiles([dashboardId]);
    const result = await editFileStr({
      fileId: dashboardId,
      oldMatch: '"w":6,"h":4',
      newMatch: '"w":4,"h":6',
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
    global.fetch = jest.fn(async (url: string | URL | Request) => {
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
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    testStore = configureStore({
      reducer: { files: filesReducer, queryResults: queryResultsReducer, auth: authReducer, ui: uiReducer },
    });
    jest.spyOn(FilesAPI, 'getTemplate').mockImplementation(async (type) => {
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
  });

  afterEach(() => {
    jest.clearAllMocks();
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
    jest.spyOn(FilesAPI, 'getTemplate').mockImplementation(async (type) => {
      if (type === 'question') return questionTemplate;
      if (type === 'dashboard') return dashboardTemplate;
      return { fileName: 'Untitled', content: {} };
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
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
    expect(parsed.error).toMatch(/Navigate to \/new\/dashboard/);
  });
});
