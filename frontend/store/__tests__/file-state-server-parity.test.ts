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
import type { QuestionContent, DocumentContent, UserRole, ContextContent, ConnectionContent } from '@/lib/types';
import type { CompressedAugmentedFile } from '@/lib/types';
import type { Mode } from '@/lib/mode/mode-types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import { buildServerAgentArgs } from '@/lib/chat/agent-args.server';
import { buildSlackAgentArgs } from '@/lib/integrations/slack/context';
import { getWhitelistedSchemaForUser, getDocumentationForUser } from '@/lib/sql/schema-filter';
import { resolveHomeFolderSync, resolvePath } from '@/lib/mode/path-resolver';
import { selectDatabase } from '@/lib/utils/database-selector';
import {
  readFiles,
  editFileStr,
  publishFile,
} from '@/lib/api/file-state';
import { selectAugmentedFiles } from '@/lib/store/file-selectors';
import { compressAugmentedFile } from '@/lib/api/compress-augmented';
import { readFilesServer, getAppStateServer } from '@/lib/api/file-state.server';
import { getQueryHash } from '@/lib/utils/query-hash';
import { POST as batchPostHandler } from '@/app/api/files/batch/route';
import { GET as fileGetHandler, PATCH as filePatchHandler } from '@/app/api/files/[id]/route';
import { setupMockFetch } from '@/test/harness/mock-fetch';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Mock: test database
// ---------------------------------------------------------------------------
jest.mock('@/lib/database/db-config', () => ({
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

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
            headers: { ...init?.headers, 'x-user-id': '1' },
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
            headers: { ...init?.headers, 'x-user-id': '1' },
          });
          const res = await filePatchHandler(req, { params: Promise.resolve({ id: fileId! }) });
          return { ok: res.status === 200, status: res.status, json: async () => res.json() } as Response;
        }

        // GET /api/files/:id — individual file fetch
        if (urlStr.match(/\/api\/files\/\d+(\?|$)/) && (!init?.method || init?.method === 'GET')) {
          const fileId = urlStr.match(/\/api\/files\/(\d+)/)?.[1];
          const req = new NextRequest(fullUrl, {
            method: 'GET',
            headers: { 'x-user-id': '1' },
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
    mode: 'org',
  };

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------
  beforeAll(async () => {
    await initTestDatabase(dbPath);

    // Simple question — no params
    const questionContent: QuestionContent = {
      description: 'Total sales by month',
      query: 'SELECT month, SUM(total) as total FROM sales GROUP BY month',
      connection_name: 'test_db',
      parameters: [],
      vizSettings: { type: 'table', xCols: [], yCols: [] },
    };
    questionId = await DocumentDB.create('Sales Query', '/org/sales-query', 'question', questionContent, []);
    await DocumentDB.update(questionId, 'Sales Query', '/org/sales-query', questionContent, [], 'init-question');

    // Dashboard referencing the simple question (no param override)
    const dashboardContent = {
      description: 'Sales overview',
      assets: [{ type: 'question', id: questionId }],
      layout: {},
      parameterValues: {},
    } as DocumentContent;
    dashboardId = await DocumentDB.create('Sales Dashboard', '/org/sales-dashboard', 'dashboard', dashboardContent, [questionId]);
    await DocumentDB.update(dashboardId, 'Sales Dashboard', '/org/sales-dashboard', dashboardContent, [questionId], 'init-dashboard');

    // Question with :limit param — own default limit=5
    const paramQuestionContent = {
      description: 'Sales with limit param',
      query: 'SELECT month, total FROM sales LIMIT :limit',
      connection_name: 'test_db',
      parameters: [{ name: 'limit', type: 'number', value: '5' }],
      parameterValues: { limit: '5' },
      vizSettings: { type: 'table', xCols: [], yCols: [] },
    } as unknown as QuestionContent;
    paramQuestionId = await DocumentDB.create('Limited Sales Query', '/org/limited-sales-query', 'question', paramQuestionContent, []);
    await DocumentDB.update(paramQuestionId, 'Limited Sales Query', '/org/limited-sales-query', paramQuestionContent, [], 'init-param-question');

    // Dashboard overriding limit=10 (overrides question's default of 5)
    const paramDashboardContent = {
      description: 'Sales with param override',
      assets: [{ type: 'question', id: paramQuestionId }],
      layout: {},
      parameterValues: { limit: '10' },
    } as unknown as DocumentContent;
    paramDashboardId = await DocumentDB.create('Param Sales Dashboard', '/org/param-sales-dashboard', 'dashboard', paramDashboardContent, [paramQuestionId]);
    await DocumentDB.update(paramDashboardId, 'Param Sales Dashboard', '/org/param-sales-dashboard', paramDashboardContent, [paramQuestionId], 'init-param-dashboard');

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

  // ============================================================================
  // Agent Args Parity
  //
  // Verifies that buildServerAgentArgs() — the shared base used by all server-
  // initiated agents (Slack, Report, TestAgent, Alerts) — produces schema and
  // context identical to what the client-side AnalystAgent derives from the
  // same DB state via the same pure functions (getWhitelistedSchemaForUser,
  // getDocumentationForUser, selectDatabase).
  //
  // Three invariants:
  //   1. AnalystAgent parity — server matches client pure-function output
  //   2. Slack — buildSlackAgentArgs produces correct full args + app_state
  //   3. Context eval override — contextFileId loads THAT context's schema/docs
  // ============================================================================

  describe('Agent Args Parity', () => {
    let agentUser: EffectiveUser;
    // loadedContext is what FilesAPI returns after the context loader runs.
    // The loader overwrites fullSchema from real connections; in tests there is
    // no real DuckDB so fullSchema will be []. Both sides go through the same
    // pipeline, so parity is the invariant (not a specific non-empty value).
    let loadedContext: ContextContent;
    let secondContextId: number;

    beforeAll(async () => {
      const FilesAPI = (await import('@/lib/data/files.server')).FilesAPI;

      // Seed a connection at /org/database/test-conn (type='duckdb') with a
      // pre-populated schema so the connection loader uses the cached value
      // (rather than attempting a real DuckDB connection and returning empty).
      const testConnContent = {
        type: 'duckdb',
        config: {},
        schema: {
          schemas: [{ schema: 'main', tables: [{ table: 'users', columns: [{ name: 'id', type: 'INTEGER' }] }] }],
          updated_at: new Date().toISOString(),
        },
      } as ConnectionContent;
      const testConnId = await DocumentDB.create('test-conn', '/org/database/test-conn', 'connection', testConnContent, []);
      await DocumentDB.update(testConnId, 'test-conn', '/org/database/test-conn', testConnContent, [], 'init-test-conn');

      // Upsert the canonical /org/context with test-specific whitelist + docs.
      // (Template seed already creates /org/context with whitelist:'*'; we update it here.)
      const testContextContent: ContextContent = {
        published: { all: 1 },
        versions: [{
          version: 1,
          whitelist: [{ name: 'test-conn', type: 'connection', children: [{ name: 'main', type: 'schema' }] }],
          docs: [{ content: 'Agent documentation for testing', draft: false }],
          createdAt: new Date().toISOString(),
          createdBy: 1,
        }],
        fullSchema: [],
        fullDocs: [],
      };
      const existingOrgCtx = await DocumentDB.getByPath('/org/context');
      if (existingOrgCtx) {
        await DocumentDB.update(existingOrgCtx.id, 'context', '/org/context', testContextContent, [], 'test-edit');
      } else {
        const newCtxId = await DocumentDB.create('context', '/org/context', 'context', testContextContent, []);
        await DocumentDB.update(newCtxId, 'context', '/org/context', testContextContent, [], 'init-org-context');
      }

      // Seed a second context with distinct docs — used for the contextFileId override test.
      const evalContextContent = {
        published: { all: 1 },
        versions: [{
          version: 1,
          whitelist: [{ name: 'test-conn', type: 'connection', children: [{ name: 'main', type: 'schema' }] }],
          docs: [{ content: 'Eval-specific context documentation', draft: false }],
          createdAt: new Date().toISOString(),
          createdBy: 1,
        }],
      } as ContextContent;
      secondContextId = await DocumentDB.create('eval-context', '/org/eval-context', 'context', evalContextContent, []);
      await DocumentDB.update(secondContextId, 'eval-context', '/org/eval-context', evalContextContent, [], 'init-eval-context');

      // home_folder='' → resolveHomeFolderSync('org', '') → '/org' (mode root)
      agentUser = {
        userId: 1,
        email: 'test@example.com',
        name: 'Test User',
        role: 'admin',
        home_folder: '',
        mode: 'org',
      };

      // Load the canonical /org/context through FilesAPI (same pipeline buildServerAgentArgs uses)
      // so loadedContext.fullSchema reflects what the loader actually computed.
      const result = await FilesAPI.loadFileByPath('/org/context', agentUser);
      loadedContext = result.data.content as ContextContent;
    });

    // ── Test 1: AnalystAgent parity ──────────────────────────────────────────
    //
    // ChatInterface (client) builds agent_args schema/context via:
    //   databases = getWhitelistedSchemaForUser(contextContent, userId)   ← no currentPath for explore
    //   selectedDb = selectDatabase(databases, null)
    //   schema     = databases.find(selectedDb)?.schemas.map(...)
    //   context    = getDocumentationForUser(contextContent, userId)
    //
    // buildServerAgentArgs (server) uses the same pure functions internally.
    // For contexts without childPaths restrictions (the common case and all
    // seeded test data), omitting currentPath produces identical output to
    // passing effectiveHomeFolder — so both paths agree.
    it('AnalystAgent parity: server schema/context matches client pure-function output', async () => {
      const args = await buildServerAgentArgs(agentUser);

      expect(args.connection_id).toBe('test-conn');
      expect(args.selected_database_info).toEqual({ name: 'test-conn', dialect: 'duckdb' });

      // Replicate exactly what ChatInterface does on the explore page (no currentPath).
      const clientDatabases = getWhitelistedSchemaForUser(loadedContext, agentUser.userId);
      const selectedDbName = selectDatabase(clientDatabases, null);
      const selectedDb = clientDatabases.find(d => d.databaseName === selectedDbName) ?? clientDatabases[0];
      const clientSchema = selectedDb
        ? selectedDb.schemas.map(s => ({ schema: s.schema, tables: s.tables.map(t => t.table) }))
        : [];
      const clientContext = getDocumentationForUser(loadedContext, agentUser.userId);

      // Server output must equal client pure-function output.
      expect(args.schema).toEqual(clientSchema);
      expect(args.context).toBe(clientContext);
      // Docs survive the context loader (unlike fullSchema which is overwritten).
      expect(args.context).toContain('Agent documentation for testing');
    });

    // ── Test 2: Slack — all agent_args fields ────────────────────────────────
    //
    // buildSlackAgentArgs is called with a real Slack user (who has a home_folder).
    // It must produce correct connection, schema, context, AND add app_state: { type: 'slack' }.
    it('buildSlackAgentArgs: all fields correct for Slack user', async () => {
      // Slack users have a real home_folder from their user profile.
      const slackUser: EffectiveUser = {
        ...agentUser,
        userId: 1,
        home_folder: 'sales',  // resolves to /org/sales
      };

      const slack = await buildSlackAgentArgs(slackUser);

      // ── connection fields ──
      expect(slack.connection_id).toBe('test-conn');
      expect(slack.selected_database_info).toEqual({ name: 'test-conn', dialect: 'duckdb' });

      // ── schema + context must match the same pipeline as buildServerAgentArgs ──
      const effectiveHomeFolder = resolveHomeFolderSync(slackUser.mode, slackUser.home_folder || '');
      // Nearest context for /org/sales → falls back to first available (/org/test-context)
      const { FilesAPI } = await import('@/lib/data/files.server');
      const contextFiles = (await FilesAPI.getFiles(
        { type: 'context', paths: [resolvePath(slackUser.mode, '/')], depth: -1 },
        slackUser
      )).data;
      const { findNearestContextPath } = await import('@/lib/context/context-utils');
      const nearestPath = findNearestContextPath(contextFiles.map(f => f.path), effectiveHomeFolder);
      const resolvedContext = nearestPath
        ? (await FilesAPI.loadFileByPath(nearestPath, slackUser)).data.content as ContextContent
        : loadedContext;

      const whitelisted = getWhitelistedSchemaForUser(resolvedContext, slackUser.userId, effectiveHomeFolder);
      const selectedDbName = selectDatabase(whitelisted, null);
      const selectedDb = whitelisted.find(d => d.databaseName === selectedDbName) ?? whitelisted[0];
      const expectedSchema = selectedDb
        ? selectedDb.schemas.map(s => ({ schema: s.schema, tables: s.tables.map(t => t.table) }))
        : [];
      const expectedContext = getDocumentationForUser(resolvedContext, slackUser.userId);

      expect(slack.schema).toEqual(expectedSchema);
      expect(slack.context).toBe(expectedContext);
      expect(slack.context).toContain('Agent documentation for testing');

      // ── Slack-specific field ──
      expect(slack.app_state).toEqual({ type: 'slack' });
    });

    // ── Test 3: context eval override — contextFileId ────────────────────────
    //
    // context-handler.ts passes { contextFileId: parseInt(jobId) } so the
    // TestAgent receives schema/docs from the context file being evaluated,
    // not from the nearest ancestor of the cron user's home folder.
    it('buildServerAgentArgs with contextFileId: uses specified context file, not nearest ancestor', async () => {
      // Without override: picks /org/test-context (nearest / first available).
      const baseArgs = await buildServerAgentArgs(agentUser);
      expect(baseArgs.context).toContain('Agent documentation for testing');
      expect(baseArgs.context).not.toContain('Eval-specific context documentation');

      // With override: must use the second context's docs regardless of path.
      const overriddenArgs = await buildServerAgentArgs(agentUser, { contextFileId: secondContextId });
      expect(overriddenArgs.context).toContain('Eval-specific context documentation');
      expect(overriddenArgs.context).not.toContain('Agent documentation for testing');

      // Connection fields are independent of the context override.
      expect(overriddenArgs.connection_id).toBe(baseArgs.connection_id);
      expect(overriddenArgs.selected_database_info).toEqual(baseArgs.selected_database_info);
    });
  }); // end Agent Args Parity
}); // end Client-Server File State Parity
