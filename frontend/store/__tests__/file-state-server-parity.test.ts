/**
 * Client-Server File State Parity Tests
 *
 * Verifies that for the same file in the DB, the client pipeline and the
 * server pipeline produce identical CompressedAugmentedFile output.
 *
 * Parity invariant (for clean, unedited files):
 *   compressAugmentedFile(selectAugmentedFiles(state, [id])[0])
 *     ===
 *   (await readFilesServer([id], user))[0]
 *
 * Both paths ultimately call compressAugmentedFile(dbFileToFileState(file)),
 * so with persistableChanges={} and metadataChanges={} the outputs must match.
 */

import { configureStore } from '@reduxjs/toolkit';
import filesReducer from '../filesSlice';
import queryResultsReducer from '../queryResultsSlice';
import authReducer from '../authSlice';
import { getTestDbPath, initTestDatabase, cleanupTestDatabase } from './test-utils';
import { DocumentDB } from '@/lib/database/documents-db';
import type { QuestionContent, DocumentContent, UserRole } from '@/lib/types';
import type { Mode } from '@/lib/mode/mode-types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { AugmentedFile, CompressedAugmentedFile } from '@/lib/types';
import { readFiles, selectAugmentedFiles, compressAugmentedFile } from '@/lib/api/file-state';
import { readFilesServer, getAppStateServer } from '@/lib/api/file-state.server';
import { POST as batchPostHandler } from '@/app/api/files/batch/route';
import { GET as fileGetHandler } from '@/app/api/files/[id]/route';
import { setupMockFetch } from '@/test/harness/mock-fetch';
import { NextRequest } from 'next/server';

// Mock db-config to use test database
jest.mock('@/lib/database/db-config', () => {
  const path = require('path');
  const dbPath = path.join(process.cwd(), 'data', 'test_server_parity.db');
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

// Mock python-backend-client for executeQueries tests
jest.mock('@/lib/api/python-backend-client', () => ({
  pythonBackendFetch: jest.fn(async (url: string, init?: any) => {
    if (url.includes('/api/execute-query')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          columns: ['month', 'total'],
          types: ['TEXT', 'INTEGER'],
          rows: [
            { month: 'Jan', total: 1000 },
            { month: 'Feb', total: 1500 },
          ]
        })
      } as Response;
    }
    throw new Error(`Unmocked pythonBackendFetch call to ${url}`);
  })
}));

describe('Client-Server File State Parity', () => {
  const dbPath = getTestDbPath('server_parity');
  let store: ReturnType<typeof configureStore>;
  let questionId: number;
  let dashboardId: number;
  let paramQuestionId: number;
  let paramDashboardId: number;

  // Route client API calls to real Next.js handlers (no Python backend needed for parity tests)
  setupMockFetch({
    getPythonPort: () => 0,
    additionalInterceptors: [
      async (urlStr, init) => {
        const fullUrl = urlStr.startsWith('http') ? urlStr : `http://localhost:3000${urlStr}`;

        if (urlStr.includes('/api/files/batch') && !urlStr.includes('batch-save')) {
          const req = new NextRequest('http://localhost:3000/api/files/batch', {
            method: init?.method || 'POST',
            body: init?.body,
            headers: { ...init?.headers, 'x-company-id': '1', 'x-user-id': '1' }
          });
          const res = await batchPostHandler(req);
          return { ok: res.status === 200, status: res.status, json: async () => res.json() } as Response;
        }

        if (urlStr.match(/\/api\/files\/\d+(\?|$)/) && (!init?.method || init?.method === 'GET')) {
          const fileId = urlStr.match(/\/api\/files\/(\d+)/)?.[1];
          const req = new NextRequest(fullUrl, {
            method: 'GET',
            headers: { 'x-company-id': '1', 'x-user-id': '1' }
          });
          const res = await fileGetHandler(req, { params: Promise.resolve({ id: fileId! }) });
          return { ok: res.status === 200, status: res.status, json: async () => res.json() } as Response;
        }

        return null;
      }
    ],
  });

  const testUser: EffectiveUser = {
    userId: 1,
    email: 'test@example.com',
    name: 'Test User',
    role: 'admin',
    home_folder: '/org',
    companyId: 1,
    companyName: 'test-company',
    mode: 'org',
  };

  beforeAll(async () => {
    await initTestDatabase(dbPath);
    const companyId = 1;

    // Simple question (no params)
    questionId = await DocumentDB.create(
      'Sales Query',
      '/org/sales-query',
      'question',
      {
        description: 'Total sales by month',
        query: 'SELECT month, SUM(total) as total FROM sales GROUP BY month',
        connection_name: 'test_db',
        parameters: [],
        vizSettings: { type: 'table', xCols: [], yCols: [] }
      } as QuestionContent,
      [],
      companyId
    );

    // Dashboard referencing the simple question
    dashboardId = await DocumentDB.create(
      'Sales Dashboard',
      '/org/sales-dashboard',
      'dashboard',
      {
        description: 'Sales overview',
        assets: [{ type: 'question', id: questionId }],
        layout: {},
        parameterValues: {}
      } as DocumentContent,
      [questionId],
      companyId
    );

    // Question with parameters (for inheritance tests)
    paramQuestionId = await DocumentDB.create(
      'Limited Sales Query',
      '/org/limited-sales-query',
      'question',
      {
        description: 'Sales with limit param',
        query: 'SELECT month, total FROM sales LIMIT :limit',
        connection_name: 'test_db',
        parameters: [{ name: 'limit', type: 'number', value: '5' }],
        parameterValues: { limit: '5' },
        vizSettings: { type: 'table', xCols: [], yCols: [] }
      } as unknown as QuestionContent,
      [],
      companyId
    );

    // Dashboard with inherited parameterValues overriding question default
    paramDashboardId = await DocumentDB.create(
      'Param Sales Dashboard',
      '/org/param-sales-dashboard',
      'dashboard',
      {
        description: 'Sales with param override',
        assets: [{ type: 'question', id: paramQuestionId }],
        layout: {},
        parameterValues: { limit: '10' }
      } as unknown as DocumentContent,
      [paramQuestionId],
      companyId
    );

    store = configureStore({
      reducer: {
        files: filesReducer,
        queryResults: queryResultsReducer,
        auth: authReducer
      },
      preloadedState: {
        auth: {
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
        }
      }
    });

    testStore = store;
  });

  afterAll(async () => {
    await cleanupTestDatabase(dbPath);
  });

  // Helper: load file via client Redux pipeline and compress it
  async function getClientCompressed(id: number): Promise<CompressedAugmentedFile> {
    await readFiles([id]);
    const augmented: AugmentedFile[] = selectAugmentedFiles(store.getState() as any, [id]);
    expect(augmented).toHaveLength(1);
    return compressAugmentedFile(augmented[0]);
  }

  // ============================================================================
  // Test 1: Simple question parity
  // ============================================================================

  it('readFilesServer matches compressed client output for a simple question', async () => {
    const client = await getClientCompressed(questionId);
    const server = await readFilesServer([questionId], testUser);

    expect(server).toHaveLength(1);
    expect(server[0].fileState.id).toBe(questionId);
    expect(server[0].fileState.type).toBe('question');
    expect(server[0].fileState.isDirty).toBe(false);

    // Core parity assertion: same shape, same content
    expect(server[0]).toEqual(client);
  });

  // ============================================================================
  // Test 2: Dashboard with references parity
  // ============================================================================

  it('readFilesServer matches compressed client output for a dashboard with references', async () => {
    // Load question into Redux first (dashboard references it)
    await readFiles([questionId]);
    const client = await getClientCompressed(dashboardId);
    const server = await readFilesServer([dashboardId], testUser);

    expect(server).toHaveLength(1);
    expect(server[0].fileState.id).toBe(dashboardId);
    expect(server[0].references).toHaveLength(1);
    expect(server[0].references[0].id).toBe(questionId);

    // Core parity assertion
    expect(server[0]).toEqual(client);
  });

  // ============================================================================
  // Test 3: Parameter inheritance — queryResultId matches
  // ============================================================================

  it('parameter inheritance produces identical queryResultId on client and server', async () => {
    // Load question first so it's in Redux when we load the dashboard
    await readFiles([paramQuestionId]);
    const client = await getClientCompressed(paramDashboardId);
    const server = await readFilesServer([paramDashboardId], testUser);

    // Both should have the reference with an effective queryResultId
    expect(server[0].references).toHaveLength(1);
    expect(server[0].references[0].queryResultId).toBeDefined();
    expect(client.references[0].queryResultId).toBeDefined();

    // The inherited param (limit=10 from dashboard) should produce the same hash on both sides
    expect(server[0].references[0].queryResultId).toEqual(client.references[0].queryResultId);

    // Full parity
    expect(server[0]).toEqual(client);
  });

  // ============================================================================
  // Test 4: getAppStateServer wraps readFilesServer correctly
  // ============================================================================

  it('getAppStateServer wraps readFilesServer with correct type envelope', async () => {
    const result = await getAppStateServer(questionId, testUser);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('file');

    // Should contain the same data as readFilesServer([questionId])[0]
    const direct = await readFilesServer([questionId], testUser);
    expect(result!.state).toEqual(direct[0]);
  });

  it('getAppStateServer returns null for a non-existent file', async () => {
    const result = await getAppStateServer(999999, testUser);
    expect(result).toBeNull();
  });

  // ============================================================================
  // Test 5: executeQueries: true populates queryResults
  // ============================================================================

  it('executeQueries: true returns populated queryResults with id matching queryResultId', async () => {
    const server = await readFilesServer([questionId], testUser, { executeQueries: true });

    expect(server).toHaveLength(1);
    expect(server[0].fileState.queryResultId).toBeDefined();

    // Query should have been executed and result stored
    expect(server[0].queryResults).toHaveLength(1);
    const qr = server[0].queryResults[0];

    // id on the query result must match the queryResultId on the fileState
    expect(qr.id).toEqual(server[0].fileState.queryResultId);

    // Result should be serialised as a GFM markdown table
    expect(qr.columns).toEqual(['month', 'total']);
    expect(qr.data).toContain('| month | total |');
    expect(qr.data).toContain('| Jan | 1000 |');
    expect(qr.totalRows).toBe(2);
    expect(qr.shownRows).toBe(2);
    expect(qr.truncated).toBe(false);
  });

  it('executeQueries: false leaves queryResults empty', async () => {
    const server = await readFilesServer([questionId], testUser, { executeQueries: false });

    expect(server).toHaveLength(1);
    expect(server[0].queryResults).toHaveLength(0);
  });
});
