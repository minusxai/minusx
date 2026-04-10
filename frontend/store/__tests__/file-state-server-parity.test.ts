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
 *
 * Tests are structured to address three key invariants:
 *
 *   Invariant 1 — Parameter inheritance is correct on BOTH paths:
 *     The queryResultId for a dashboard reference reflects the dashboard's
 *     parameterValues (limit=10), NOT the question's own default (limit=5).
 *
 *   Invariant 2 — executeQueries executes through references:
 *     readFilesServer([dashboardId], user, { executeQueries: true }) executes
 *     the referenced question's query (not just the dashboard) and the returned
 *     queryResult.id matches the reference's inherited queryResultId.
 *
 *   Invariant 3 — Server is independent of client Redux state:
 *     When the client has unsaved edits (isDirty=true), the server still returns
 *     the saved DB state. After publishFile, both converge to the same output.
 */

import { configureStore } from '@reduxjs/toolkit';
import filesReducer from '../filesSlice';
import queryResultsReducer from '../queryResultsSlice';
import authReducer from '../authSlice';
import { getTestDbPath, initTestDatabase, cleanupTestDatabase } from './test-utils';
import { DocumentDB } from '@/lib/database/documents-db';
import type { QuestionContent, DocumentContent, UserRole } from '@/lib/types';
import type { CompressedAugmentedFile } from '@/lib/types';
import type { Mode } from '@/lib/mode/mode-types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import {
  readFiles,
  selectAugmentedFiles,
  compressAugmentedFile,
  editFileStr,
  publishFile,
} from '@/lib/api/file-state';
import { readFilesServer, getAppStateServer } from '@/lib/api/file-state.server';
import { getQueryHash } from '@/lib/utils/query-hash';
import { POST as batchPostHandler } from '@/app/api/files/batch/route';
import { GET as fileGetHandler, PATCH as filePatchHandler } from '@/app/api/files/[id]/route';
import { setupMockFetch } from '@/test/harness/mock-fetch';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Mock: test database
// ---------------------------------------------------------------------------
jest.mock('@/lib/database/db-config', () => {
  const path = require('path');
  const dbPath = path.join(process.cwd(), 'data', 'test_server_parity.db');
  return {
    DB_PATH: dbPath,
    DB_DIR: path.join(process.cwd(), 'data'),
    getDbType: () => 'sqlite'
  };
});

// ---------------------------------------------------------------------------
// Mock: Redux store (file-state.ts reads from this via getStore())
// ---------------------------------------------------------------------------
let testStore: any;
jest.mock('@/store/store', () => ({
  get store() { return testStore; },
  getStore: () => testStore,
}));

// ---------------------------------------------------------------------------
// Mock: Python backend (for executeQueries tests)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe('Client-Server File State Parity', () => {
  const dbPath = getTestDbPath('server_parity');
  let store: ReturnType<typeof configureStore>;

  // File IDs created in beforeAll
  let questionId: number;       // plain question, no params
  let dashboardId: number;      // dashboard referencing questionId
  let paramQuestionId: number;  // question with :limit param (own default: limit=5)
  let paramDashboardId: number; // dashboard overriding limit=10

  // ---------------------------------------------------------------------------
  // Route client HTTP calls to real Next.js route handlers so both the client
  // path (HTTP → handler → DB) and the server path (direct → DB) hit the same DB.
  // ---------------------------------------------------------------------------
  setupMockFetch({
    getPythonPort: () => 0,
    additionalInterceptors: [
      async (urlStr, init) => {
        const fullUrl = urlStr.startsWith('http') ? urlStr : `http://localhost:3000${urlStr}`;

        // POST /api/files/batch — used by readFiles / loadFiles
        if (urlStr.includes('/api/files/batch') && !urlStr.includes('batch-save')) {
          const req = new NextRequest('http://localhost:3000/api/files/batch', {
            method: init?.method || 'POST',
            body: init?.body,
            headers: { ...init?.headers, 'x-company-id': '1', 'x-user-id': '1' },
          });
          const res = await batchPostHandler(req);
          return { ok: res.status === 200, status: res.status, json: async () => res.json() } as Response;
        }

        // PATCH /api/files/:id — used by publishFile
        if (urlStr.match(/\/api\/files\/\d+(\?|$)/) && (init?.method === 'PATCH' || init?.method === 'PUT')) {
          const fileId = urlStr.match(/\/api\/files\/(\d+)/)?.[1];
          const req = new NextRequest(fullUrl, {
            method: 'PATCH',
            body: init?.body,
            headers: { ...init?.headers, 'x-company-id': '1', 'x-user-id': '1' },
          });
          const res = await filePatchHandler(req, { params: Promise.resolve({ id: fileId! }) });
          return { ok: res.status === 200, status: res.status, json: async () => res.json() } as Response;
        }

        // GET /api/files/:id — individual file fetch
        if (urlStr.match(/\/api\/files\/\d+(\?|$)/) && (!init?.method || init?.method === 'GET')) {
          const fileId = urlStr.match(/\/api\/files\/(\d+)/)?.[1];
          const req = new NextRequest(fullUrl, {
            method: 'GET',
            headers: { 'x-company-id': '1', 'x-user-id': '1' },
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

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------
  beforeAll(async () => {
    await initTestDatabase(dbPath);
    const companyId = 1;

    // Simple question — no params
    questionId = await DocumentDB.create(
      'Sales Query',
      '/org/sales-query',
      'question',
      {
        description: 'Total sales by month',
        query: 'SELECT month, SUM(total) as total FROM sales GROUP BY month',
        connection_name: 'test_db',
        parameters: [],
        vizSettings: { type: 'table', xCols: [], yCols: [] },
      } as QuestionContent,
      [],
      companyId
    );

    // Dashboard referencing the simple question (no param override)
    dashboardId = await DocumentDB.create(
      'Sales Dashboard',
      '/org/sales-dashboard',
      'dashboard',
      {
        description: 'Sales overview',
        assets: [{ type: 'question', id: questionId }],
        layout: {},
        parameterValues: {},
      } as DocumentContent,
      [questionId],
      companyId
    );

    // Question with :limit param — own default limit=5
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
        vizSettings: { type: 'table', xCols: [], yCols: [] },
      } as unknown as QuestionContent,
      [],
      companyId
    );

    // Dashboard overriding limit=10 (overrides question's default of 5)
    paramDashboardId = await DocumentDB.create(
      'Param Sales Dashboard',
      '/org/param-sales-dashboard',
      'dashboard',
      {
        description: 'Sales with param override',
        assets: [{ type: 'question', id: paramQuestionId }],
        layout: {},
        parameterValues: { limit: '10' },
      } as unknown as DocumentContent,
      [paramQuestionId],
      companyId
    );

    store = configureStore({
      reducer: {
        files: filesReducer,
        queryResults: queryResultsReducer,
        auth: authReducer,
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
            mode: 'org' as Mode,
          },
          loading: false,
        },
      },
    });

    testStore = store;
  });

  afterAll(async () => {
    await cleanupTestDatabase(dbPath);
  });

  // ---------------------------------------------------------------------------
  // Helper: load file through the client Redux pipeline and compress it.
  // This is the exact same path that the LLM tool ReadFiles / selectAppState uses.
  // ---------------------------------------------------------------------------
  async function getClientCompressed(id: number): Promise<CompressedAugmentedFile> {
    await readFiles([id]);
    const augmented = selectAugmentedFiles(store.getState() as any, [id]);
    expect(augmented).toHaveLength(1);
    return compressAugmentedFile(augmented[0]);
  }

  // ============================================================================
  // Basic parity: simple question, clean state
  // ============================================================================

  it('simple question: client and server produce identical output', async () => {
    const client = await getClientCompressed(questionId);
    const server = await readFilesServer([questionId], testUser);

    expect(server).toHaveLength(1);
    expect(server[0]).toEqual(client);
  });

  // ============================================================================
  // Basic parity: dashboard with references, clean state
  // ============================================================================

  it('dashboard with reference: client and server produce identical output', async () => {
    const client = await getClientCompressed(dashboardId);
    const server = await readFilesServer([dashboardId], testUser);

    expect(server).toHaveLength(1);
    expect(server[0].references).toHaveLength(1);
    expect(server[0]).toEqual(client);
  });

  // ============================================================================
  // Invariant 1: parameter inheritance is correct on BOTH paths
  //
  // The paramDashboard has parameterValues: { limit: '10' }.
  // The paramQuestion has its own default parameterValues: { limit: '5' }.
  // Both client and server must compute queryResultId using the INHERITED limit=10,
  // not the question's own default of 5. We prove this by checking against the
  // known hashes for each value.
  // ============================================================================

  it('parameter inheritance: queryResultId uses dashboard override, not question default, on both paths', async () => {
    const inheritedHash = getQueryHash(
      'SELECT month, total FROM sales LIMIT :limit',
      { limit: '10' },
      'test_db'
    );
    const standaloneHash = getQueryHash(
      'SELECT month, total FROM sales LIMIT :limit',
      { limit: '5' },
      'test_db'
    );
    // These should actually differ — if they're equal the test setup is wrong
    expect(inheritedHash).not.toEqual(standaloneHash);

    const client = await getClientCompressed(paramDashboardId);
    const server = await readFilesServer([paramDashboardId], testUser);

    // Both paths must agree (parity)
    expect(server[0]).toEqual(client);

    // AND both must specifically use the inherited value (not the question default)
    expect(client.references[0].queryResultId).toEqual(inheritedHash);
    expect(server[0].references[0].queryResultId).toEqual(inheritedHash);
    expect(client.references[0].queryResultId).not.toEqual(standaloneHash);
  });

  // ============================================================================
  // getAppStateServer wrapper
  // ============================================================================

  it('getAppStateServer: wraps readFilesServer with { type: "file", state } envelope', async () => {
    const result = await getAppStateServer(questionId, testUser);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('file');

    const direct = await readFilesServer([questionId], testUser);
    expect(result!.state).toEqual(direct[0]);
  });

  it('getAppStateServer: returns null for non-existent file', async () => {
    const result = await getAppStateServer(999999, testUser);
    expect(result).toBeNull();
  });

  // ============================================================================
  // Full E2E: Invariants 2 + 3 together
  //
  // This test walks through the complete lifecycle:
  //
  //   1. Baseline parity (client == server, clean state)
  //   2. Edit on client → client becomes dirty
  //   3. Server reads DB → still sees old state (Invariant 3: independence)
  //   4. Server executes queries through dashboard reference (Invariant 2)
  //      - queryResults[0].id matches reference's inherited queryResultId
  //      - inherited queryResultId uses limit=10, not limit=5 (Invariant 1 again)
  //   5. Publish → DB updated
  //   6. Parity restored: client and server agree on the new saved state
  // ============================================================================

  it('full E2E: dirty client diverges from server; executeQueries via reference; publish restores parity', async () => {
    // ------------------------------------------------------------------
    // 1. Baseline: load everything fresh, verify client == server
    // ------------------------------------------------------------------
    const baseline = await readFilesServer([paramDashboardId], testUser);
    const baselineClient = await getClientCompressed(paramDashboardId);
    expect(baseline[0]).toEqual(baselineClient);
    expect(baselineClient.references[0].isDirty).toBe(false);

    // ------------------------------------------------------------------
    // 2. Edit the question on the client — makes Redux dirty, DB unchanged
    // ------------------------------------------------------------------
    const editResult = await editFileStr({
      fileId: paramQuestionId,
      oldMatch: '"description":"Sales with limit param"',
      newMatch: '"description":"Sales with limit param (edited)"',
    });
    expect(editResult.success).toBe(true);

    // Client now shows the edit and marks the reference dirty
    const dirtyClient = await getClientCompressed(paramDashboardId);
    expect(dirtyClient.references[0].isDirty).toBe(true);
    expect((dirtyClient.references[0].content as any).description).toBe(
      'Sales with limit param (edited)'
    );

    // ------------------------------------------------------------------
    // 3. Invariant 3: server is independent — reads DB, sees old state
    // ------------------------------------------------------------------
    const serverAfterEdit = await readFilesServer([paramDashboardId], testUser);

    expect(serverAfterEdit[0].references[0].isDirty).toBe(false);
    expect((serverAfterEdit[0].references[0].content as any).description).toBe(
      'Sales with limit param'   // original value — not the client edit
    );

    // Confirm client and server now DIFFER (diverged as expected)
    expect(serverAfterEdit[0]).not.toEqual(dirtyClient);

    // ------------------------------------------------------------------
    // 4. Invariant 2: executeQueries fires through dashboard references
    //    and Invariant 1: the executed hash uses inherited params (limit=10)
    // ------------------------------------------------------------------
    const inheritedHash = getQueryHash(
      'SELECT month, total FROM sales LIMIT :limit',
      { limit: '10' },
      'test_db'
    );

    const serverWithQueries = await readFilesServer(
      [paramDashboardId],
      testUser,
      { executeQueries: true }
    );

    // The dashboard itself is not a question — only the reference has a query result
    expect(serverWithQueries[0].queryResults).toHaveLength(1);

    const qr = serverWithQueries[0].queryResults[0];
    // id must match the reference's effective (inherited) queryResultId
    expect(qr.id).toEqual(inheritedHash);
    expect(qr.id).toEqual(serverWithQueries[0].references[0].queryResultId);

    // Result is serialised as a GFM markdown table
    expect(qr.columns).toEqual(['month', 'total']);
    expect(qr.data).toContain('| month | total |');
    expect(qr.data).toContain('| Jan | 1000 |');
    expect(qr.totalRows).toBe(2);
    expect(qr.truncated).toBe(false);

    // ------------------------------------------------------------------
    // 5. Publish: save the client edit to DB
    // ------------------------------------------------------------------
    await publishFile({ fileId: paramQuestionId });

    // Client is clean again after publish
    const postPublishClient = await getClientCompressed(paramDashboardId);
    expect(postPublishClient.references[0].isDirty).toBe(false);
    expect((postPublishClient.references[0].content as any).description).toBe(
      'Sales with limit param (edited)'
    );

    // ------------------------------------------------------------------
    // 6. Parity restored: server re-reads DB and matches client
    // ------------------------------------------------------------------
    const postPublishServer = await readFilesServer([paramDashboardId], testUser);

    expect((postPublishServer[0].references[0].content as any).description).toBe(
      'Sales with limit param (edited)'
    );
    expect(postPublishServer[0]).toEqual(postPublishClient);
  });
});
