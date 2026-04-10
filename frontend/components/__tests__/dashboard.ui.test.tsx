/**
 * Dashboard UI tests — organized by scenario.
 *
 * Each describe block covers one user-facing scenario and contains both the
 * manual (user interaction) and agentic (agent-driven) versions side by side.
 *
 * Scenarios:
 *   1. Add question to existing dashboard and save
 *   2. Create new dashboard + question, then publishAll
 *   3. Edit/cancel mode toggle  (manual only — no agentic equivalent)
 *
 * Infrastructure (shared across all manual describes):
 * - makeStore() creates a fresh Redux store per test
 * - jest.spyOn(storeModule, 'getStore') aligns all utility code (loadFiles,
 *   publishFile, editFile) with the same store the Provider uses
 * - global.fetch is mocked inline — no Python backend required
 */

// Must be hoisted before any module imports

jest.mock('@/lib/database/db-config', () => {
  const path = require('path');
  return {
    DB_PATH: path.join(process.cwd(), 'data', 'test_dashboard_ui.db'),
    DB_DIR: path.join(process.cwd(), 'data'),
    getDbType: () => 'sqlite' as const,
    DB_TYPE: 'sqlite',
  };
});

// Wrap generateVirtualId in jest.fn so combined-flow tests can use
// mockReturnValueOnce to predict which virtual IDs Navigate and CreateFile produce.
// Explicitly include __esModule + default to survive the circular-ref between
// filesSlice and store during jest.requireActual evaluation.
jest.mock('@/store/filesSlice', () => {
  const actual = jest.requireActual('@/store/filesSlice');
  return {
    __esModule: true,
    ...actual,
    default: actual.default,
    generateVirtualId: jest.fn(actual.generateVirtualId),
  };
});

import React, { useEffect, useRef } from 'react';
import { screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextRequest } from 'next/server';

import * as storeModule from '@/store/store';
import type { RootState } from '@/store/store';
import * as filesSliceModule from '@/store/filesSlice';
import { setFile, setEdit, addQuestionToDashboard, selectDirtyFiles } from '@/store/filesSlice';
import * as useNavModule from '@/lib/navigation/use-navigation';
import { setDashboardEditMode } from '@/store/uiSlice';
import { setNavigation } from '@/store/navigationSlice';
import { createConversation, sendMessage, selectConversation, setUserInputResult } from '@/store/chatSlice';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { publishAll } from '@/lib/api/file-state';
import type { DashboardContent } from '@/lib/types.gen';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { renderFilePage } from '@/test/helpers/render-file-page';
import { waitForReduxState, waitForConversationFinished } from '@/test/helpers/redux-wait';
import FileHeader from '@/components/FileHeader';
import DashboardContainerV2 from '@/components/containers/DashboardContainerV2';

import { withPythonBackend } from '@/test/harness/python-backend';
import { setupTestDb } from '@/test/harness/test-db';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { POST as chatPostHandler } from '@/app/api/chat/route';
import { GET as filesGetHandler } from '@/app/api/files/route';
import { PATCH as filePatchHandler } from '@/app/api/files/[id]/route';
import { POST as batchCreateHandler } from '@/app/api/files/batch-create/route';
import { POST as batchSaveHandler } from '@/app/api/files/batch-save/route';
import { POST as batchFilesHandler } from '@/app/api/files/batch/route';
import { POST as templateHandler } from '@/app/api/files/template/route';
import { GET as connectionsGetHandler } from '@/app/api/connections/route';

// Capture the real Node.js fetch before any test can override global.fetch.
// Used by the agentic fetch mock to route Python backend calls to the real server.
const realFetch = global.fetch;

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const DASHBOARD_ID = 1002;
const QUESTION_ID = 1003;
const QUESTION_ID_2 = 1004;
const QUESTION_NAME = 'Sales Revenue';

function makeDashboardDbFile() {
  return {
    id: DASHBOARD_ID,
    name: 'Test Dashboard',
    type: 'dashboard' as const,
    path: '/org/Test Dashboard',
    content: { assets: [], layout: null },
    created_at: '2025-01-01T00:00:00Z',
    updated_at: new Date().toISOString(),
    references: [] as number[],
    version: 1,
    last_edit_id: null,
    company_id: 1,
  };
}

function makeQuestionDbFile() {
  return {
    id: QUESTION_ID,
    name: QUESTION_NAME,
    type: 'question' as const,
    path: `/org/${QUESTION_NAME}`,
    content: { query: 'SELECT 1', vizSettings: { type: 'table' as const }, connection_name: '' },
    created_at: '2025-01-01T00:00:00Z',
    updated_at: new Date().toISOString(),
    references: [] as number[],
    version: 1,
    last_edit_id: null,
    company_id: 1,
  };
}

function makeQuestionDbFile2() {
  return {
    id: QUESTION_ID_2,
    name: 'Regional Revenue',
    type: 'question' as const,
    path: '/org/Regional Revenue',
    content: { query: 'SELECT region FROM sales GROUP BY region', vizSettings: { type: 'table' as const }, connection_name: '' },
    created_at: '2025-01-01T00:00:00Z',
    updated_at: new Date().toISOString(),
    references: [] as number[],
    version: 1,
    last_edit_id: null,
    company_id: 1,
  };
}

// ---------------------------------------------------------------------------
// Agentic test helpers
// ---------------------------------------------------------------------------

/**
 * Automatically confirms Navigate tool's UserInputException (type: 'confirmation').
 * Renders nothing; exists only for side-effects.
 */
function AutoNavigateConfirmation() {
  const dispatch = useAppDispatch();
  const allConversations = useAppSelector((state: RootState) => state.chat.conversations);
  const handledIds = useRef(new Set<string>());

  useEffect(() => {
    for (const conv of Object.values(allConversations)) {
      for (const pendingTool of conv.pending_tool_calls ?? []) {
        const ui = pendingTool.userInputs?.find(
          u => u.result === undefined && u.props?.type === 'confirmation'
        );
        if (!ui || handledIds.current.has(ui.id)) continue;
        handledIds.current.add(ui.id);
        dispatch(setUserInputResult({
          conversationID: conv.conversationID,
          tool_call_id: pendingTool.toolCall.id,
          userInputId: ui.id,
          result: true,
        }));
      }
    }
  });
  return null;
}

/**
 * Automatically handles PublishAll's UserInputException by calling publishAll()
 * and dispatching setUserInputResult.  Renders nothing; exists only for side-effects.
 */
function AutoPublishUserInput() {
  const dispatch = useAppDispatch();
  const allConversations = useAppSelector((state: RootState) => state.chat.conversations);
  const handledIds = useRef(new Set<string>());

  // Runs after every render; handledIds prevents duplicate handling.
  useEffect(() => {
    for (const conv of Object.values(allConversations)) {
      for (const pendingTool of conv.pending_tool_calls ?? []) {
        const pendingInput = pendingTool.userInputs?.find(ui => ui.result === undefined);
        if (!pendingInput || handledIds.current.has(pendingInput.id)) continue;
        if (pendingInput.props?.type === 'publish') {
          handledIds.current.add(pendingInput.id);
          const convId = conv.conversationID;
          const toolCallId = pendingTool.toolCall.id;
          const inputId = pendingInput.id;
          publishAll()
            .then(() => {
              dispatch(setUserInputResult({
                conversationID: convId,
                tool_call_id: toolCallId,
                userInputId: inputId,
                result: { published: true },
              }));
            })
            .catch((err: unknown) => {
              console.error('[AutoPublishUserInput] publishAll failed:', err);
              dispatch(setUserInputResult({
                conversationID: convId,
                tool_call_id: toolCallId,
                userInputId: inputId,
                result: { cancelled: true, remaining: 0 },
              }));
            });
        }
      }
    }
  });

  return null;
}

/**
 * Insert the shared dashboard + question fixtures into the test SQLite DB.
 * Used as `customInit` in setupTestDb for tests that need pre-existing files.
 */
async function insertDashboardAndQuestion(dbPath: string): Promise<void> {
  const { createAdapter } = await import('@/lib/database/adapter/factory');
  const db = await createAdapter({ type: 'sqlite', sqlitePath: dbPath });
  const now = new Date().toISOString();
  await db.query(
    `INSERT INTO files (company_id, id, name, path, type, content, file_references, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [1, DASHBOARD_ID, 'Test Dashboard', '/org/Test Dashboard', 'dashboard',
      JSON.stringify({ assets: [], layout: null }), '[]', now, now]
  );
  await db.query(
    `INSERT INTO files (company_id, id, name, path, type, content, file_references, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [1, QUESTION_ID, QUESTION_NAME, `/org/${QUESTION_NAME}`, 'question',
      JSON.stringify({ query: 'SELECT 1', vizSettings: { type: 'table' }, connection_name: '' }), '[]', now, now]
  );
  await db.close();
}

/**
 * Seeds dashboard(1) + question(2) + question(3) — for multi-question tests.
 */
async function insertDashboardAndTwoQuestions(dbPath: string): Promise<void> {
  await insertDashboardAndQuestion(dbPath);
  const { createAdapter } = await import('@/lib/database/adapter/factory');
  const db = await createAdapter({ type: 'sqlite', sqlitePath: dbPath });
  const now = new Date().toISOString();
  await db.query(
    `INSERT INTO files (company_id, id, name, path, type, content, file_references, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [1, QUESTION_ID_2, 'Regional Revenue', '/org/Regional Revenue', 'question',
      JSON.stringify({ query: 'SELECT region FROM sales GROUP BY region', vizSettings: { type: 'table' }, connection_name: '' }),
      '[]', now, now]
  );
  await db.close();
}

/**
 * Seeds dashboard(1) + two questions with a shared :start_date param — for parameter merging tests.
 */
async function insertQuestionsWithSharedParams(dbPath: string): Promise<void> {
  const { createAdapter } = await import('@/lib/database/adapter/factory');
  const db = await createAdapter({ type: 'sqlite', sqlitePath: dbPath });
  const now = new Date().toISOString();
  await db.query(
    `INSERT INTO files (company_id, id, name, path, type, content, file_references, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [1, DASHBOARD_ID, 'Param Dashboard', '/org/Param Dashboard', 'dashboard',
      JSON.stringify({ assets: [{ type: 'question', id: QUESTION_ID }, { type: 'question', id: QUESTION_ID_2 }], layout: null }),
      JSON.stringify([QUESTION_ID, QUESTION_ID_2]), now, now]
  );
  await db.query(
    `INSERT INTO files (company_id, id, name, path, type, content, file_references, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [1, QUESTION_ID, 'Orders Q', '/org/Orders Q', 'question',
      JSON.stringify({ query: 'SELECT * FROM orders WHERE order_date >= :start_date', parameters: [], vizSettings: { type: 'table' }, connection_name: '' }),
      '[]', now, now]
  );
  await db.query(
    `INSERT INTO files (company_id, id, name, path, type, content, file_references, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [1, QUESTION_ID_2, 'Revenue Q', '/org/Revenue Q', 'question',
      JSON.stringify({ query: 'SELECT * FROM revenue WHERE order_date >= :start_date AND region = :region', parameters: [], vizSettings: { type: 'table' }, connection_name: '' }),
      '[]', now, now]
  );
  await db.close();
}

/**
 * Build a jest.fn() fetch mock that routes all dashboard-related API calls to
 * real Next.js route handlers backed by the test SQLite DB (no hardcoded
 * response bodies).  Pass pythonPort / llmPort to also route agent calls.
 */
function makeRealApiFetch(opts: { pythonPort?: number; llmPort?: number } = {}) {
  const { pythonPort, llmPort } = opts;
  const BASE = 'http://localhost:3000';

  const call = async (
    handler: (req: NextRequest, ctx?: any) => Promise<Response>,
    url: string,
    init?: RequestInit,
    context?: any,
  ): Promise<Response> => {
    const req = new NextRequest(url, {
      method: init?.method ?? 'GET',
      body: (init?.body as string) ?? null,
      headers: (init?.headers as HeadersInit) ?? undefined,
    });
    const resp = context ? await handler(req, context) : await handler(req);
    const data = await resp.json();
    return { ok: resp.status < 400, status: resp.status, json: async () => data } as Response;
  };

  return jest.fn(async (url: string | Request | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = url.toString();
    const method = (init?.method ?? 'GET').toUpperCase();

    // /api/chat → real chatPostHandler
    if (urlStr.startsWith('/api/chat') || urlStr.includes('localhost:3000/api/chat')) {
      return call(chatPostHandler, `${BASE}/api/chat`, init);
    }

    // Python backend → pass through to real server
    if (pythonPort && (urlStr.includes(`localhost:${pythonPort}`) || urlStr.includes('localhost:8001'))) {
      return realFetch(urlStr.replace('localhost:8001', `localhost:${pythonPort}`), init);
    }

    // LLM mock server → pass through
    if (llmPort && urlStr.includes(`localhost:${llmPort}`)) {
      return realFetch(urlStr, init);
    }

    // POST /api/files/batch-create → real batchCreateHandler
    if (method === 'POST' && urlStr.includes('/api/files/batch-create')) {
      return call(batchCreateHandler, `${BASE}/api/files/batch-create`, init);
    }

    // POST /api/files/batch-save → real batchSaveHandler
    if (method === 'POST' && urlStr.includes('/api/files/batch-save')) {
      return call(batchSaveHandler, `${BASE}/api/files/batch-save`, init);
    }

    // POST /api/files/batch → real batchFilesHandler (load by IDs)
    if (method === 'POST' && urlStr.includes('/api/files/batch')) {
      return call(batchFilesHandler, `${BASE}/api/files/batch`, init);
    }

    // POST /api/files/template → real templateHandler
    if (method === 'POST' && urlStr.includes('/api/files/template')) {
      return call(templateHandler, `${BASE}/api/files/template`, init);
    }

    // PATCH /api/files/:id → real filePatchHandler (save individual file)
    if (method === 'PATCH') {
      const m = urlStr.match(/\/api\/files\/(\d+)/);
      if (m) {
        const fullUrl = urlStr.startsWith('http') ? urlStr : `${BASE}${urlStr}`;
        return call(filePatchHandler, fullUrl, init, { params: Promise.resolve({ id: m[1] }) });
      }
    }

    // GET /api/files?... → real filesGetHandler (folder listings, type filters)
    if (method === 'GET' && urlStr.includes('/api/files') && !urlStr.match(/\/api\/files\/\d+/)) {
      const fullUrl = urlStr.startsWith('http') ? urlStr : `${BASE}${urlStr}`;
      return call(filesGetHandler, fullUrl, init);
    }

    // GET /api/connections → real connectionsGetHandler
    if (method === 'GET' && urlStr.includes('/api/connections') && !urlStr.includes('/schema')) {
      return call(connectionsGetHandler, `${BASE}/api/connections`, init);
    }

    // Health check
    if (urlStr.includes('/health')) {
      return { ok: true, status: 200, json: async () => ({ status: 'healthy' }) } as Response;
    }

    // Catch-all for non-critical GETs (configs, context, etc.) that are not under test
    if (method === 'GET') {
      return { ok: true, status: 200, json: async () => ({ data: null }) } as Response;
    }

    throw new Error(`[Dashboard UI] Unmocked fetch: ${method} ${urlStr}`);
  });
}

// ============================================================================
// Scenario 1: Add question to existing dashboard and save
// ============================================================================

describe('Add question to existing dashboard and save', () => {
  setupTestDb(getTestDbPath('dashboard_ui'), { customInit: insertDashboardAndQuestion });

  let testStore: ReturnType<typeof storeModule.makeStore>;
  let getStoreSpy: jest.SpyInstance;

  beforeEach(() => {
    testStore = storeModule.makeStore();
    getStoreSpy = jest.spyOn(storeModule, 'getStore').mockReturnValue(testStore);
    testStore.dispatch(setFile({ file: makeDashboardDbFile(), references: [] }));
    testStore.dispatch(setFile({ file: makeQuestionDbFile(), references: [] }));
    testStore.dispatch(setDashboardEditMode({ fileId: DASHBOARD_ID, editMode: true }));
    global.fetch = makeRealApiFetch();
  });

  afterEach(() => {
    global.fetch = realFetch;
    getStoreSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('manual: adds question to empty dashboard and saves via Publish button', async () => {
    const user = userEvent.setup();

    renderWithProviders(
      <>
        <FileHeader fileId={DASHBOARD_ID} fileType="dashboard" />
        <DashboardContainerV2 fileId={DASHBOARD_ID} />
      </>,
      { store: testStore }
    );

    // Dashboard is in edit mode with no questions — QuestionBrowserPanel is shown
    // inline. Wait for the panel to populate, find the question card, click Add.
    const questionCard = await screen.findByLabelText(QUESTION_NAME);
    const addButton = within(questionCard).getByLabelText('Add to dashboard');
    await user.click(addButton);

    // Redux: dashboard is now dirty with the new asset
    await waitForReduxState(
      testStore,
      state => {
        const fileState = state.files.files[DASHBOARD_ID];
        const merged = {
          ...(fileState.content as DashboardContent),
          ...(fileState.persistableChanges as Partial<DashboardContent> | undefined),
        };
        return merged.assets?.some(a => (a as { id: number }).id === QUESTION_ID) ?? false;
      },
      v => v === true
    );

    // "Save" button is now enabled
    const publishBtn = screen.getByLabelText('Save');
    expect(publishBtn).not.toBeDisabled();
    await user.click(publishBtn);

    // After save: clearEdits fires → persistableChanges is empty
    await waitForReduxState(
      testStore,
      state => Object.keys(state.files.files[DASHBOARD_ID].persistableChanges ?? {}),
      keys => keys.length === 0
    );

    // DB read-back: batch-save route returns full DbFile → setFile replaces content in Redux.
    // Asserting here is equivalent to reading the DB row directly.
    const savedContent = testStore.getState().files.files[DASHBOARD_ID].content as DashboardContent;
    expect(savedContent.assets).toHaveLength(1);
    expect(savedContent.assets![0]).toMatchObject({ type: 'question', id: QUESTION_ID });

    // Confirm the PATCH was issued exactly once
    const saveCalls = (global.fetch as jest.Mock).mock.calls.filter(
      ([url, init]) =>
        typeof url === 'string' &&
        url.includes(`/api/files/${DASHBOARD_ID}`) &&
        init?.method?.toUpperCase() === 'PATCH'
    );
    expect(saveCalls).toHaveLength(1);
  });
});

// ============================================================================
// Scenario 2: Create new dashboard and question, then publishAll
// ============================================================================

describe('Create new dashboard and question, then publishAll', () => {
  // Fresh empty DB — virtual files created in test don't need pre-existing fixtures
  setupTestDb(getTestDbPath('dashboard_ui'));

  let testStore: ReturnType<typeof storeModule.makeStore>;
  let getStoreSpy: jest.SpyInstance;

  beforeEach(() => {
    testStore = storeModule.makeStore();
    getStoreSpy = jest.spyOn(storeModule, 'getStore').mockReturnValue(testStore);
    global.fetch = makeRealApiFetch();
  });

  afterEach(() => {
    global.fetch = realFetch;
    getStoreSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('manual: publishAll saves virtual question first, then virtual dashboard with resolved references', async () => {
    const Q_VID = -1;
    const DASH_VID = -2;
    const Q_NAME = 'Revenue Query';
    const DASH_NAME = 'New Dashboard';

    // Seed virtual files (negative IDs) into Redux
    testStore.dispatch(setFile({
      file: {
        id: Q_VID, name: Q_NAME, type: 'question' as const,
        path: `/org/${Q_NAME}`,
        content: { query: '', vizSettings: { type: 'table' as const }, connection_name: '' },
        created_at: '', updated_at: '', references: [] as number[],
        version: 1, last_edit_id: null, company_id: 1,
      },
      references: [],
    }));
    testStore.dispatch(setFile({
      file: {
        id: DASH_VID, name: DASH_NAME, type: 'dashboard' as const,
        path: `/org/${DASH_NAME}`,
        content: { assets: [], layout: null },
        created_at: '', updated_at: '', references: [] as number[],
        version: 1, last_edit_id: null, company_id: 1,
      },
      references: [],
    }));

    // Make the question dirty; link it to the dashboard
    testStore.dispatch(setEdit({
      fileId: Q_VID,
      edits: { query: 'SELECT revenue FROM sales', vizSettings: { type: 'table' as const }, connection_name: 'default' },
    }));
    testStore.dispatch(addQuestionToDashboard({ dashboardId: DASH_VID, questionId: Q_VID }));

    await act(async () => { await publishAll(); });

    // Two separate batch-create calls — one per topological level
    const fetchMock = global.fetch as jest.Mock;
    const batchCreateCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes('/api/files/batch-create'));
    expect(batchCreateCalls).toHaveLength(2);

    // Call 1: question only (no unresolved virtual deps)
    const firstBody = JSON.parse(batchCreateCalls[0][1].body) as { files: Array<{ type: string; virtualId: number }> };
    expect(firstBody.files).toHaveLength(1);
    expect(firstBody.files[0].type).toBe('question');

    // Call 2: dashboard whose assets already carry the REAL (positive) question ID
    const secondBody = JSON.parse(batchCreateCalls[1][1].body) as { files: Array<{ type: string; content: DashboardContent }> };
    expect(secondBody.files).toHaveLength(1);
    expect(secondBody.files[0].type).toBe('dashboard');
    const assetIds = secondBody.files[0].content.assets?.map(a => (a as { id: number }).id) ?? [];
    expect(assetIds).toHaveLength(1);
    expect(assetIds[0]).toBeGreaterThan(0); // real (DB-assigned) ID, not the virtual Q_VID

    // No dirty files remain after publishAll
    expect(selectDirtyFiles(testStore.getState())).toHaveLength(0);

    // DB read-back: addFile(DB_response) put the new question in Redux — verify content round-trip.
    const allFiles = Object.values(testStore.getState().files.files);
    const savedQ = allFiles.find(f => f.type === 'question' && f.id > 0 && f.name === Q_NAME);
    expect((savedQ!.content as any).query).toBe('SELECT revenue FROM sales');
  });
});

// ============================================================================
// Scenario 3: Edit/cancel mode toggle  (manual only)
// ============================================================================

describe('Dashboard edit/cancel mode toggle', () => {
  setupTestDb(getTestDbPath('dashboard_ui'), { customInit: insertDashboardAndQuestion });

  let testStore: ReturnType<typeof storeModule.makeStore>;
  let getStoreSpy: jest.SpyInstance;

  beforeEach(() => {
    testStore = storeModule.makeStore();
    getStoreSpy = jest.spyOn(storeModule, 'getStore').mockReturnValue(testStore);
    testStore.dispatch(setFile({ file: makeDashboardDbFile(), references: [] }));
    testStore.dispatch(setFile({ file: makeQuestionDbFile(), references: [] }));
    global.fetch = makeRealApiFetch();
  });

  afterEach(() => {
    global.fetch = realFetch;
    getStoreSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('manual: enters and exits edit mode via the Edit / Cancel toggle', async () => {
    const user = userEvent.setup();

    // Start in view mode
    testStore.dispatch(setDashboardEditMode({ fileId: DASHBOARD_ID, editMode: false }));

    renderWithProviders(
      <>
        <FileHeader fileId={DASHBOARD_ID} fileType="dashboard" />
        <DashboardContainerV2 fileId={DASHBOARD_ID} />
      </>,
      { store: testStore }
    );

    expect(await screen.findByLabelText('Dashboard')).toBeInTheDocument();

    // Enter edit mode
    await user.click(screen.getByLabelText('Edit'));
    expect(testStore.getState().ui.dashboardEditMode?.[DASHBOARD_ID]).toBe(true);

    // Exit edit mode
    await user.click(screen.getByLabelText('Cancel editing'));
    expect(testStore.getState().ui.dashboardEditMode?.[DASHBOARD_ID]).toBe(false);
  });
});

// ============================================================================
// Dashboard agentic scenarios
// (co-located with the manual scenarios above — same outcomes, agent-driven)
// ============================================================================

describe('Dashboard agentic scenarios', () => {
  const { getPythonPort, getLLMMockPort, getLLMMockServer } = withPythonBackend({ withLLMMock: true });
  // customInit inserts the shared fixtures (dashboard id=1, question id=2) so the
  // real batch-save and batch-create handlers can find/update them in the DB.
  setupTestDb(getTestDbPath('dashboard_ui'), { customInit: insertDashboardAndQuestion });

  // Virtual IDs pre-seeded for Scenario 2
  const Q_VID = -100;
  const DASH_VID = -101;
  const AGENTIC_Q_NAME = 'Revenue Query';
  const AGENTIC_DASH_NAME = 'Agentic Dashboard';

  let testStore: ReturnType<typeof storeModule.makeStore>;
  let getStoreSpy: jest.SpyInstance;

  beforeEach(() => {
    testStore = storeModule.makeStore();
    getStoreSpy = jest.spyOn(storeModule, 'getStore').mockReturnValue(testStore);

    const pythonPort = getPythonPort();
    const llmPort = getLLMMockPort?.();

    // All API calls go to real Next.js route handlers backed by the test DB.
    global.fetch = makeRealApiFetch({ pythonPort, llmPort });
  });

  afterEach(() => {
    global.fetch = realFetch;
    getStoreSpy.mockRestore();
  });

  // ---------------------------------------------------------------------------
  // Scenario 1 (agentic): agent uses EditFile + PublishAll to add question to dashboard
  // ---------------------------------------------------------------------------

  it('agentic (Scenario 1): agent adds question to existing dashboard via EditFile + PublishAll', async () => {
    const mockServer = getLLMMockServer!();
    await mockServer.reset();
    await mockServer.configure([
      // Turn 1: EditFile — agent stages the question in the dashboard's assets array
      {
        response: {
          content: '',
          role: 'assistant',
          tool_calls: [{
            id: 'tc_edit_dash',
            type: 'function',
            function: {
              name: 'EditFile',
              arguments: JSON.stringify({
                fileId: DASHBOARD_ID,
                changes: [{
                  oldMatch: '"assets":[]',
                  newMatch: `"assets":[{"type":"question","id":${QUESTION_ID}}]`,
                }],
              }),
            },
          }],
          finish_reason: 'tool_calls',
        },
        usage: { total_tokens: 150, prompt_tokens: 120, completion_tokens: 30 },
      },
      // Turn 2: PublishAll — agent publishes the staged change
      {
        response: {
          content: '',
          role: 'assistant',
          tool_calls: [{
            id: 'tc_publish_dash',
            type: 'function',
            function: { name: 'PublishAll', arguments: '{}' },
          }],
          finish_reason: 'tool_calls',
        },
        usage: { total_tokens: 80, prompt_tokens: 60, completion_tokens: 20 },
      },
      // Turn 3: done
      {
        response: {
          content: `Done! ${QUESTION_NAME} has been added to the dashboard and published.`,
          role: 'assistant',
          tool_calls: [],
          finish_reason: 'stop',
        },
        usage: { total_tokens: 60, prompt_tokens: 40, completion_tokens: 20 },
      },
    ]);

    // Pre-seed real dashboard (ID=1) and question (ID=2)
    testStore.dispatch(setFile({ file: makeDashboardDbFile(), references: [] }));
    testStore.dispatch(setFile({ file: makeQuestionDbFile(), references: [] }));
    testStore.dispatch(setDashboardEditMode({ fileId: DASHBOARD_ID, editMode: true }));

    // AutoPublishUserInput auto-confirms the PublishAll user input request
    renderWithProviders(<AutoPublishUserInput />, { store: testStore });

    const CONV_ID = -400;
    testStore.dispatch(createConversation({
      conversationID: CONV_ID,
      agent: 'AnalystAgent',
      agent_args: { goal: `Add ${QUESTION_NAME} to the dashboard and publish` },
    }));
    testStore.dispatch(sendMessage({
      conversationID: CONV_ID,
      message: `Add the ${QUESTION_NAME} question to Test Dashboard and publish the changes`,
    }));

    const realConvId = await waitForConversationFinished(
      () => testStore.getState() as RootState,
      CONV_ID
    );

    // Conversation completed without errors
    expect(selectConversation(testStore.getState() as RootState, realConvId)?.error).toBeUndefined();

    // Dashboard persistableChanges cleared after publish
    const dashState = testStore.getState().files.files[DASHBOARD_ID];
    expect(Object.keys(dashState?.persistableChanges ?? {})).toHaveLength(0);
  }, 45000);

  // ---------------------------------------------------------------------------
  // Scenario 2 (agentic): agent calls PublishAll; virtual files saved in topological order
  // ---------------------------------------------------------------------------

  it('agentic (Scenario 2): agent publishes virtual question + dashboard in topological order', async () => {
    const mockServer = getLLMMockServer!();
    await mockServer.reset();
    await mockServer.configure([
      // Turn 1: agent calls PublishAll — dirty virtual files exist
      {
        response: {
          content: '',
          role: 'assistant',
          tool_calls: [{
            id: 'tc_pub_all',
            type: 'function',
            function: { name: 'PublishAll', arguments: '{}' },
          }],
          finish_reason: 'tool_calls',
        },
        usage: { total_tokens: 80, prompt_tokens: 60, completion_tokens: 20 },
      },
      // Turn 2: done
      {
        response: {
          content: 'Done! All pending changes have been published.',
          role: 'assistant',
          tool_calls: [],
          finish_reason: 'stop',
        },
        usage: { total_tokens: 60, prompt_tokens: 40, completion_tokens: 20 },
      },
    ]);

    // Pre-seed virtual question and virtual dashboard with question already linked.
    // (CreateFile cannot create dashboards in the background, so the virtual dashboard
    //  is pre-seeded here to represent pre-existing unsaved work.)
    testStore.dispatch(setFile({
      file: {
        id: Q_VID, name: AGENTIC_Q_NAME, type: 'question' as const,
        path: `/org/${AGENTIC_Q_NAME}`,
        content: { query: '', vizSettings: { type: 'table' as const }, connection_name: '' },
        created_at: '', updated_at: '',
        references: [] as number[], version: 1, last_edit_id: null, company_id: 1,
      },
      references: [],
    }));
    testStore.dispatch(setFile({
      file: {
        id: DASH_VID, name: AGENTIC_DASH_NAME, type: 'dashboard' as const,
        path: `/org/${AGENTIC_DASH_NAME}`,
        content: { assets: [], layout: null },
        created_at: '', updated_at: '',
        references: [] as number[], version: 1, last_edit_id: null, company_id: 1,
      },
      references: [],
    }));
    // Make question dirty (has a real query to save)
    testStore.dispatch(setEdit({
      fileId: Q_VID,
      edits: { query: 'SELECT 1', vizSettings: { type: 'table' as const }, connection_name: 'default' },
    }));
    // Make dashboard dirty (references the virtual question)
    testStore.dispatch(addQuestionToDashboard({ dashboardId: DASH_VID, questionId: Q_VID }));

    // AutoPublishUserInput auto-confirms the PublishAll user input request
    renderWithProviders(<AutoPublishUserInput />, { store: testStore });

    const CONV_ID = -500;
    testStore.dispatch(createConversation({
      conversationID: CONV_ID,
      agent: 'AnalystAgent',
      agent_args: { goal: 'Publish all pending changes' },
    }));
    testStore.dispatch(sendMessage({
      conversationID: CONV_ID,
      message: 'Please publish all my pending changes',
    }));

    const realConvId = await waitForConversationFinished(
      () => testStore.getState() as RootState,
      CONV_ID
    );

    // Conversation completed without errors
    expect(selectConversation(testStore.getState() as RootState, realConvId)?.error).toBeUndefined();

    // batch-create was called twice — question first (level 1), dashboard second (level 2)
    const fetchMock = global.fetch as jest.Mock;
    const batchCreateCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes('/api/files/batch-create'));
    expect(batchCreateCalls).toHaveLength(2);

    // Real (positive-ID) files added to Redux
    const allFiles = Object.values(testStore.getState().files.files);
    expect(allFiles.some(f => f.type === 'question' && f.id > 0 && f.name === AGENTIC_Q_NAME)).toBe(true);
    expect(allFiles.some(f => f.type === 'dashboard' && f.id > 0)).toBe(true);

    // No dirty files remain
    expect(selectDirtyFiles(testStore.getState() as any)).toHaveLength(0);
  }, 45000);
});

// ============================================================================
// Combined flow: new dashboard with question from scratch
// (manual + agentic — exercises Navigate → CreateFile → EditFile → PublishAll)
// ============================================================================

describe('Combined flow: new dashboard with question from scratch', () => {
  const { getPythonPort, getLLMMockPort, getLLMMockServer } = withPythonBackend({ withLLMMock: true });
  // customInit inserts QUESTION_ID=2 (Sales Revenue) so QuestionBrowserPanel's
  // real GET /api/files?type=question call finds it when testing the add-existing-question flow.
  // (DASHBOARD_ID=1 is also inserted but the combined flow creates a separate virtual dashboard.)
  setupTestDb(getTestDbPath('dashboard_ui'), { customInit: insertDashboardAndQuestion });

  // Virtual IDs — deterministic because generateVirtualId is mocked:
  //   Navigate tool (after bug fix) → first generateVirtualId() call  → DASH_VID
  //   CreateFile tool               → second generateVirtualId() call → Q_VID
  const DASH_VID = -1_000_000_091;
  const Q_VID    = -1_000_000_092;
  const Q_NAME = 'Revenue Query';

  let testStore: ReturnType<typeof storeModule.makeStore>;
  let getStoreSpy: jest.SpyInstance;

  beforeEach(() => {
    testStore = storeModule.makeStore();
    getStoreSpy = jest.spyOn(storeModule, 'getStore').mockReturnValue(testStore);

    // Clear any leftover queued values from a previous test before pinning new ones.
    (filesSliceModule.generateVirtualId as jest.Mock).mockClear();
    // Pin generateVirtualId: Navigate gets DASH_VID, CreateFile gets Q_VID.
    (filesSliceModule.generateVirtualId as jest.Mock)
      .mockReturnValueOnce(DASH_VID)
      .mockReturnValueOnce(Q_VID);

    // Override getRouter() so the Navigate tool's router.push dispatches
    // setNavigation to the test store — exactly what NavigationSync does in prod.
    (useNavModule.getRouter as jest.Mock).mockReturnValue({
      push: (url: string) => {
        const u = new URL(url, 'http://localhost');
        const vid = u.searchParams.get('virtualId');
        const folder = u.searchParams.get('folder') ?? '/org';
        testStore.dispatch(setNavigation({
          pathname: u.pathname,
          searchParams: { virtualId: vid!, folder },
        }));
      },
    });

    const pythonPort = getPythonPort();
    const llmPort = getLLMMockPort?.();

    // All API calls go to real Next.js route handlers backed by the test DB.
    global.fetch = makeRealApiFetch({ pythonPort, llmPort });
  });

  afterEach(() => {
    global.fetch = realFetch;
    getStoreSpy.mockRestore();
    jest.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // Manual: simulate navigating to /new/dashboard, add a virtual question via
  // QuestionBrowserPanel, then call publishAll() directly.
  // --------------------------------------------------------------------------

  it('manual: navigates to new dashboard, adds existing question via QuestionBrowserPanel, publishAll batch-creates the new dashboard', async () => {
    const user = userEvent.setup();

    // Pre-seed the real question in Redux (QuestionBrowserPanel reads it after the API call)
    testStore.dispatch(setFile({ file: makeQuestionDbFile(), references: [] }));

    // Simulate navigation to /new/dashboard — navigationListener creates the virtual dashboard.
    // DASH_VID is pinned via mockReturnValueOnce in beforeEach.
    testStore.dispatch(setNavigation({
      pathname: '/new/dashboard',
      searchParams: { virtualId: String(DASH_VID), folder: '/org' },
    }));
    await waitForReduxState(
      testStore,
      state => state.files.files[DASH_VID],
      v => v !== undefined
    );

    // New dashboards open in edit mode — QuestionBrowserPanel is visible
    testStore.dispatch(setDashboardEditMode({ fileId: DASH_VID, editMode: true }));
    renderWithProviders(
      <DashboardContainerV2 fileId={DASH_VID} />,
      { store: testStore }
    );

    // QuestionBrowserPanel loads questions (mocked GET /api/files?type=question)
    // and renders each as an article.  Click "Add to dashboard" on the real question.
    const card = await screen.findByLabelText(QUESTION_NAME);
    await user.click(within(card).getByLabelText('Add to dashboard'));

    // Virtual dashboard is now dirty — real question linked
    await waitForReduxState(
      testStore,
      state => {
        const dash = state.files.files[DASH_VID];
        const merged = {
          ...(dash.content as DashboardContent),
          ...(dash.persistableChanges as Partial<DashboardContent> | undefined),
        };
        return merged.assets?.some(a => (a as { id: number }).id === QUESTION_ID) ?? false;
      },
      v => v === true
    );

    // publishAll: only the virtual dashboard needs batch-create (real question is not dirty)
    await act(async () => { await publishAll(); });

    // Exactly 1 batch-create call — for the virtual dashboard only
    const batchCreateCalls1 = (global.fetch as jest.Mock).mock.calls.filter(
      ([u]) => String(u).includes('/api/files/batch-create')
    );
    expect(batchCreateCalls1).toHaveLength(1);
    // Real dashboard added to Redux
    const newDash = Object.values(testStore.getState().files.files).find(f => f.type === 'dashboard' && f.id > 0);
    expect(newDash).toBeDefined();
    expect(selectDirtyFiles(testStore.getState())).toHaveLength(0);
  });

  // --------------------------------------------------------------------------
  // Manual (combined): user on /new/dashboard clicks "Create New Question",
  // fills in a name, clicks "Add" → question linked to dashboard.
  // publishAll must batch-create question first (level 1), dashboard second (level 2).
  // --------------------------------------------------------------------------

  it('manual (combined): creates new virtual question via "Create New Question" in QuestionBrowserPanel, links to virtual dashboard, publishAll saves both in topological order', async () => {
    const user = userEvent.setup();

    // Dispatch setNavigation WITHOUT virtualId → navigationListener calls
    // generateVirtualId() → returns DASH_VID (1st beforeEach mock value).
    // This mirrors the real app: Navigate tool generates the ID before pushing.
    testStore.dispatch(setNavigation({
      pathname: '/new/dashboard',
      searchParams: { folder: '/org' },
    }));
    await waitForReduxState(
      testStore,
      state => state.files.files[DASH_VID],
      v => v !== undefined
    );

    testStore.dispatch(setDashboardEditMode({ fileId: DASH_VID, editMode: true }));
    renderFilePage(<DashboardContainerV2 fileId={DASH_VID} />, testStore);

    // QuestionBrowserPanel is visible in edit mode — click "Create New Question".
    // This pushes a create-question layer onto the ViewStack (rendered inside FileLayout).
    const createBtn = await screen.findByLabelText('Create New Question');
    await user.click(createBtn);

    // Wait for CreateQuestionModalContainer to finish loading:
    //   createVirtualFile() → dispatch(setFile) → useFile(vid) returns → loading clears
    //   → real name input appears.
    const nameInput = await screen.findByLabelText('Question name');

    // Q_VID is now in Redux — createVirtualFile dispatched setFile before resolving
    expect(testStore.getState().files.files[Q_VID]).toBeDefined();

    // Typing calls handleMetadataChange → editFile({ name }) → metadataChanges.name set → dirty
    await user.type(nameInput, Q_NAME);

    // Click "Add" → handleAdd validates name (non-empty and not "New Question"),
    // calls onQuestionCreated(Q_VID) → addQuestionToDashboard(DASH_VID, Q_VID)
    const dialog = screen.getByLabelText('Create question');
    await user.click(within(dialog).getByLabelText('Add'));

    // Virtual dashboard now has virtual question in its assets
    await waitForReduxState(
      testStore,
      state => {
        const dash = state.files.files[DASH_VID];
        const merged = {
          ...(dash.content as DashboardContent),
          ...(dash.persistableChanges as Partial<DashboardContent> | undefined),
        };
        return merged.assets?.some(a => (a as { id: number }).id === Q_VID) ?? false;
      },
      v => v === true
    );

    // publishAll: question first (no deps → level 1), dashboard second (refs Q_VID → level 2)
    await act(async () => { await publishAll(); });

    // Two separate batch-create calls — question then dashboard
    const batchCreateCalls2 = (global.fetch as jest.Mock).mock.calls.filter(
      ([u]) => String(u).includes('/api/files/batch-create')
    );
    expect(batchCreateCalls2).toHaveLength(2);
    // Real files added to Redux (virtual files retain their entries but with cleared edits)
    const allFilesAfter = Object.values(testStore.getState().files.files);
    expect(allFilesAfter.some(f => f.type === 'question' && f.id > 0 && f.name === Q_NAME)).toBe(true);
    expect(allFilesAfter.some(f => f.type === 'dashboard' && f.id > 0)).toBe(true);
    expect(selectDirtyFiles(testStore.getState())).toHaveLength(0);
  });

  // --------------------------------------------------------------------------
  // Agentic: agent navigates from explore → new dashboard, creates a question,
  // links it via EditFile, publishes via PublishAll.
  // --------------------------------------------------------------------------

  it('agentic: agent navigates to new dashboard, creates question, links via EditFile, publishes', async () => {
    const mockServer = getLLMMockServer!();
    await mockServer.reset();
    await mockServer.configure([
      // Turn 1: Navigate to /new/dashboard (will trigger UserInputException confirmation)
      {
        response: {
          content: '',
          role: 'assistant',
          tool_calls: [{
            id: 'tc_nav',
            type: 'function',
            function: {
              name: 'Navigate',
              arguments: JSON.stringify({ newFileType: 'dashboard', path: '/org' }),
            },
          }],
          finish_reason: 'tool_calls',
        },
        usage: { total_tokens: 120, prompt_tokens: 90, completion_tokens: 30 },
      },
      // Turn 2: CreateFile — creates question on the new dashboard page
      {
        response: {
          content: '',
          role: 'assistant',
          tool_calls: [{
            id: 'tc_cf',
            type: 'function',
            function: {
              name: 'CreateFile',
              arguments: JSON.stringify({ file_type: 'question', name: Q_NAME }),
            },
          }],
          finish_reason: 'tool_calls',
        },
        usage: { total_tokens: 100, prompt_tokens: 75, completion_tokens: 25 },
      },
      // Turn 3: EditFile — add question to dashboard assets
      {
        response: {
          content: '',
          role: 'assistant',
          tool_calls: [{
            id: 'tc_ef',
            type: 'function',
            function: {
              name: 'EditFile',
              arguments: JSON.stringify({
                fileId: DASH_VID,
                changes: [{
                  oldMatch: '"assets":[]',
                  newMatch: `"assets":[{"type":"question","id":${Q_VID}}]`,
                }],
              }),
            },
          }],
          finish_reason: 'tool_calls',
        },
        usage: { total_tokens: 110, prompt_tokens: 80, completion_tokens: 30 },
      },
      // Turn 4: PublishAll (will trigger UserInputException publish)
      {
        response: {
          content: '',
          role: 'assistant',
          tool_calls: [{
            id: 'tc_pub',
            type: 'function',
            function: { name: 'PublishAll', arguments: '{}' },
          }],
          finish_reason: 'tool_calls',
        },
        usage: { total_tokens: 80, prompt_tokens: 60, completion_tokens: 20 },
      },
      // Turn 5: done
      {
        response: {
          content: `Done! I've created ${Q_NAME} and added it to your new dashboard.`,
          role: 'assistant',
          tool_calls: [],
          finish_reason: 'stop',
        },
        usage: { total_tokens: 70, prompt_tokens: 50, completion_tokens: 20 },
      },
    ]);

    // Start on explore page — agent must navigate from here
    testStore.dispatch(setNavigation({ pathname: '/explore', searchParams: {} }));

    // Both auto-handlers mounted: confirmation (Navigate) + publish (PublishAll)
    renderWithProviders(
      <><AutoNavigateConfirmation /><AutoPublishUserInput /></>,
      { store: testStore }
    );

    const CONV_ID = -600;
    testStore.dispatch(createConversation({
      conversationID: CONV_ID,
      agent: 'AnalystAgent',
      agent_args: { goal: `Create a dashboard with a ${Q_NAME} question` },
    }));
    testStore.dispatch(sendMessage({
      conversationID: CONV_ID,
      message: `Create a new dashboard with a question called ${Q_NAME}`,
    }));

    const realConvId = await waitForConversationFinished(
      () => testStore.getState() as RootState,
      CONV_ID
    );

    // Conversation completed without errors
    expect(selectConversation(testStore.getState() as RootState, realConvId)?.error).toBeUndefined();

    // Both virtual files published: question (level 1) then dashboard (level 2)
    const batchCreateCalls3 = (global.fetch as jest.Mock).mock.calls.filter(
      ([u]) => String(u).includes('/api/files/batch-create')
    );
    expect(batchCreateCalls3).toHaveLength(2);

    // Real files added to Redux
    const allFiles3 = Object.values(testStore.getState().files.files);
    expect(allFiles3.some(f => f.type === 'question' && f.id > 0 && f.name === Q_NAME)).toBe(true);
    expect(allFiles3.some(f => f.type === 'dashboard' && f.id > 0)).toBe(true);

    // No dirty files remain
    expect(selectDirtyFiles(testStore.getState() as any)).toHaveLength(0);
  }, 45000);
});

// ============================================================================
// publishAll retry / idempotency
// Verifies that if the server created files but the response never reached the
// client (network drop, 500), retrying publishAll recovers correctly via editId
// idempotency — no duplicates, no stuck virtual files.
// ============================================================================

describe('publishAll retry idempotency', () => {
  setupTestDb(getTestDbPath('dashboard_ui'));

  let testStore: ReturnType<typeof storeModule.makeStore>;
  let getStoreSpy: jest.SpyInstance;

  const Q_VID   = -77;
  const DASH_VID = -78;
  const Q_RETRY_NAME = 'Retry Question';
  const DASH_RETRY_NAME = 'Retry Dashboard';

  beforeEach(() => {
    testStore = storeModule.makeStore();
    getStoreSpy = jest.spyOn(storeModule, 'getStore').mockReturnValue(testStore);
  });

  afterEach(() => {
    global.fetch = realFetch;
    getStoreSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('retry after ghost create: server already wrote files but client got 500 — retry recovers via editId, no duplicates', async () => {
    // Seed virtual question + virtual dashboard (question → dashboard dependency)
    testStore.dispatch(setFile({
      file: {
        id: Q_VID, name: Q_RETRY_NAME, type: 'question' as const,
        path: `/org/${Q_RETRY_NAME}`,
        content: { query: 'SELECT retry FROM data', vizSettings: { type: 'table' as const }, connection_name: '' },
        created_at: '', updated_at: '', references: [] as number[],
        version: 1, last_edit_id: null, company_id: 1,
      },
      references: [],
    }));
    testStore.dispatch(setEdit({
      fileId: Q_VID,
      edits: { query: 'SELECT retry FROM data', vizSettings: { type: 'table' as const }, connection_name: 'default' },
    }));
    testStore.dispatch(setFile({
      file: {
        id: DASH_VID, name: DASH_RETRY_NAME, type: 'dashboard' as const,
        path: `/org/${DASH_RETRY_NAME}`,
        content: { assets: [], layout: null },
        created_at: '', updated_at: '', references: [] as number[],
        version: 1, last_edit_id: null, company_id: 1,
      },
      references: [],
    }));
    testStore.dispatch(addQuestionToDashboard({ dashboardId: DASH_VID, questionId: Q_VID }));

    // ── Attempt 1: server writes to DB but client gets 500 ──────────────────
    // We call the real batchCreateHandler so the files ARE inserted into the DB,
    // then return a fake 500 response so publishAll thinks the attempt failed.
    let attempt = 0;
    const realApiFetch = makeRealApiFetch();
    global.fetch = jest.fn(async (url: string | Request | URL, init?: RequestInit): Promise<Response> => {
      if (String(url).includes('/api/files/batch-create')) {
        attempt++;
        if (attempt === 1) {
          // Fire the real handler (inserts into DB), then discard the response
          await realApiFetch(url, init);
          return { ok: false, status: 500, json: async () => ({ error: { message: 'Network error' } }) } as Response;
        }
      }
      return realApiFetch(url, init);
    });

    await expect(publishAll()).rejects.toThrow('Network error');

    // Virtual files still dirty — client never got the success response
    expect(selectDirtyFiles(testStore.getState())).toHaveLength(2);

    // ── Attempt 2 (retry): server finds files via editId, returns them ───────
    // publishAll sends the same editId (deterministic hash of virtualId + content).
    // createFile() sees the editId already in last_edit_id → returns existing file.
    await act(async () => { await publishAll(); });

    // Retry succeeded: both files now have real (positive) IDs in Redux
    const allFiles = Object.values(testStore.getState().files.files);
    const savedQ    = allFiles.find(f => f.type === 'question'  && f.id > 0 && f.name === Q_RETRY_NAME);
    const savedDash = allFiles.find(f => f.type === 'dashboard' && f.id > 0 && f.name === DASH_RETRY_NAME);
    expect(savedQ).toBeDefined();
    expect(savedDash).toBeDefined();

    // No dirty files remain
    expect(selectDirtyFiles(testStore.getState())).toHaveLength(0);

    // No duplicates: batch-create was called twice (attempt 1 + retry level-1 question,
    // then retry level-2 dashboard) but each editId resolves to the SAME DB row —
    // verify by checking total batch-create calls on the retry path.
    const batchCreateCalls = (global.fetch as jest.Mock).mock.calls
      .filter(([u]) => String(u).includes('/api/files/batch-create'));
    // Attempt 1: 1 call (question only, level 1 — then 500 before dashboard)
    // Attempt 2: 2 calls (question level 1 via editId, dashboard level 2 fresh)
    expect(batchCreateCalls).toHaveLength(3);
  });
});

// ============================================================================
// publishAll error handling
// (Gap 1: API failures leave files dirty; circular dep throws without API calls)
// ============================================================================

describe('publishAll error handling', () => {
  setupTestDb(getTestDbPath('dashboard_ui'), { customInit: insertDashboardAndQuestion });

  let testStore: ReturnType<typeof storeModule.makeStore>;
  let getStoreSpy: jest.SpyInstance;

  beforeEach(() => {
    testStore = storeModule.makeStore();
    getStoreSpy = jest.spyOn(storeModule, 'getStore').mockReturnValue(testStore);
  });

  afterEach(() => {
    global.fetch = realFetch;
    getStoreSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('batch-create failure: throws and leaves virtual files dirty', async () => {
    const Q_VID = -1;
    testStore.dispatch(setFile({
      file: {
        id: Q_VID, name: 'Q', type: 'question' as const,
        path: '/org/Q',
        content: { query: '', vizSettings: { type: 'table' as const }, connection_name: '' },
        created_at: '', updated_at: '', references: [] as number[],
        version: 1, last_edit_id: null, company_id: 1,
      },
      references: [],
    }));
    testStore.dispatch(setEdit({
      fileId: Q_VID,
      edits: { query: 'SELECT 1', vizSettings: { type: 'table' as const }, connection_name: 'default' },
    }));

    global.fetch = jest.fn(async (url: string | Request | URL) => {
      if (String(url).includes('/api/files/batch-create'))
        return { ok: false, status: 500, json: async () => ({ error: { message: 'DB unavailable' } }) } as Response;
      throw new Error(`Unexpected fetch: ${String(url)}`);
    });

    await expect(publishAll()).rejects.toThrow('DB unavailable');

    // Virtual file is still dirty — Redux unchanged
    const dirty = selectDirtyFiles(testStore.getState());
    expect(dirty).toHaveLength(1);
    expect(dirty[0].id).toBe(Q_VID);
  });

  it('batch-save failure: throws and leaves real file dirty', async () => {
    testStore.dispatch(setFile({ file: makeDashboardDbFile(), references: [] }));
    testStore.dispatch(addQuestionToDashboard({ dashboardId: DASHBOARD_ID, questionId: QUESTION_ID }));

    global.fetch = jest.fn(async (url: string | Request | URL) => {
      if (String(url).includes('/api/files/batch-save'))
        return { ok: false, status: 500, json: async () => ({ error: { message: 'Save failed' } }) } as Response;
      throw new Error(`Unexpected fetch: ${String(url)}`);
    });

    await expect(publishAll()).rejects.toThrow('Save failed');

    // Real file is still dirty
    const dirty = selectDirtyFiles(testStore.getState());
    expect(dirty).toHaveLength(1);
    expect(dirty[0].id).toBe(DASHBOARD_ID);
  });

  it('circular dependency: throws before any API call', async () => {
    const A = -20;
    const B = -21;
    // Two virtual dashboards that reference each other → circular
    testStore.dispatch(setFile({
      file: {
        id: A, name: 'DashA', type: 'dashboard' as const, path: '/org/DashA',
        content: { assets: [{ type: 'question' as const, id: B }], layout: null },
        created_at: '', updated_at: '', references: [] as number[],
        version: 1, last_edit_id: null, company_id: 1,
      },
      references: [],
    }));
    testStore.dispatch(setFile({
      file: {
        id: B, name: 'DashB', type: 'dashboard' as const, path: '/org/DashB',
        content: { assets: [{ type: 'question' as const, id: A }], layout: null },
        created_at: '', updated_at: '', references: [] as number[],
        version: 1, last_edit_id: null, company_id: 1,
      },
      references: [],
    }));
    testStore.dispatch(setEdit({ fileId: A, edits: { description: 'dirty A' } }));
    testStore.dispatch(setEdit({ fileId: B, edits: { description: 'dirty B' } }));

    // No fetch call should happen — circular dep is detected before the first API call
    global.fetch = jest.fn(() => { throw new Error('should not be called'); });

    await expect(publishAll()).rejects.toThrow('Circular dependency detected');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(selectDirtyFiles(testStore.getState())).toHaveLength(2);
  });
});

// ============================================================================
// Mixed real + virtual publishAll
// (Gap 3: existing file dirty + new virtual file dirty simultaneously)
// ============================================================================

describe('Mixed real + virtual publishAll', () => {
  setupTestDb(getTestDbPath('dashboard_ui'), { customInit: insertDashboardAndQuestion });

  let testStore: ReturnType<typeof storeModule.makeStore>;
  let getStoreSpy: jest.SpyInstance;

  beforeEach(() => {
    testStore = storeModule.makeStore();
    getStoreSpy = jest.spyOn(storeModule, 'getStore').mockReturnValue(testStore);
    global.fetch = makeRealApiFetch();
  });

  afterEach(() => {
    global.fetch = realFetch;
    getStoreSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('batch-creates virtual question then batch-saves existing dashboard with resolved real ID', async () => {
    const Q_VID = -50;

    // Virtual question (new, not yet in DB)
    testStore.dispatch(setFile({
      file: {
        id: Q_VID, name: 'Mix Query', type: 'question' as const,
        path: '/org/Mix Query',
        content: { query: '', vizSettings: { type: 'table' as const }, connection_name: '' },
        created_at: '', updated_at: '', references: [] as number[],
        version: 1, last_edit_id: null, company_id: 1,
      },
      references: [],
    }));
    testStore.dispatch(setEdit({
      fileId: Q_VID,
      edits: { query: 'SELECT mix FROM data', vizSettings: { type: 'table' as const }, connection_name: 'default' },
    }));

    // Real dashboard (id=1, already in DB) referencing the virtual question
    testStore.dispatch(setFile({ file: makeDashboardDbFile(), references: [] }));
    testStore.dispatch(addQuestionToDashboard({ dashboardId: DASHBOARD_ID, questionId: Q_VID }));

    await act(async () => { await publishAll(); });

    const fetchMock = global.fetch as jest.Mock;
    const batchCreateCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes('/api/files/batch-create'));
    const batchSaveCalls   = fetchMock.mock.calls.filter(([u]) => String(u).includes('/api/files/batch-save'));

    // Virtual question → batch-create; real dashboard → batch-save
    expect(batchCreateCalls).toHaveLength(1);
    expect(batchSaveCalls).toHaveLength(1);

    // Dashboard content now carries the real (positive) question ID — Q_VID was replaced before save
    const savedContent = testStore.getState().files.files[DASHBOARD_ID].content as DashboardContent;
    expect(savedContent.assets).toHaveLength(1);
    expect(savedContent.assets!.every(a => (a as { id: number }).id > 0)).toBe(true);

    expect(selectDirtyFiles(testStore.getState())).toHaveLength(0);
  });
});

// ============================================================================
// Multiple questions in dashboard
// (Gap 5: add two questions; remove one via UI; verify saved content)
// ============================================================================

describe('Multiple questions in dashboard', () => {
  setupTestDb(getTestDbPath('dashboard_ui'), { customInit: insertDashboardAndTwoQuestions });

  let testStore: ReturnType<typeof storeModule.makeStore>;
  let getStoreSpy: jest.SpyInstance;

  beforeEach(() => {
    testStore = storeModule.makeStore();
    getStoreSpy = jest.spyOn(storeModule, 'getStore').mockReturnValue(testStore);
    global.fetch = makeRealApiFetch();
  });

  afterEach(() => {
    global.fetch = realFetch;
    getStoreSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('adds two questions and saves both in dashboard content', async () => {
    testStore.dispatch(setFile({ file: makeDashboardDbFile(), references: [] }));
    testStore.dispatch(setFile({ file: makeQuestionDbFile(), references: [] }));
    testStore.dispatch(setFile({ file: makeQuestionDbFile2(), references: [] }));

    testStore.dispatch(addQuestionToDashboard({ dashboardId: DASHBOARD_ID, questionId: QUESTION_ID }));
    testStore.dispatch(addQuestionToDashboard({ dashboardId: DASHBOARD_ID, questionId: QUESTION_ID_2 }));

    await act(async () => { await publishAll(); });

    const content = testStore.getState().files.files[DASHBOARD_ID].content as DashboardContent;
    const savedIds = content.assets?.map(a => (a as { id: number }).id) ?? [];
    expect(savedIds).toContain(QUESTION_ID);
    expect(savedIds).toContain(QUESTION_ID_2);
    expect(savedIds).toHaveLength(2);
    expect(selectDirtyFiles(testStore.getState())).toHaveLength(0);
  });

  it('removes a question via UI remove button and saves without it', async () => {
    const user = userEvent.setup();

    // Start with a dashboard that already has both questions in content + layout
    testStore.dispatch(setFile({
      file: {
        ...makeDashboardDbFile(),
        content: {
          assets: [
            { type: 'question' as const, id: QUESTION_ID },
            { type: 'question' as const, id: QUESTION_ID_2 },
          ],
          layout: {
            columns: 12,
            items: [
              { id: QUESTION_ID,   x: 0, y: 0, w: 6, h: 4 },
              { id: QUESTION_ID_2, x: 6, y: 0, w: 6, h: 4 },
            ],
          },
        },
        references: [QUESTION_ID, QUESTION_ID_2],
      },
      references: [],
    }));
    testStore.dispatch(setFile({ file: makeQuestionDbFile(), references: [] }));
    testStore.dispatch(setFile({ file: makeQuestionDbFile2(), references: [] }));
    testStore.dispatch(setDashboardEditMode({ fileId: DASHBOARD_ID, editMode: true }));

    renderWithProviders(
      <>
        <FileHeader fileId={DASHBOARD_ID} fileType="dashboard" />
        <DashboardContainerV2 fileId={DASHBOARD_ID} />
      </>,
      { store: testStore }
    );

    // Two "Remove from dashboard" buttons — one per tile.  Click the first.
    const removeBtns = await screen.findAllByLabelText('Remove from dashboard');
    expect(removeBtns).toHaveLength(2);
    await user.click(removeBtns[0]);

    // One question removed → merged assets has exactly 1 entry
    await waitForReduxState(
      testStore,
      state => {
        const dash = state.files.files[DASHBOARD_ID];
        const merged = {
          ...(dash.content as DashboardContent),
          ...(dash.persistableChanges as Partial<DashboardContent> | undefined),
        } as DashboardContent;
        return merged.assets?.length ?? 0;
      },
      len => len === 1
    );

    // Publish and verify DB round-trip via Redux content
    await user.click(screen.getByLabelText('Save'));
    await waitForReduxState(
      testStore,
      state => Object.keys(state.files.files[DASHBOARD_ID].persistableChanges ?? {}),
      keys => keys.length === 0
    );

    const savedContent = testStore.getState().files.files[DASHBOARD_ID].content as DashboardContent;
    expect(savedContent.assets).toHaveLength(1);
  });
});

// ============================================================================
// Dashboard parameter merging
// (Gap 6: shared params from multiple questions collapse to one input; parameterValues persisted)
// ============================================================================

describe('Dashboard parameter merging', () => {
  setupTestDb(getTestDbPath('dashboard_ui'), { customInit: insertQuestionsWithSharedParams });

  let testStore: ReturnType<typeof storeModule.makeStore>;
  let getStoreSpy: jest.SpyInstance;

  // Files for these tests: dashboard + two questions with overlapping :start_date param
  const paramDash = () => ({
    id: DASHBOARD_ID, name: 'Param Dashboard', type: 'dashboard' as const,
    path: '/org/Param Dashboard',
    content: {
      assets: [
        { type: 'question' as const, id: QUESTION_ID },
        { type: 'question' as const, id: QUESTION_ID_2 },
      ],
      layout: null,
    },
    created_at: '2025-01-01T00:00:00Z', updated_at: new Date().toISOString(),
    references: [QUESTION_ID, QUESTION_ID_2] as number[],
    version: 1, last_edit_id: null, company_id: 1,
  });
  const paramQ1 = () => ({
    id: QUESTION_ID, name: 'Orders Q', type: 'question' as const,
    path: '/org/Orders Q',
    content: {
      query: 'SELECT * FROM orders WHERE order_date >= :start_date',
      parameters: [],
      vizSettings: { type: 'table' as const },
      connection_name: '',
    },
    created_at: '2025-01-01T00:00:00Z', updated_at: new Date().toISOString(),
    references: [] as number[], version: 1, last_edit_id: null, company_id: 1,
  });
  const paramQ2 = () => ({
    id: QUESTION_ID_2, name: 'Revenue Q', type: 'question' as const,
    path: '/org/Revenue Q',
    content: {
      query: 'SELECT * FROM revenue WHERE order_date >= :start_date AND region = :region',
      parameters: [],
      vizSettings: { type: 'table' as const },
      connection_name: '',
    },
    created_at: '2025-01-01T00:00:00Z', updated_at: new Date().toISOString(),
    references: [] as number[], version: 1, last_edit_id: null, company_id: 1,
  });

  beforeEach(() => {
    testStore = storeModule.makeStore();
    getStoreSpy = jest.spyOn(storeModule, 'getStore').mockReturnValue(testStore);
    testStore.dispatch(setFile({ file: paramDash(), references: [] }));
    testStore.dispatch(setFile({ file: paramQ1(), references: [] }));
    testStore.dispatch(setFile({ file: paramQ2(), references: [] }));
    global.fetch = makeRealApiFetch();
  });

  afterEach(() => {
    global.fetch = realFetch;
    getStoreSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('two questions sharing :start_date render exactly one merged date parameter input', async () => {
    renderWithProviders(<DashboardContainerV2 fileId={DASHBOARD_ID} />, { store: testStore });

    // inferParameterType('start_date') → 'date' → ParameterInput renders input with aria-label="start_date"
    // :start_date appears in BOTH queries but merges to a single input, not two.
    // inferParameterType('region') → 'text' → simple input with aria-label="region"
    await waitFor(() => {
      expect(screen.getAllByLabelText('start_date')).toHaveLength(1);
      expect(screen.getAllByLabelText('region')).toHaveLength(1);
    });
  });

  it('parameterValues submitted via setEdit persist in dashboard content after publishAll', async () => {
    // Dispatch the same Redux edit that DashboardView.onSubmit triggers
    testStore.dispatch(setEdit({
      fileId: DASHBOARD_ID,
      edits: { parameterValues: { start_date: '2024-01-01', region: 'North' } },
    }));

    // persistableChanges carries the new values
    const dirty = testStore.getState().files.files[DASHBOARD_ID];
    expect((dirty.persistableChanges as any)?.parameterValues).toMatchObject({
      start_date: '2024-01-01',
      region: 'North',
    });

    // publishAll → batch-save → DB stores → setFile(DB_response) updates Redux content
    await act(async () => { await publishAll(); });

    const savedContent = testStore.getState().files.files[DASHBOARD_ID].content as DashboardContent;
    expect(savedContent.parameterValues).toMatchObject({ start_date: '2024-01-01', region: 'North' });
    expect(selectDirtyFiles(testStore.getState())).toHaveLength(0);
  });
});
