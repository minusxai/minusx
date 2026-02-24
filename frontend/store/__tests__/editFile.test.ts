/**
 * Test for editFile functionality - verifies that editing a file properly
 * updates persistableChanges and isDirty state
 */
import { getTestDbPath, waitFor, initTestDatabase, cleanupTestDatabase } from './test-utils';
import { editFile, editFileStr, readFiles } from '@/lib/api/file-state';
import { selectIsDirty, selectMergedContent, selectFile } from '@/store/filesSlice';
import { QuestionContent, DashboardContent } from '@/lib/types';
import { configureStore } from '@reduxjs/toolkit';
import filesReducer from '../filesSlice';
import queryResultsReducer from '../queryResultsSlice';
import authReducer from '../authSlice';

// Mock db-config to use test database
jest.mock('@/lib/database/db-config', () => {
  const path = require('path');
  const dbPath = path.join(process.cwd(), 'data', 'test_edit_file.db');
  return {
    DB_PATH: dbPath,
    DB_DIR: path.join(process.cwd(), 'data'),
    getDbType: () => 'sqlite'
  };
});

// Mock the store import so file-state.ts uses the test store
let testStore: any;
jest.mock('@/store/store', () => ({
  get store() {
    return testStore;
  },
  getStore: () => testStore
}));

// Mock auth system to return test user
jest.mock('@/lib/auth/auth-helpers', () => ({
  getEffectiveUser: jest.fn().mockResolvedValue({
    userId: 1,
    email: 'test@example.com',
    companyId: 1,
    role: 'admin' as const,
    mode: 'org' as const,
    homeFolderResolved: '/org'
  })
}));

describe('editFile - Question Editing Flow', () => {
  const dbPath = getTestDbPath('edit_file');
  const companyId = 1;
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
            'x-company-id': '1',
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
        database_name: 'test_db',
        parameters: [],
        references: [],
        vizSettings: {
          type: 'table',
          xCols: [],
          yCols: []
        }
      } as QuestionContent,
      [],
      companyId
    );

    // Create test question 2
    questionId2 = await DocumentDB.create(
      'test-question-2',
      '/org/test-question-2',
      'question',
      {
        query: 'SELECT 2',
        database_name: 'test_db',
        parameters: [],
        references: [],
        vizSettings: {
          type: 'table',
          xCols: [],
          yCols: []
        }
      } as QuestionContent,
      [],
      companyId
    );

    // Create test question 3
    questionId3 = await DocumentDB.create(
      'test-question-3',
      '/org/test-question-3',
      'question',
      {
        query: 'SELECT 3',
        database_name: 'test_db',
        parameters: [],
        references: [],
        vizSettings: {
          type: 'table',
          xCols: [],
          yCols: []
        }
      } as QuestionContent,
      [],
      companyId
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
    // Note: queryResultId is also set automatically when query changes
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
          database_name: 'new_db'
        }
      }
    });

    // Wait for updates
    await waitFor(() => {
      const state = store.getState();
      const content = selectMergedContent(state, fileId) as QuestionContent;
      return content.query === 'SELECT * FROM test' && content.database_name === 'new_db';
    }, 1000);

    const finalState = store.getState();
    const fileState = selectFile(finalState, fileId);

    // Both changes should be in persistableChanges
    console.log('persistableChanges after multiple edits:', fileState?.persistableChanges);
    expect(fileState?.persistableChanges).toMatchObject({
      query: 'SELECT * FROM test',
      database_name: 'new_db'
    });

    // Merged content should have both changes plus original fields
    const mergedContent = selectMergedContent(finalState, fileId) as QuestionContent;
    expect(mergedContent.query).toBe('SELECT * FROM test');
    expect(mergedContent.database_name).toBe('new_db');

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
  const companyId = 1;
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
          headers: { ...init?.headers, 'x-company-id': '1', 'x-user-id': '1' }
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
        database_name: 'test_db',
        parameters: [],
        references: [],
        vizSettings: { type: 'table', xCols: [], yCols: [] }
      } as QuestionContent,
      [],
      companyId
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

  it('rejects missing database_name field', async () => {
    await readFiles([questionId]);
    const result = await editFileStr({
      fileId: questionId,
      oldMatch: '"database_name":"test_db"',
      newMatch: '"database_name":null',
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
  const companyId = 1;
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
          headers: { ...init?.headers, 'x-company-id': '1', 'x-user-id': '1' },
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
      [],
      companyId
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

  it('rejects layout item w below minimum (3)', async () => {
    await readFiles([dashboardId]);
    const result = await editFileStr({
      fileId: dashboardId,
      oldMatch: '"w":6',
      newMatch: '"w":1',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid dashboard content/);
  });

  it('rejects layout item h below minimum (3)', async () => {
    await readFiles([dashboardId]);
    const result = await editFileStr({
      fileId: dashboardId,
      oldMatch: '"h":4',
      newMatch: '"h":2',
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
