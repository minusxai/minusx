/**
 * TDD: Viewer role dashboard read-only tests.
 *
 * These tests are written FIRST (red) and will fail until the implementation is added:
 *   1. `editTypes` rule in rules.json (viewer: [])
 *   2. `canEditFileType` in access-rules.ts + access-rules.client.ts
 *   3. `hideEditToggle={!canEdit}` in FileHeader.tsx
 *   4. Viewer guard in EditFile tool handler (tool-handlers.ts)
 *
 * Scenarios:
 *   1. Viewer UI  — Edit button is absent from the dashboard header
 *   2. Viewer UI  — Auto-enter edit mode is suppressed for viewers
 *   3. Viewer agentic — Agent's EditFile on a dashboard returns a permission error
 */

// Must be hoisted before any module imports
jest.mock('@/lib/database/db-config', () => {
  const path = require('path');
  return {
    DB_PATH: path.join(process.cwd(), 'data', 'test_viewer_readonly_ui.db'),
    DB_DIR: path.join(process.cwd(), 'data'),
    getDbType: () => 'sqlite' as const,
    DB_TYPE: 'sqlite',
  };
});

jest.mock('@/store/filesSlice', () => {
  const actual = jest.requireActual('@/store/filesSlice');
  return {
    __esModule: true,
    ...actual,
    default: actual.default,
    generateVirtualId: jest.fn(actual.generateVirtualId),
  };
});

import React from 'react';
import { screen } from '@testing-library/react';
import { NextRequest } from 'next/server';

import * as storeModule from '@/store/store';
import type { RootState } from '@/store/store';
import { setFile, setEdit, selectDirtyFiles } from '@/store/filesSlice';
import { setDashboardEditMode } from '@/store/uiSlice';
import { createConversation, sendMessage, selectConversation } from '@/store/chatSlice';
import { setUser } from '@/store/authSlice';
import type { DashboardContent } from '@/lib/types.gen';
import type { UserRole } from '@/lib/types';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { waitForReduxState, waitForConversationFinished } from '@/test/helpers/redux-wait';
import FileHeader from '@/components/FileHeader';

import { withPythonBackend } from '@/test/harness/python-backend';
import { setupTestDb } from '@/test/harness/test-db';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { POST as chatPostHandler } from '@/app/api/chat/route';
import { GET as filesGetHandler } from '@/app/api/files/route';
import { PATCH as filePatchHandler } from '@/app/api/files/[id]/route';
import { POST as batchFilesHandler } from '@/app/api/files/batch/route';

// Capture real fetch before any test overrides it
const realFetch = global.fetch;

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const DASHBOARD_ID = 2002;
const QUESTION_ID = 2003;

const VIEWER_AUTH_USER = {
  id: 50,
  email: 'viewer@example.com',
  name: 'Viewer User',
  role: 'viewer' as UserRole,
  companyId: 1,
  companyName: 'test-company',
  home_folder: '/org',
  mode: 'org' as const,
};

// The EffectiveUser shape expected by auth-helpers mock (server-side)
const VIEWER_EFFECTIVE_USER = {
  userId: 50,
  email: 'viewer@example.com',
  name: 'Viewer User',
  role: 'viewer' as UserRole,
  companyId: 1,
  companyName: 'test-company',
  home_folder: '/org',
  mode: 'org' as const,
};

function makeDashboardDbFile() {
  return {
    id: DASHBOARD_ID,
    name: 'Viewer Dashboard',
    type: 'dashboard' as const,
    path: '/org/Viewer Dashboard',
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
    name: 'Sales Revenue',
    type: 'question' as const,
    path: '/org/Sales Revenue',
    content: { query: 'SELECT 1', vizSettings: { type: 'table' as const }, connection_name: '' },
    created_at: '2025-01-01T00:00:00Z',
    updated_at: new Date().toISOString(),
    references: [] as number[],
    version: 1,
    last_edit_id: null,
    company_id: 1,
  };
}

async function insertDashboardAndQuestion(dbPath: string): Promise<void> {
  const { createAdapter } = await import('@/lib/database/adapter/factory');
  const db = await createAdapter({ type: 'sqlite', sqlitePath: dbPath });
  const now = new Date().toISOString();
  await db.query(
    `INSERT INTO files (company_id, id, name, path, type, content, file_references, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [1, DASHBOARD_ID, 'Viewer Dashboard', '/org/Viewer Dashboard', 'dashboard',
      JSON.stringify({ assets: [], layout: null }), '[]', now, now]
  );
  await db.query(
    `INSERT INTO files (company_id, id, name, path, type, content, file_references, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [1, QUESTION_ID, 'Sales Revenue', '/org/Sales Revenue', 'question',
      JSON.stringify({ query: 'SELECT 1', vizSettings: { type: 'table' }, connection_name: '' }),
      '[]', now, now]
  );
  await db.close();
}

/**
 * Minimal fetch mock: routes only the calls this test file needs.
 * For the UI-only tests, no pythonPort/llmPort needed.
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

    if (urlStr.startsWith('/api/chat') || urlStr.includes('localhost:3000/api/chat')) {
      return call(chatPostHandler, `${BASE}/api/chat`, init);
    }
    if (pythonPort && (urlStr.includes(`localhost:${pythonPort}`) || urlStr.includes('localhost:8001'))) {
      return realFetch(urlStr.replace('localhost:8001', `localhost:${pythonPort}`), init);
    }
    if (llmPort && urlStr.includes(`localhost:${llmPort}`)) {
      return realFetch(urlStr, init);
    }
    if (method === 'POST' && urlStr.includes('/api/files/batch')) {
      return call(batchFilesHandler, `${BASE}/api/files/batch`, init);
    }
    if (method === 'PATCH') {
      const m = urlStr.match(/\/api\/files\/(\d+)/);
      if (m) {
        const fullUrl = urlStr.startsWith('http') ? urlStr : `${BASE}${urlStr}`;
        return call(filePatchHandler, fullUrl, init, { params: Promise.resolve({ id: m[1] }) });
      }
    }
    if (method === 'GET' && urlStr.includes('/api/files') && !urlStr.match(/\/api\/files\/\d+/)) {
      return call(filesGetHandler, urlStr.startsWith('http') ? urlStr : `${BASE}${urlStr}`, init);
    }
    if (urlStr.includes('/health')) {
      return { ok: true, status: 200, json: async () => ({ status: 'healthy' }) } as Response;
    }
    if (method === 'GET') {
      return { ok: true, status: 200, json: async () => ({ data: null }) } as Response;
    }
    throw new Error(`[Viewer Readonly] Unmocked fetch: ${method} ${urlStr}`);
  });
}

// ============================================================================
// Scenario 1 & 2: Viewer UI — Edit button hidden, auto-enter suppressed
// ============================================================================

describe('Viewer role: dashboard header hides edit controls', () => {
  setupTestDb(getTestDbPath('viewer_readonly_ui'), { customInit: insertDashboardAndQuestion });

  let testStore: ReturnType<typeof storeModule.makeStore>;
  let getStoreSpy: jest.SpyInstance;

  beforeEach(() => {
    // Override the default admin mock set in jest.setup.ts → viewer for these tests
    jest.requireMock('@/lib/auth/auth-helpers').getEffectiveUser.mockResolvedValue(VIEWER_EFFECTIVE_USER);

    testStore = storeModule.makeStore();
    // Set viewer in Redux so selectEffectiveUser returns viewer (used by FileHeader)
    testStore.dispatch(setUser(VIEWER_AUTH_USER));
    getStoreSpy = jest.spyOn(storeModule, 'getStore').mockReturnValue(testStore);

    testStore.dispatch(setFile({ file: makeDashboardDbFile(), references: [] }));
    testStore.dispatch(setDashboardEditMode({ fileId: DASHBOARD_ID, editMode: false }));
    global.fetch = makeRealApiFetch();
  });

  afterEach(() => {
    global.fetch = realFetch;
    getStoreSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('hides the Edit button for viewer on a dashboard', async () => {
    renderWithProviders(
      <FileHeader fileId={DASHBOARD_ID} fileType="dashboard" />,
      { store: testStore }
    );

    // Dashboard name is rendered in the header (view-mode heading, not an input)
    expect(await screen.findByText('Viewer Dashboard')).toBeInTheDocument();

    // Edit button must NOT be present for viewer — using aria-label per project convention
    expect(screen.queryByLabelText('Edit')).toBeNull();
    expect(screen.queryByLabelText('Cancel editing')).toBeNull();
  });

  it('does not auto-enter edit mode when there are dirty files and user is a viewer', async () => {
    // Make another file dirty to trigger the "anyDirty" auto-enter effect
    testStore.dispatch(setFile({ file: makeQuestionDbFile(), references: [] }));
    testStore.dispatch(setEdit({
      fileId: QUESTION_ID,
      edits: { query: 'SELECT 2' },
    }));

    // Confirm there is at least one dirty file in the store
    expect(selectDirtyFiles(testStore.getState()).length).toBeGreaterThan(0);

    renderWithProviders(
      <FileHeader fileId={DASHBOARD_ID} fileType="dashboard" />,
      { store: testStore }
    );

    // When another file is dirty, the "Review N unsaved changes" button appears
    // (it replaces the Edit toggle).  Wait for it as the render-ready signal.
    expect(await screen.findByLabelText('Review 1 unsaved changes')).toBeInTheDocument();

    // Dashboard edit mode should NOT be set for a viewer even when other files are dirty
    expect(testStore.getState().ui.dashboardEditMode?.[DASHBOARD_ID]).toBeFalsy();
  });
});

// ============================================================================
// Scenario 3: Viewer agentic — EditFile returns permission error
// ============================================================================

describe('Viewer role: agent EditFile on dashboard is rejected', () => {
  const { getPythonPort, getLLMMockPort, getLLMMockServer } = withPythonBackend({ withLLMMock: true });
  setupTestDb(getTestDbPath('viewer_readonly_ui'), { customInit: insertDashboardAndQuestion });

  let testStore: ReturnType<typeof storeModule.makeStore>;
  let getStoreSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.requireMock('@/lib/auth/auth-helpers').getEffectiveUser.mockResolvedValue(VIEWER_EFFECTIVE_USER);

    const pythonPort = getPythonPort();
    const llmPort = getLLMMockPort?.();

    testStore = storeModule.makeStore();
    // Viewer in Redux so tool-handlers.ts reads viewer role via selectEffectiveUser
    testStore.dispatch(setUser(VIEWER_AUTH_USER));
    getStoreSpy = jest.spyOn(storeModule, 'getStore').mockReturnValue(testStore);

    testStore.dispatch(setFile({ file: makeDashboardDbFile(), references: [] }));
    testStore.dispatch(setFile({ file: makeQuestionDbFile(), references: [] }));

    global.fetch = makeRealApiFetch({ pythonPort, llmPort });
  });

  afterEach(() => {
    global.fetch = realFetch;
    getStoreSpy.mockRestore();
  });

  it('returns a permission error when agent calls EditFile on a dashboard as a viewer', async () => {
    const mockServer = getLLMMockServer!();
    await mockServer.reset();
    await mockServer.configure([
      // Turn 1: agent tries to edit the dashboard's assets
      {
        response: {
          content: '',
          role: 'assistant',
          tool_calls: [{
            id: 'tc_viewer_edit_dash',
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
      // Turn 2: LLM receives the permission-error tool result and informs the user
      {
        response: {
          content: "I'm sorry, I cannot edit this dashboard. Your viewer role does not allow modifications.",
          role: 'assistant',
          tool_calls: [],
          finish_reason: 'stop',
        },
        usage: { total_tokens: 60, prompt_tokens: 40, completion_tokens: 20 },
      },
    ]);

    const CONV_ID = -700;
    testStore.dispatch(createConversation({
      conversationID: CONV_ID,
      agent: 'AnalystAgent',
      agent_args: { goal: 'Add question to dashboard' },
    }));
    testStore.dispatch(sendMessage({
      conversationID: CONV_ID,
      message: 'Add the Sales Revenue question to the Viewer Dashboard',
    }));

    const realConvId = await waitForConversationFinished(
      () => testStore.getState() as RootState,
      CONV_ID,
    );

    // Conversation completed without a fatal orchestration error
    const conv = selectConversation(testStore.getState() as RootState, realConvId);
    expect(conv?.error).toBeUndefined();

    // Dashboard must be unchanged — no assets staged in persistableChanges
    const dashState = testStore.getState().files.files[DASHBOARD_ID];
    const mergedAssets = (
      ((dashState?.persistableChanges as Partial<DashboardContent>) ?? {})?.assets
      ?? (dashState?.content as DashboardContent)?.assets
      ?? []
    );
    expect(mergedAssets).toHaveLength(0);

    // The tool message for EditFile should carry a success=false payload
    const toolMsg = conv?.messages.find(
      m => m.role === 'tool' && (m as any).tool_call_id === 'tc_viewer_edit_dash'
    );
    expect(toolMsg).toBeDefined();
    const rawContent = (toolMsg as any)?.content;
    const resultPayload =
      typeof rawContent === 'string' ? JSON.parse(rawContent) : rawContent;
    expect(resultPayload?.success).toBe(false);
    expect(resultPayload?.error).toMatch(/viewer|permission|read.?only/i);
  }, 45000);
});
