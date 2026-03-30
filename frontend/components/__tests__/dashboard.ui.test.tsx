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
jest.mock('@/lib/auth/auth-helpers', () => ({
  getEffectiveUser: jest.fn().mockResolvedValue({
    userId: 1,
    email: 'test@example.com',
    name: 'Test User',
    role: 'admin',
    companyId: 1,
    companyName: 'test-company',
    home_folder: '/org',
    mode: 'org',
  }),
  isAdmin: jest.fn().mockReturnValue(true),
}));

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
import FileHeader from '@/components/FileHeader';
import DashboardContainerV2 from '@/components/containers/DashboardContainerV2';

import { withPythonBackend } from '@/test/harness/python-backend';
import { setupTestDb } from '@/test/harness/test-db';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { POST as chatPostHandler } from '@/app/api/chat/route';

// Capture the real Node.js fetch before any test can override global.fetch.
// Used by the agentic fetch mock to route Python backend calls to the real server.
const realFetch = global.fetch;

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const DASHBOARD_ID = 1;
const QUESTION_ID = 2;
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
    content: { query: 'SELECT 1', vizSettings: { type: 'table' as const }, database_name: '' },
    created_at: '2025-01-01T00:00:00Z',
    updated_at: new Date().toISOString(),
    references: [] as number[],
    version: 1,
    last_edit_id: null,
    company_id: 1,
  };
}

function makeUpdatedDashboardDbFile() {
  return {
    ...makeDashboardDbFile(),
    content: { assets: [{ type: 'question', id: QUESTION_ID }], layout: null },
    updated_at: new Date().toISOString(),
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

/** Wait for a conversation to reach FINISHED, tracking forks to real IDs. */
async function waitForConversationFinished(
  getState: () => RootState,
  virtualConvId: number
): Promise<number> {
  let realConvId = virtualConvId;
  await waitFor(
    () => {
      const temp = selectConversation(getState(), virtualConvId);
      if (temp?.forkedConversationID) {
        realConvId = temp.forkedConversationID;
      }
      const conv = selectConversation(getState(), realConvId);
      expect(conv?.executionState).toBe('FINISHED');
    },
    { timeout: 40000 }
  );
  return realConvId;
}

/**
 * Standard fetch mock for tests that render the dashboard UI:
 *   GET  /api/files?type=question  → QuestionBrowserPanel list
 *   PATCH /api/files/:id           → save dashboard
 */
function mockDashboardFetch() {
  global.fetch = jest.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method?.toUpperCase() ?? 'GET';

    if (method === 'GET' && url.includes('/api/files') && url.includes('type=question')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ id: QUESTION_ID, name: QUESTION_NAME, type: 'question', path: `/org/${QUESTION_NAME}` }],
        }),
      };
    }

    if (method === 'PATCH' && url.includes(`/api/files/${DASHBOARD_ID}`)) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: makeUpdatedDashboardDbFile() }),
      };
    }

    return { ok: true, status: 200, json: async () => ({ data: null }) };
  });
}

// ============================================================================
// Scenario 1: Add question to existing dashboard and save
// ============================================================================

describe('Add question to existing dashboard and save', () => {
  let testStore: ReturnType<typeof storeModule.makeStore>;
  let getStoreSpy: jest.SpyInstance;

  beforeEach(() => {
    testStore = storeModule.makeStore();
    getStoreSpy = jest.spyOn(storeModule, 'getStore').mockReturnValue(testStore);
    testStore.dispatch(setFile({ file: makeDashboardDbFile(), references: [] }));
    testStore.dispatch(setFile({ file: makeQuestionDbFile(), references: [] }));
    testStore.dispatch(setDashboardEditMode({ fileId: DASHBOARD_ID, editMode: true }));
    mockDashboardFetch();
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
    const questionCard = await screen.findByRole('article', { name: QUESTION_NAME }, { timeout: 5000 });
    const addButton = within(questionCard).getByRole('button', { name: 'Add to dashboard' });
    await user.click(addButton);

    // Redux: dashboard is now dirty with the new asset
    await waitFor(() => {
      const fileState = testStore.getState().files.files[DASHBOARD_ID];
      const merged = {
        ...(fileState.content as DashboardContent),
        ...(fileState.persistableChanges as Partial<DashboardContent> | undefined),
      };
      expect(merged.assets?.some(a => (a as { id: number }).id === QUESTION_ID)).toBe(true);
    }, { timeout: 3000 });

    // "Publish changes" button is now enabled
    const publishBtn = screen.getByRole('button', { name: 'Publish changes' });
    expect(publishBtn).not.toBeDisabled();
    await user.click(publishBtn);

    // After save: clearEdits fires → persistableChanges is empty
    await waitFor(() => {
      const fileState = testStore.getState().files.files[DASHBOARD_ID];
      expect(Object.keys(fileState.persistableChanges ?? {})).toHaveLength(0);
    }, { timeout: 5000 });

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
  let testStore: ReturnType<typeof storeModule.makeStore>;
  let getStoreSpy: jest.SpyInstance;

  beforeEach(() => {
    testStore = storeModule.makeStore();
    getStoreSpy = jest.spyOn(storeModule, 'getStore').mockReturnValue(testStore);
    // No pre-seeded files — each test creates its own virtual files
  });

  afterEach(() => {
    global.fetch = realFetch;
    getStoreSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('manual: publishAll saves virtual question first, then virtual dashboard with resolved references', async () => {
    const Q_VID = -1;
    const DASH_VID = -2;
    const REAL_Q_ID = 10;
    const REAL_DASH_ID = 11;
    const Q_NAME = 'Revenue Query';
    const DASH_NAME = 'New Dashboard';

    // Seed virtual files (negative IDs) into Redux
    testStore.dispatch(setFile({
      file: {
        id: Q_VID,
        name: Q_NAME,
        type: 'question' as const,
        path: `/org/${Q_NAME}`,
        content: { query: '', vizSettings: { type: 'table' as const }, database_name: '' },
        created_at: '',
        updated_at: '',
        references: [] as number[],
        version: 1,
        last_edit_id: null,
        company_id: 1,
      },
      references: [],
    }));
    testStore.dispatch(setFile({
      file: {
        id: DASH_VID,
        name: DASH_NAME,
        type: 'dashboard' as const,
        path: `/org/${DASH_NAME}`,
        content: { assets: [], layout: null },
        created_at: '',
        updated_at: '',
        references: [] as number[],
        version: 1,
        last_edit_id: null,
        company_id: 1,
      },
      references: [],
    }));

    // Make the question dirty; link it to the dashboard
    testStore.dispatch(setEdit({
      fileId: Q_VID,
      edits: { query: 'SELECT revenue FROM sales', vizSettings: { type: 'table' as const }, database_name: 'default' },
    }));
    testStore.dispatch(addQuestionToDashboard({ dashboardId: DASH_VID, questionId: Q_VID }));

    // Track batch-create calls to verify save order
    const batchCreateBodies: Array<{ files: Array<{ virtualId: number; type: string; content: unknown }> }> = [];

    global.fetch = jest.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method?.toUpperCase() ?? 'GET';

      if (method === 'POST' && url.includes('/api/files/batch-create')) {
        const body = JSON.parse(init?.body as string) as typeof batchCreateBodies[number];
        batchCreateBodies.push(body);

        if (batchCreateBodies.length === 1) {
          // First call: question (no virtual deps)
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [{
                virtualId: Q_VID,
                file: {
                  id: REAL_Q_ID, name: Q_NAME, type: 'question',
                  path: `/org/${Q_NAME}`,
                  content: { query: 'SELECT revenue FROM sales', vizSettings: { type: 'table' }, database_name: 'default' },
                  created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
                  references: [], version: 1, last_edit_id: null, company_id: 1,
                },
              }],
            }),
          };
        }

        // Second call: dashboard (after replaceVirtualIds resolves Q_VID → REAL_Q_ID)
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [{
              virtualId: DASH_VID,
              file: {
                id: REAL_DASH_ID, name: DASH_NAME, type: 'dashboard',
                path: `/org/${DASH_NAME}`,
                content: { assets: [{ type: 'question', id: REAL_Q_ID }], layout: { columns: 12, items: [] } },
                created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
                references: [REAL_Q_ID], version: 1, last_edit_id: null, company_id: 1,
              },
            }],
          }),
        };
      }

      return { ok: true, status: 200, json: async () => ({ data: null }) };
    });

    await act(async () => { await publishAll(); });

    // Two separate batch-create calls — one per topological level
    expect(batchCreateBodies).toHaveLength(2);

    // Call 1: question only (no unresolved virtual refs)
    const firstFiles = batchCreateBodies[0].files;
    expect(firstFiles).toHaveLength(1);
    expect(firstFiles[0].virtualId).toBe(Q_VID);
    expect(firstFiles[0].type).toBe('question');

    // Call 2: dashboard whose assets already carry the REAL question ID
    const secondFiles = batchCreateBodies[1].files;
    expect(secondFiles).toHaveLength(1);
    expect(secondFiles[0].virtualId).toBe(DASH_VID);
    expect(secondFiles[0].type).toBe('dashboard');
    const savedDashContent = secondFiles[0].content as DashboardContent;
    expect(savedDashContent.assets?.some(a => (a as { id: number }).id === REAL_Q_ID)).toBe(true);

    // No dirty files remain after publishAll
    expect(selectDirtyFiles(testStore.getState())).toHaveLength(0);
  });
});

// ============================================================================
// Scenario 3: Edit/cancel mode toggle  (manual only)
// ============================================================================

describe('Dashboard edit/cancel mode toggle', () => {
  let testStore: ReturnType<typeof storeModule.makeStore>;
  let getStoreSpy: jest.SpyInstance;

  beforeEach(() => {
    testStore = storeModule.makeStore();
    getStoreSpy = jest.spyOn(storeModule, 'getStore').mockReturnValue(testStore);
    testStore.dispatch(setFile({ file: makeDashboardDbFile(), references: [] }));
    testStore.dispatch(setFile({ file: makeQuestionDbFile(), references: [] }));
    mockDashboardFetch();
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

    expect(await screen.findByRole('region', { name: 'Dashboard' })).toBeInTheDocument();

    // Enter edit mode
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(testStore.getState().ui.dashboardEditMode?.[DASHBOARD_ID]).toBe(true);

    // Exit edit mode
    await user.click(screen.getByRole('button', { name: 'Cancel editing' }));
    expect(testStore.getState().ui.dashboardEditMode?.[DASHBOARD_ID]).toBe(false);
  });
});

// ============================================================================
// Dashboard agentic scenarios
// (co-located with the manual scenarios above — same outcomes, agent-driven)
// ============================================================================

describe('Dashboard agentic scenarios', () => {
  const { getPythonPort, getLLMMockPort, getLLMMockServer } = withPythonBackend({ withLLMMock: true });
  setupTestDb(getTestDbPath('dashboard_ui'));

  // Real IDs returned by batch-create mock for Scenario 2
  const REAL_Q_ID = 30;
  const REAL_DASH_ID = 31;
  // Virtual IDs pre-seeded for Scenario 2
  const Q_VID = -100;
  const DASH_VID = -101;
  const AGENTIC_Q_NAME = 'Revenue Query';
  const AGENTIC_DASH_NAME = 'Agentic Dashboard';

  let testStore: ReturnType<typeof storeModule.makeStore>;
  let getStoreSpy: jest.SpyInstance;
  let batchCreateCallCount: number;

  beforeEach(() => {
    batchCreateCallCount = 0;
    testStore = storeModule.makeStore();
    getStoreSpy = jest.spyOn(storeModule, 'getStore').mockReturnValue(testStore);

    const pythonPort = getPythonPort();

    // Custom fetch router: no spy — set directly so jest.restoreAllMocks() in
    // manual-test afterEach blocks does not clobber it.
    global.fetch = jest.fn(async (url: string | Request | URL, init?: RequestInit) => {
      const urlStr = url.toString();
      const method = (init?.method ?? 'GET').toUpperCase();

      // /api/chat → route to Next.js chatPostHandler (relative or absolute)
      if (urlStr.startsWith('/api/chat') || urlStr.includes('localhost:3000/api/chat')) {
        const req = new NextRequest('http://localhost:3000/api/chat', {
          method: 'POST',
          body: init?.body as string,
          headers: init?.headers as HeadersInit,
        });
        const resp = await chatPostHandler(req);
        const data = await resp.json();
        return { ok: resp.status < 400, status: resp.status, json: async () => data } as Response;
      }

      // Python backend → pass through to real server (redirect default 8001 → test port)
      if (urlStr.includes(`localhost:${pythonPort}`) || urlStr.includes('localhost:8001')) {
        const redirected = urlStr.replace('localhost:8001', `localhost:${pythonPort}`);
        return realFetch(redirected, init);
      }

      // LLM mock server (configure/reset/calls) → pass through
      const llmPort = getLLMMockPort?.();
      if (llmPort && urlStr.includes(`localhost:${llmPort}`)) {
        return realFetch(urlStr, init);
      }

      // POST /api/files/template → stub for createVirtualFile()
      if (method === 'POST' && urlStr.includes('/api/files/template')) {
        const body = JSON.parse(init!.body as string) as { type: string };
        const content = body.type === 'question'
          ? { query: '', vizSettings: { type: 'table' }, database_name: '', parameters: [] }
          : { assets: [], layout: { columns: 12, items: [] } };
        return {
          ok: true, status: 200,
          json: async () => ({ data: { content, fileName: '', metadata: { availableDatabases: [] } } }),
        } as Response;
      }

      // POST /api/files/batch-save → Scenario 1 agentic (real dashboard published after EditFile)
      if (method === 'POST' && urlStr.includes('/api/files/batch-save')) {
        return {
          ok: true, status: 200,
          json: async () => ({
            data: [{
              id: DASHBOARD_ID,
              name: 'Test Dashboard',
              type: 'dashboard',
              path: '/org/Test Dashboard',
              content: { assets: [{ type: 'question', id: QUESTION_ID }], layout: null },
              created_at: '2025-01-01T00:00:00Z',
              updated_at: new Date().toISOString(),
              references: [QUESTION_ID],
              version: 2,
              last_edit_id: null,
              company_id: 1,
            }],
          }),
        } as Response;
      }

      // POST /api/files/batch-create → Scenario 2 agentic (virtual files saved in topo order)
      if (method === 'POST' && urlStr.includes('/api/files/batch-create')) {
        batchCreateCallCount++;
        const body = JSON.parse(init!.body as string) as {
          files: Array<{ virtualId: number; type: string }>;
        };
        if (batchCreateCallCount === 1) {
          // Level 1: question (no virtual deps)
          return {
            ok: true, status: 200,
            json: async () => ({
              data: [{
                virtualId: body.files[0].virtualId,
                file: {
                  id: REAL_Q_ID, name: AGENTIC_Q_NAME, type: 'question',
                  path: `/org/${AGENTIC_Q_NAME}`,
                  content: { query: 'SELECT 1', vizSettings: { type: 'table' }, database_name: 'default' },
                  created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
                  references: [], version: 1, last_edit_id: null, company_id: 1,
                },
              }],
            }),
          } as Response;
        }
        // Level 2: dashboard (virtual question ID already resolved by replaceVirtualIds)
        return {
          ok: true, status: 200,
          json: async () => ({
            data: [{
              virtualId: body.files[0].virtualId,
              file: {
                id: REAL_DASH_ID, name: AGENTIC_DASH_NAME, type: 'dashboard',
                path: `/org/${AGENTIC_DASH_NAME}`,
                content: { assets: [{ type: 'question', id: REAL_Q_ID }], layout: null },
                created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
                references: [REAL_Q_ID], version: 1, last_edit_id: null, company_id: 1,
              },
            }],
          }),
        } as Response;
      }

      // Health check
      if (urlStr.includes('/health')) {
        return { ok: true, status: 200, json: async () => ({ status: 'healthy' }) } as Response;
      }

      throw new Error(`[Dashboard agentic] Unmocked fetch call to ${urlStr}`);
    });
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
        content: { query: '', vizSettings: { type: 'table' as const }, database_name: '' },
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
      edits: { query: 'SELECT 1', vizSettings: { type: 'table' as const }, database_name: 'default' },
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
    expect(batchCreateCallCount).toBe(2);

    // Virtual files replaced with real files in Redux
    const filesState = testStore.getState().files.files;
    expect(filesState[REAL_Q_ID]).toBeDefined();
    expect(filesState[REAL_DASH_ID]).toBeDefined();

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
  // Reuse the same DB as the other agentic describe — db-config mock always
  // points to test_dashboard_ui.db regardless of which setupTestDb path is passed.
  setupTestDb(getTestDbPath('dashboard_ui'));

  // Virtual IDs — deterministic because generateVirtualId is mocked:
  //   Navigate tool (after bug fix) → first generateVirtualId() call  → DASH_VID
  //   CreateFile tool               → second generateVirtualId() call → Q_VID
  const DASH_VID    = -1_000_000_091;
  const Q_VID       = -1_000_000_092;
  const REAL_Q_ID   = 50;
  const REAL_DASH_ID = 51;
  const Q_NAME = 'Revenue Query';
  const DASH_NAME = 'My New Dashboard';

  let testStore: ReturnType<typeof storeModule.makeStore>;
  let getStoreSpy: jest.SpyInstance;
  let batchCreateCallCount: number;

  beforeEach(() => {
    batchCreateCallCount = 0;
    testStore = storeModule.makeStore();
    getStoreSpy = jest.spyOn(storeModule, 'getStore').mockReturnValue(testStore);

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
    global.fetch = jest.fn(async (url: string | Request | URL, init?: RequestInit) => {
      const urlStr = url.toString();
      const method = (init?.method ?? 'GET').toUpperCase();

      if (urlStr.startsWith('/api/chat') || urlStr.includes('localhost:3000/api/chat')) {
        const req = new NextRequest('http://localhost:3000/api/chat', {
          method: 'POST',
          body: init?.body as string,
          headers: init?.headers as HeadersInit,
        });
        const resp = await chatPostHandler(req);
        const data = await resp.json();
        return { ok: resp.status < 400, status: resp.status, json: async () => data } as Response;
      }

      if (urlStr.includes(`localhost:${pythonPort}`) || urlStr.includes('localhost:8001')) {
        return realFetch(urlStr.replace('localhost:8001', `localhost:${pythonPort}`), init);
      }

      const llmPort = getLLMMockPort?.();
      if (llmPort && urlStr.includes(`localhost:${llmPort}`)) {
        return realFetch(urlStr, init);
      }

      if (method === 'POST' && urlStr.includes('/api/files/template')) {
        const body = JSON.parse(init!.body as string) as { type: string };
        const content = body.type === 'question'
          ? { query: '', vizSettings: { type: 'table' }, database_name: '', parameters: [] }
          : { assets: [], layout: { columns: 12, items: [] } };
        return {
          ok: true, status: 200,
          json: async () => ({ data: { content, fileName: '', metadata: { availableDatabases: [] } } }),
        } as Response;
      }

      // GET /api/files?type=question — QuestionBrowserPanel listing
      if (method === 'GET' && urlStr.includes('/api/files') && urlStr.includes('type=question')) {
        return {
          ok: true, status: 200,
          json: async () => ({
            data: [{ id: QUESTION_ID, name: QUESTION_NAME, type: 'question', path: `/org/${QUESTION_NAME}` }],
          }),
        } as Response;
      }

      // Catch-all for non-critical GET requests (configs, etc.)
      if (method === 'GET') {
        return { ok: true, status: 200, json: async () => ({ data: null }) } as Response;
      }

      if (method === 'POST' && urlStr.includes('/api/files/batch-create')) {
        batchCreateCallCount++;
        const body = JSON.parse(init!.body as string) as {
          files: Array<{ virtualId: number; type: string }>;
        };
        const firstFile = body.files[0];
        // Call 1: question (agentic test) or dashboard (manual test — only 1 call)
        if (firstFile.type === 'question') {
          return {
            ok: true, status: 200,
            json: async () => ({
              data: [{
                virtualId: firstFile.virtualId,
                file: {
                  id: REAL_Q_ID, name: Q_NAME, type: 'question',
                  path: `/org/${Q_NAME}`,
                  content: { query: 'SELECT 1', vizSettings: { type: 'table' }, database_name: 'default' },
                  created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
                  references: [], version: 1, last_edit_id: null, company_id: 1,
                },
              }],
            }),
          } as Response;
        }
        // Dashboard (manual test call 1, or agentic test call 2)
        return {
          ok: true, status: 200,
          json: async () => ({
            data: [{
              virtualId: firstFile.virtualId,
              file: {
                id: REAL_DASH_ID, name: DASH_NAME, type: 'dashboard',
                path: `/org/${DASH_NAME}`,
                content: { assets: [{ type: 'question', id: REAL_Q_ID }], layout: { columns: 12, items: [] } },
                created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
                references: [REAL_Q_ID], version: 1, last_edit_id: null, company_id: 1,
              },
            }],
          }),
        } as Response;
      }

      if (urlStr.includes('/health')) {
        return { ok: true, status: 200, json: async () => ({ status: 'healthy' }) } as Response;
      }

      throw new Error(`[Combined flow] Unmocked fetch call to ${urlStr}`);
    });
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
    await waitFor(
      () => expect(testStore.getState().files.files[DASH_VID]).toBeDefined(),
      { timeout: 5000 }
    );

    // New dashboards open in edit mode — QuestionBrowserPanel is visible
    testStore.dispatch(setDashboardEditMode({ fileId: DASH_VID, editMode: true }));
    renderWithProviders(
      <DashboardContainerV2 fileId={DASH_VID} />,
      { store: testStore }
    );

    // QuestionBrowserPanel loads questions (mocked GET /api/files?type=question)
    // and renders each as an article.  Click "Add to dashboard" on the real question.
    const card = await screen.findByRole('article', { name: QUESTION_NAME }, { timeout: 5000 });
    await user.click(within(card).getByRole('button', { name: 'Add to dashboard' }));

    // Virtual dashboard is now dirty — real question linked
    await waitFor(() => {
      const dash = testStore.getState().files.files[DASH_VID];
      const merged = {
        ...(dash.content as DashboardContent),
        ...(dash.persistableChanges as Partial<DashboardContent> | undefined),
      };
      expect(merged.assets?.some(a => (a as { id: number }).id === QUESTION_ID)).toBe(true);
    }, { timeout: 3000 });

    // publishAll: only the virtual dashboard needs batch-create (real question is not dirty)
    await act(async () => { await publishAll(); });

    // Exactly 1 batch-create call — for the virtual dashboard
    expect(batchCreateCallCount).toBe(1);
    expect(testStore.getState().files.files[REAL_DASH_ID]).toBeDefined();
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
    expect(batchCreateCallCount).toBe(2);

    const filesState = testStore.getState().files.files;
    expect(filesState[REAL_Q_ID]).toBeDefined();
    expect(filesState[REAL_DASH_ID]).toBeDefined();

    // No dirty files remain
    expect(selectDirtyFiles(testStore.getState() as any)).toHaveLength(0);
  }, 45000);
});
