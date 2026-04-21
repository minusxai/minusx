// ─── Hoisted mocks ───────────────────────────────────────────────────────────

jest.mock('@/lib/database/db-config', () => ({
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

jest.mock('@/store/filesSlice', () => {
  const actual = jest.requireActual('@/store/filesSlice');
  return {
    __esModule: true,
    ...actual,
    default: actual.default,
    generateVirtualId: jest.fn(actual.generateVirtualId),
  };
});

const mockRouterPush = jest.fn();
jest.mock('@/lib/navigation/use-navigation', () => ({
  useRouter: () => ({
    push: mockRouterPush,
    replace: jest.fn(),
    back: jest.fn(),
    prefetch: jest.fn(),
  }),
  usePathname: () => '/explore',
  useSearchParams: () => new URLSearchParams(),
  getRouter: jest.fn(() => null),
}));

jest.mock('@/lib/utils/attachment-extract', () => ({
  extractTextFromDocument: jest.fn().mockResolvedValue(''),
  SUPPORTED_DOC_EXTENSIONS: [],
}));

jest.mock('@/components/Markdown', () => {
  const React = require('react');
  const MarkdownMock = ({ children }: { children?: any }) =>
    React.createElement('span', { 'data-testid': 'markdown' }, children);
  return { __esModule: true, default: MarkdownMock };
});

jest.mock('@/lib/navigation/NavigationGuardProvider', () => ({
  useNavigationGuard: () => ({
    navigate: jest.fn(),
    isBlocked: false,
    confirmNavigation: jest.fn(),
    cancelNavigation: jest.fn(),
  }),
  NavigationGuardProvider: ({ children }: { children: any }) => children,
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import React, { useEffect, useRef } from 'react';
import { screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextRequest } from 'next/server';

import * as storeModule from '@/store/store';
import type { RootState } from '@/store/store';
import * as filesSliceModule from '@/store/filesSlice';
import {
  setFile, setEdit, addQuestionToDashboard, selectDirtyFiles,
  setFiles,
} from '@/store/filesSlice';
import * as useNavModule from '@/lib/navigation/use-navigation';
import { setDashboardEditMode } from '@/store/uiSlice';
import { setNavigation } from '@/store/navigationSlice';
import { setUser } from '@/store/authSlice';
import {
  createConversation, sendMessage, selectConversation,
  generateVirtualConversationId, setUserInputResult,
} from '@/store/chatSlice';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { publishAll } from '@/lib/api/file-state';
import type { DashboardContent } from '@/lib/types.gen';
import type { UserRole } from '@/lib/types';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { renderFilePage } from '@/test/helpers/render-file-page';
import { waitForReduxState, waitForConversationFinished } from '@/test/helpers/redux-wait';
import FileHeader from '@/components/FileHeader';
import DashboardContainerV2 from '@/components/containers/DashboardContainerV2';
import ChatInterface from '@/components/explore/ChatInterface';

import { withPythonBackend } from '@/test/harness/python-backend';
import { setupMockFetch } from '@/test/harness/mock-fetch';
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

// Capture real fetch before any test can override it
const realFetch = global.fetch;

// ─── Agent creates files via chat ─────────────────────────────────────────────

function AgentFileResult() {
  const files = useAppSelector((state: RootState) => state.files.files);
  const questions = Object.values(files).filter(f => f.type === 'question');
  return (
    <div aria-label="agent file results">
      {questions.map(q => {
        const effectiveName = q.metadataChanges?.name ?? q.name ?? 'Untitled Question';
        return (
          <div key={q.id} role="article" aria-label={effectiveName}>
            {effectiveName}
          </div>
        );
      })}
    </div>
  );
}

async function templateInterceptor(urlStr: string, init?: RequestInit): Promise<Response | null> {
  const method = init?.method?.toUpperCase() ?? 'GET';
  if (method === 'POST' && urlStr.includes('/api/files/template')) {
    const body = JSON.parse(init?.body as string) as { type: string };
    const content = body.type === 'question'
      ? { query: '', vizSettings: { type: 'table' }, connection_name: '', parameters: [] }
      : { assets: [], layout: { columns: 12, items: [] } };
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: { content, fileName: '', metadata: { availableDatabases: [] } } }),
    } as Response;
  }
  return null;
}

describe('UI Agent E2E Suites', () => {
  const { getPythonPort: sharedPythonPort, getLLMMockPort: sharedLLMMockPort, getLLMMockServer: sharedGetLLMMockServer } =
    withPythonBackend({ withLLMMock: true });

describe('Agent creates files via chat', () => {

  setupTestDb(getTestDbPath('agent_creates_files_ui'));

  const mockFetch = setupMockFetch({
    getPythonPort: sharedPythonPort,
    getLLMMockPort: sharedLLMMockPort,
    interceptors: [
      {
        includesUrl: ['localhost:3000/api/chat'],
        startsWithUrl: ['/api/chat'],
        handler: chatPostHandler,
      },
    ],
    additionalInterceptors: [templateInterceptor],
  });

  let testStore: ReturnType<typeof storeModule.makeStore>;
  let getStoreSpy: jest.SpyInstance;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    // Re-install this describe's mock fetch so later setupMockFetch calls don't override it
    fetchSpy = jest.spyOn(global as any, 'fetch').mockImplementation(mockFetch as any);
    testStore = storeModule.makeStore();
    getStoreSpy = jest.spyOn(storeModule, 'getStore').mockReturnValue(testStore);
    mockFetch.mockClear();
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
    getStoreSpy.mockRestore();
  });

  it('creates a question via the agent and the UI reflects the new file', async () => {
    const mockServer = sharedGetLLMMockServer!();
    await mockServer.reset();

    await mockServer.configure([
      {
        response: {
          content: '',
          role: 'assistant',
          tool_calls: [{
            id: 'tc_create_question',
            type: 'function',
            function: {
              name: 'CreateFile',
              arguments: JSON.stringify({ file_type: 'question', name: 'Total Revenue' }),
            },
          }],
          finish_reason: 'tool_calls',
        },
        usage: { total_tokens: 120, prompt_tokens: 90, completion_tokens: 30 },
      },
      {
        response: {
          content: "Done! I've created the Total Revenue question.",
          role: 'assistant',
          tool_calls: [],
          finish_reason: 'stop',
        },
        usage: { total_tokens: 80, prompt_tokens: 60, completion_tokens: 20 },
      },
    ]);

    renderWithProviders(<AgentFileResult />, { store: testStore });

    const CONV_ID = -200;
    testStore.dispatch(createConversation({
      conversationID: CONV_ID,
      agent: 'AnalystAgent',
      agent_args: { goal: 'Create a question called Total Revenue' },
    }));
    testStore.dispatch(sendMessage({
      conversationID: CONV_ID,
      message: 'Create a question called Total Revenue',
    }));

    const realConvId = await waitForConversationFinished(
      () => testStore.getState() as RootState,
      CONV_ID
    );

    expect(selectConversation(testStore.getState() as RootState, realConvId)?.error).toBeUndefined();

    const filesState = testStore.getState().files.files;
    const createdQuestion = Object.values(filesState).find(
      f => f.type === 'question' && (f.metadataChanges?.name ?? f.name) === 'Total Revenue'
    );
    expect(createdQuestion).toBeDefined();

    await screen.findByLabelText('Total Revenue');
    expect((await mockServer.getCalls()).length).toBeGreaterThanOrEqual(2);
  }, 45000);

  it('displays nothing before the agent runs and updates once it completes', async () => {
    const mockServer = sharedGetLLMMockServer!();
    await mockServer.reset();

    await mockServer.configure([
      {
        response: {
          content: '',
          role: 'assistant',
          tool_calls: [{
            id: 'tc_create_q2',
            type: 'function',
            function: {
              name: 'CreateFile',
              arguments: JSON.stringify({ file_type: 'question', name: 'Monthly Users' }),
            },
          }],
          finish_reason: 'tool_calls',
        },
        usage: { total_tokens: 100, prompt_tokens: 75, completion_tokens: 25 },
      },
      {
        response: {
          content: 'Done! Monthly Users question created.',
          role: 'assistant',
          tool_calls: [],
          finish_reason: 'stop',
        },
        usage: { total_tokens: 70, prompt_tokens: 55, completion_tokens: 15 },
      },
    ]);

    renderWithProviders(<AgentFileResult />, { store: testStore });

    expect(screen.queryByLabelText('Monthly Users')).toBeNull();

    const CONV_ID = -300;
    testStore.dispatch(createConversation({
      conversationID: CONV_ID,
      agent: 'AnalystAgent',
      agent_args: { goal: 'Create a monthly users question' },
    }));
    testStore.dispatch(sendMessage({
      conversationID: CONV_ID,
      message: 'Create a question called Monthly Users',
    }));

    await screen.findByLabelText('Monthly Users', {}, { timeout: 40000 });
  }, 45000);
});

// ─── Explore page: submit question → agent responds ───────────────────────────

async function catchAllApiInterceptor(
  urlStr: string,
  _init?: RequestInit
): Promise<Response | null> {
  const isApi = urlStr.startsWith('/api/') || urlStr.includes('localhost:3000/api/');
  const isChat = urlStr.includes('/api/chat');
  if (isApi && !isChat) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: null, success: true }),
      text: async () => '',
    } as Response;
  }
  return null;
}

describe('Explore page: submit question → agent responds → see answer → toggle thinking', () => {

  setupTestDb(getTestDbPath('explore_chat_ui'));

  // Reset global.fetch to real fetch before setupMockFetch captures it as
  // originalFetch — otherwise the first setupMockFetch's spy is captured here,
  // causing LLM mock pass-through to call mockFetch (wrong ports) instead of
  // the real network fetch.
  global.fetch = realFetch;

  const exploreMockFetch = setupMockFetch({
    getPythonPort: sharedPythonPort,
    getLLMMockPort: sharedLLMMockPort,
    interceptors: [
      {
        includesUrl: ['localhost:3000/api/chat'],
        startsWithUrl: ['/api/chat'],
        handler: chatPostHandler,
      },
    ],
    additionalInterceptors: [catchAllApiInterceptor],
  });

  let testStore: ReturnType<typeof storeModule.makeStore>;
  let getStoreSpy: jest.SpyInstance;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    // Re-install mock because the prior describe's setupMockFetch afterAll
    // does global.fetch = originalFetch, removing the spy from global scope.
    fetchSpy = jest.spyOn(global as any, 'fetch').mockImplementation(exploreMockFetch as any);
    testStore = storeModule.makeStore();
    getStoreSpy = jest.spyOn(storeModule, 'getStore').mockReturnValue(testStore);
    exploreMockFetch.mockClear();
    mockRouterPush.mockClear();
    window.HTMLElement.prototype.scrollTo = jest.fn();
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
    getStoreSpy.mockRestore();
  });

  it(
    'shows the final answer and supports toggling thinking after the agent responds',
    async () => {
      const mockServer = sharedGetLLMMockServer!();
      await mockServer.reset();

      await mockServer.configure({
        response: {
          content: 'Based on the data, the answer is 42.',
          content_blocks: [
            { type: 'thinking', thinking: 'Let me think through this step by step. The user is asking about the data.', signature: '' },
            { type: 'text', text: 'Based on the data, the answer is 42.' },
          ],
          role: 'assistant',
          finish_reason: 'stop',
        },
        usage: { total_tokens: 120, prompt_tokens: 90, completion_tokens: 30 },
      });

      renderWithProviders(
        <ChatInterface
          conversationId={undefined}
          contextPath="/org"
          container="page"
        />,
        { store: testStore }
      );

      const CONV_ID = generateVirtualConversationId();
      testStore.dispatch(
        createConversation({
          conversationID: CONV_ID,
          agent: 'AnalystAgent',
          agent_args: {
            connection_id: null,
            context_path: '/org',
            context_version: null,
            schema: [],
            context: '',
          },
          message: 'What is the answer to everything?',
        })
      );

      const realConvId = await waitForConversationFinished(
        () => testStore.getState() as RootState,
        CONV_ID
      );

      expect(
        selectConversation(testStore.getState() as RootState, realConvId)?.error
      ).toBeUndefined();

      await waitFor(
        () => expect(mockRouterPush).toHaveBeenCalledWith(
          expect.stringMatching(/^\/explore\/\d+$/)
        )
      );

      const answerBlock = await screen.findByLabelText('Answer block');
      expect(answerBlock).toHaveTextContent(/the answer is 42/i);

      const showThinkingBtn = screen.getByLabelText('Show Thinking');
      expect(screen.queryByLabelText('Thinking block')).not.toBeInTheDocument();

      await userEvent.click(showThinkingBtn);
      const thinkingBlock = await screen.findByLabelText('Thinking block');
      expect(thinkingBlock).toHaveTextContent(/let me think through this step by step/i);
      expect(screen.getByLabelText('Hide Thinking')).toBeInTheDocument();
    },
    45000
  );
});

// ─── Dashboard fixtures ───────────────────────────────────────────────────────

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
  };
}

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

function AutoPublishUserInput() {
  const dispatch = useAppDispatch();
  const allConversations = useAppSelector((state: RootState) => state.chat.conversations);
  const handledIds = useRef(new Set<string>());

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

async function insertDashboardAndQuestion(_dbPath: string): Promise<void> {
  const { getAdapter } = await import('@/lib/database/adapter/factory');
  const db = await getAdapter();
  const now = new Date().toISOString();
  await db.query(
    `INSERT INTO files (id, name, path, type, content, file_references, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [DASHBOARD_ID, 'Test Dashboard', '/org/Test Dashboard', 'dashboard',
      JSON.stringify({ assets: [], layout: null }), '[]', now, now]
  );
  await db.query(
    `INSERT INTO files (id, name, path, type, content, file_references, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [QUESTION_ID, QUESTION_NAME, `/org/${QUESTION_NAME}`, 'question',
      JSON.stringify({ query: 'SELECT 1', vizSettings: { type: 'table' }, connection_name: '' }), '[]', now, now]
  );
}

async function insertDashboardAndTwoQuestions(dbPath: string): Promise<void> {
  await insertDashboardAndQuestion(dbPath);
  const { getAdapter } = await import('@/lib/database/adapter/factory');
  const db = await getAdapter();
  const now = new Date().toISOString();
  await db.query(
    `INSERT INTO files (id, name, path, type, content, file_references, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [QUESTION_ID_2, 'Regional Revenue', '/org/Regional Revenue', 'question',
      JSON.stringify({ query: 'SELECT region FROM sales GROUP BY region', vizSettings: { type: 'table' }, connection_name: '' }),
      '[]', now, now]
  );
}

async function insertQuestionsWithSharedParams(_dbPath: string): Promise<void> {
  const { getAdapter } = await import('@/lib/database/adapter/factory');
  const db = await getAdapter();
  const now = new Date().toISOString();
  await db.query(
    `INSERT INTO files (id, name, path, type, content, file_references, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [DASHBOARD_ID, 'Param Dashboard', '/org/Param Dashboard', 'dashboard',
      JSON.stringify({ assets: [{ type: 'question', id: QUESTION_ID }, { type: 'question', id: QUESTION_ID_2 }], layout: null }),
      JSON.stringify([QUESTION_ID, QUESTION_ID_2]), now, now]
  );
  await db.query(
    `INSERT INTO files (id, name, path, type, content, file_references, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [QUESTION_ID, 'Orders Q', '/org/Orders Q', 'question',
      JSON.stringify({ query: 'SELECT * FROM orders WHERE order_date >= :start_date', parameters: [], vizSettings: { type: 'table' }, connection_name: '' }),
      '[]', now, now]
  );
  await db.query(
    `INSERT INTO files (id, name, path, type, content, file_references, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [QUESTION_ID_2, 'Revenue Q', '/org/Revenue Q', 'question',
      JSON.stringify({ query: 'SELECT * FROM revenue WHERE order_date >= :start_date AND region = :region', parameters: [], vizSettings: { type: 'table' }, connection_name: '' }),
      '[]', now, now]
  );
}

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
    if (method === 'POST' && urlStr.includes('/api/files/batch-create')) {
      return call(batchCreateHandler, `${BASE}/api/files/batch-create`, init);
    }
    if (method === 'POST' && urlStr.includes('/api/files/batch-save')) {
      return call(batchSaveHandler, `${BASE}/api/files/batch-save`, init);
    }
    if (method === 'POST' && urlStr.includes('/api/files/batch')) {
      return call(batchFilesHandler, `${BASE}/api/files/batch`, init);
    }
    if (method === 'POST' && urlStr.includes('/api/files/template')) {
      return call(templateHandler, `${BASE}/api/files/template`, init);
    }
    if (method === 'PATCH') {
      const m = urlStr.match(/\/api\/files\/(\d+)/);
      if (m) {
        const fullUrl = urlStr.startsWith('http') ? urlStr : `${BASE}${urlStr}`;
        return call(filePatchHandler, fullUrl, init, { params: Promise.resolve({ id: m[1] }) });
      }
    }
    if (method === 'GET' && urlStr.includes('/api/files') && !urlStr.match(/\/api\/files\/\d+/)) {
      const fullUrl = urlStr.startsWith('http') ? urlStr : `${BASE}${urlStr}`;
      return call(filesGetHandler, fullUrl, init);
    }
    if (method === 'GET' && urlStr.includes('/api/connections') && !urlStr.includes('/schema')) {
      return call(connectionsGetHandler, `${BASE}/api/connections`, init);
    }
    if (urlStr.includes('/health')) {
      return { ok: true, status: 200, json: async () => ({ status: 'healthy' }) } as Response;
    }
    if (method === 'GET') {
      return { ok: true, status: 200, json: async () => ({ data: null }) } as Response;
    }
    throw new Error(`[Dashboard UI] Unmocked fetch: ${method} ${urlStr}`);
  });
}

// ─── Scenario 1: Add question to existing dashboard and save ──────────────────

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

    const questionCard = await screen.findByLabelText(QUESTION_NAME);
    const addButton = within(questionCard).getByLabelText('Add to dashboard');
    await user.click(addButton);

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

    const publishBtn = screen.getByLabelText('Save');
    expect(publishBtn).not.toBeDisabled();
    await user.click(publishBtn);

    await waitForReduxState(
      testStore,
      state => Object.keys(state.files.files[DASHBOARD_ID].persistableChanges ?? {}),
      keys => keys.length === 0
    );

    const savedContent = testStore.getState().files.files[DASHBOARD_ID].content as DashboardContent;
    expect(savedContent.assets).toHaveLength(1);
    expect(savedContent.assets![0]).toMatchObject({ type: 'question', id: QUESTION_ID });

    const saveCalls = (global.fetch as jest.Mock).mock.calls.filter(
      ([url, init]) =>
        typeof url === 'string' &&
        url.includes(`/api/files/${DASHBOARD_ID}`) &&
        init?.method?.toUpperCase() === 'PATCH'
    );
    expect(saveCalls).toHaveLength(1);
  });
});

// ─── Scenario 2: Create new dashboard and question, then publishAll ───────────

describe('Create new dashboard and question, then publishAll', () => {
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

    testStore.dispatch(setFile({
      file: {
        id: Q_VID, name: Q_NAME, type: 'question' as const,
        path: `/org/${Q_NAME}`,
        content: { query: '', vizSettings: { type: 'table' as const }, connection_name: '' },
        created_at: '', updated_at: '', references: [] as number[],
        version: 1, last_edit_id: null,
      },
      references: [],
    }));
    testStore.dispatch(setFile({
      file: {
        id: DASH_VID, name: DASH_NAME, type: 'dashboard' as const,
        path: `/org/${DASH_NAME}`,
        content: { assets: [], layout: null },
        created_at: '', updated_at: '', references: [] as number[],
        version: 1, last_edit_id: null,
      },
      references: [],
    }));

    testStore.dispatch(setEdit({
      fileId: Q_VID,
      edits: { query: 'SELECT revenue FROM sales', vizSettings: { type: 'table' as const }, connection_name: 'default' },
    }));
    testStore.dispatch(addQuestionToDashboard({ dashboardId: DASH_VID, questionId: Q_VID }));

    await act(async () => { await publishAll(); });

    const fetchMock = global.fetch as jest.Mock;
    const batchCreateCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes('/api/files/batch-create'));
    expect(batchCreateCalls).toHaveLength(2);

    const firstBody = JSON.parse(batchCreateCalls[0][1].body) as { files: Array<{ type: string; virtualId: number }> };
    expect(firstBody.files).toHaveLength(1);
    expect(firstBody.files[0].type).toBe('question');

    const secondBody = JSON.parse(batchCreateCalls[1][1].body) as { files: Array<{ type: string; content: DashboardContent }> };
    expect(secondBody.files).toHaveLength(1);
    expect(secondBody.files[0].type).toBe('dashboard');
    const assetIds = secondBody.files[0].content.assets?.map(a => (a as { id: number }).id) ?? [];
    expect(assetIds).toHaveLength(1);
    expect(assetIds[0]).toBeGreaterThan(0);

    expect(selectDirtyFiles(testStore.getState())).toHaveLength(0);

    const allFiles = Object.values(testStore.getState().files.files);
    const savedQ = allFiles.find(f => f.type === 'question' && f.id > 0 && f.name === Q_NAME);
    expect((savedQ!.content as any).query).toBe('SELECT revenue FROM sales');
  });
});

// ─── Scenario 3: Edit/cancel mode toggle ─────────────────────────────────────

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

    testStore.dispatch(setDashboardEditMode({ fileId: DASHBOARD_ID, editMode: false }));

    renderWithProviders(
      <>
        <FileHeader fileId={DASHBOARD_ID} fileType="dashboard" />
        <DashboardContainerV2 fileId={DASHBOARD_ID} />
      </>,
      { store: testStore }
    );

    expect(await screen.findByLabelText('Dashboard')).toBeInTheDocument();

    await user.click(screen.getByLabelText('Edit'));
    expect(testStore.getState().ui.dashboardEditMode?.[DASHBOARD_ID]).toBe(true);

    await user.click(screen.getByLabelText('Cancel editing'));
    expect(testStore.getState().ui.dashboardEditMode?.[DASHBOARD_ID]).toBe(false);
  });
});

// ─── Dashboard agentic scenarios ──────────────────────────────────────────────

describe('Dashboard agentic scenarios', () => {
  setupTestDb(getTestDbPath('dashboard_ui'), { customInit: insertDashboardAndQuestion });

  const Q_VID = -100;
  const DASH_VID = -101;
  const AGENTIC_Q_NAME = 'Revenue Query';
  const AGENTIC_DASH_NAME = 'Agentic Dashboard';

  let testStore: ReturnType<typeof storeModule.makeStore>;
  let getStoreSpy: jest.SpyInstance;

  beforeEach(() => {
    testStore = storeModule.makeStore();
    getStoreSpy = jest.spyOn(storeModule, 'getStore').mockReturnValue(testStore);

    const pythonPort = sharedPythonPort();
    const llmPort = sharedLLMMockPort?.();

    global.fetch = makeRealApiFetch({ pythonPort, llmPort });
  });

  afterEach(() => {
    global.fetch = realFetch;
    getStoreSpy.mockRestore();
  });

  it('agentic (Scenario 1): agent adds question to existing dashboard via EditFile + PublishAll', async () => {
    const mockServer = sharedGetLLMMockServer!();
    await mockServer.reset();
    await mockServer.configure([
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

    testStore.dispatch(setFile({ file: makeDashboardDbFile(), references: [] }));
    testStore.dispatch(setFile({ file: makeQuestionDbFile(), references: [] }));
    testStore.dispatch(setDashboardEditMode({ fileId: DASHBOARD_ID, editMode: true }));

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

    expect(selectConversation(testStore.getState() as RootState, realConvId)?.error).toBeUndefined();

    const dashState = testStore.getState().files.files[DASHBOARD_ID];
    expect(Object.keys(dashState?.persistableChanges ?? {})).toHaveLength(0);
  }, 45000);

  it('agentic (Scenario 2): agent publishes virtual question + dashboard in topological order', async () => {
    const mockServer = sharedGetLLMMockServer!();
    await mockServer.reset();
    await mockServer.configure([
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

    testStore.dispatch(setFile({
      file: {
        id: Q_VID, name: AGENTIC_Q_NAME, type: 'question' as const,
        path: `/org/${AGENTIC_Q_NAME}`,
        content: { query: '', vizSettings: { type: 'table' as const }, connection_name: '' },
        created_at: '', updated_at: '',
        references: [] as number[], version: 1, last_edit_id: null,
      },
      references: [],
    }));
    testStore.dispatch(setFile({
      file: {
        id: DASH_VID, name: AGENTIC_DASH_NAME, type: 'dashboard' as const,
        path: `/org/${AGENTIC_DASH_NAME}`,
        content: { assets: [], layout: null },
        created_at: '', updated_at: '',
        references: [] as number[], version: 1, last_edit_id: null,
      },
      references: [],
    }));
    testStore.dispatch(setEdit({
      fileId: Q_VID,
      edits: { query: 'SELECT 1', vizSettings: { type: 'table' as const }, connection_name: 'default' },
    }));
    testStore.dispatch(addQuestionToDashboard({ dashboardId: DASH_VID, questionId: Q_VID }));

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

    expect(selectConversation(testStore.getState() as RootState, realConvId)?.error).toBeUndefined();

    const fetchMock = global.fetch as jest.Mock;
    const batchCreateCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes('/api/files/batch-create'));
    expect(batchCreateCalls).toHaveLength(2);

    const allFiles = Object.values(testStore.getState().files.files);
    expect(allFiles.some(f => f.type === 'question' && f.id > 0 && f.name === AGENTIC_Q_NAME)).toBe(true);
    expect(allFiles.some(f => f.type === 'dashboard' && f.id > 0)).toBe(true);

    expect(selectDirtyFiles(testStore.getState() as any)).toHaveLength(0);
  }, 45000);
});

// ─── Combined flow: new dashboard with question from scratch ──────────────────

describe('Combined flow: new dashboard with question from scratch', () => {
  setupTestDb(getTestDbPath('dashboard_ui'), { customInit: insertDashboardAndQuestion });

  const DASH_VID = -1_000_000_091;
  const Q_VID    = -1_000_000_092;
  const Q_NAME = 'Revenue Query';

  let testStore: ReturnType<typeof storeModule.makeStore>;
  let getStoreSpy: jest.SpyInstance;

  beforeEach(() => {
    testStore = storeModule.makeStore();
    getStoreSpy = jest.spyOn(storeModule, 'getStore').mockReturnValue(testStore);

    (filesSliceModule.generateVirtualId as jest.Mock).mockClear();
    (filesSliceModule.generateVirtualId as jest.Mock)
      .mockReturnValueOnce(DASH_VID)
      .mockReturnValueOnce(Q_VID);

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

    const pythonPort = sharedPythonPort();
    const llmPort = sharedLLMMockPort?.();

    global.fetch = makeRealApiFetch({ pythonPort, llmPort });
  });

  afterEach(() => {
    global.fetch = realFetch;
    getStoreSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('manual: navigates to new dashboard, adds existing question via QuestionBrowserPanel, publishAll batch-creates the new dashboard', async () => {
    const user = userEvent.setup();

    testStore.dispatch(setFile({ file: makeQuestionDbFile(), references: [] }));

    testStore.dispatch(setNavigation({
      pathname: '/new/dashboard',
      searchParams: { virtualId: String(DASH_VID), folder: '/org' },
    }));
    await waitForReduxState(
      testStore,
      state => state.files.files[DASH_VID],
      v => v !== undefined
    );

    testStore.dispatch(setDashboardEditMode({ fileId: DASH_VID, editMode: true }));
    renderWithProviders(
      <DashboardContainerV2 fileId={DASH_VID} />,
      { store: testStore }
    );

    const card = await screen.findByLabelText(QUESTION_NAME);
    await user.click(within(card).getByLabelText('Add to dashboard'));

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

    await act(async () => { await publishAll(); });

    const batchCreateCalls1 = (global.fetch as jest.Mock).mock.calls.filter(
      ([u]) => String(u).includes('/api/files/batch-create')
    );
    expect(batchCreateCalls1).toHaveLength(1);
    const newDash = Object.values(testStore.getState().files.files).find(f => f.type === 'dashboard' && f.id > 0);
    expect(newDash).toBeDefined();
    expect(selectDirtyFiles(testStore.getState())).toHaveLength(0);
  });

  it('manual (combined): creates new virtual question via "Create New Question" in QuestionBrowserPanel, links to virtual dashboard, publishAll saves both in topological order', async () => {
    const user = userEvent.setup();

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

    const createBtn = await screen.findByLabelText('Create New Question');
    await user.click(createBtn);

    const nameInput = await screen.findByLabelText('Question name');

    expect(testStore.getState().files.files[Q_VID]).toBeDefined();

    await user.type(nameInput, Q_NAME);

    const dialog = screen.getByLabelText('Create question');
    await user.click(within(dialog).getByLabelText('Add'));

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

    await act(async () => { await publishAll(); });

    const batchCreateCalls2 = (global.fetch as jest.Mock).mock.calls.filter(
      ([u]) => String(u).includes('/api/files/batch-create')
    );
    expect(batchCreateCalls2).toHaveLength(2);
    const allFilesAfter = Object.values(testStore.getState().files.files);
    expect(allFilesAfter.some(f => f.type === 'question' && f.id > 0 && f.name === Q_NAME)).toBe(true);
    expect(allFilesAfter.some(f => f.type === 'dashboard' && f.id > 0)).toBe(true);
    expect(selectDirtyFiles(testStore.getState())).toHaveLength(0);
  });

  it('agentic: agent navigates to new dashboard, creates question, links via EditFile, publishes', async () => {
    const mockServer = sharedGetLLMMockServer!();
    await mockServer.reset();
    await mockServer.configure([
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

    testStore.dispatch(setNavigation({ pathname: '/explore', searchParams: {} }));

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

    expect(selectConversation(testStore.getState() as RootState, realConvId)?.error).toBeUndefined();

    const batchCreateCalls3 = (global.fetch as jest.Mock).mock.calls.filter(
      ([u]) => String(u).includes('/api/files/batch-create')
    );
    expect(batchCreateCalls3).toHaveLength(2);

    const allFiles3 = Object.values(testStore.getState().files.files);
    expect(allFiles3.some(f => f.type === 'question' && f.id > 0 && f.name === Q_NAME)).toBe(true);
    expect(allFiles3.some(f => f.type === 'dashboard' && f.id > 0)).toBe(true);

    expect(selectDirtyFiles(testStore.getState() as any)).toHaveLength(0);
  }, 45000);
});

// ─── publishAll retry idempotency ─────────────────────────────────────────────

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
    testStore.dispatch(setFile({
      file: {
        id: Q_VID, name: Q_RETRY_NAME, type: 'question' as const,
        path: `/org/${Q_RETRY_NAME}`,
        content: { query: 'SELECT retry FROM data', vizSettings: { type: 'table' as const }, connection_name: '' },
        created_at: '', updated_at: '', references: [] as number[],
        version: 1, last_edit_id: null,
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
        version: 1, last_edit_id: null,
      },
      references: [],
    }));
    testStore.dispatch(addQuestionToDashboard({ dashboardId: DASH_VID, questionId: Q_VID }));

    let attempt = 0;
    const realApiFetch = makeRealApiFetch();
    global.fetch = jest.fn(async (url: string | Request | URL, init?: RequestInit): Promise<Response> => {
      if (String(url).includes('/api/files/batch-create')) {
        attempt++;
        if (attempt === 1) {
          await realApiFetch(url, init);
          return { ok: false, status: 500, json: async () => ({ error: { message: 'Network error' } }) } as Response;
        }
      }
      return realApiFetch(url, init);
    });

    await expect(publishAll()).rejects.toThrow('Network error');

    expect(selectDirtyFiles(testStore.getState())).toHaveLength(2);

    await act(async () => { await publishAll(); });

    const allFiles = Object.values(testStore.getState().files.files);
    const savedQ    = allFiles.find(f => f.type === 'question'  && f.id > 0 && f.name === Q_RETRY_NAME);
    const savedDash = allFiles.find(f => f.type === 'dashboard' && f.id > 0 && f.name === DASH_RETRY_NAME);
    expect(savedQ).toBeDefined();
    expect(savedDash).toBeDefined();

    expect(selectDirtyFiles(testStore.getState())).toHaveLength(0);

    const batchCreateCalls = (global.fetch as jest.Mock).mock.calls
      .filter(([u]) => String(u).includes('/api/files/batch-create'));
    expect(batchCreateCalls).toHaveLength(3);
  });
});

// ─── publishAll error handling ────────────────────────────────────────────────

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
        version: 1, last_edit_id: null,
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

    const dirty = selectDirtyFiles(testStore.getState());
    expect(dirty).toHaveLength(1);
    expect(dirty[0].id).toBe(DASHBOARD_ID);
  });

  it('circular dependency: throws before any API call', async () => {
    const A = -20;
    const B = -21;
    testStore.dispatch(setFile({
      file: {
        id: A, name: 'DashA', type: 'dashboard' as const, path: '/org/DashA',
        content: { assets: [{ type: 'question' as const, id: B }], layout: null },
        created_at: '', updated_at: '', references: [] as number[],
        version: 1, last_edit_id: null,
      },
      references: [],
    }));
    testStore.dispatch(setFile({
      file: {
        id: B, name: 'DashB', type: 'dashboard' as const, path: '/org/DashB',
        content: { assets: [{ type: 'question' as const, id: A }], layout: null },
        created_at: '', updated_at: '', references: [] as number[],
        version: 1, last_edit_id: null,
      },
      references: [],
    }));
    testStore.dispatch(setEdit({ fileId: A, edits: { description: 'dirty A' } }));
    testStore.dispatch(setEdit({ fileId: B, edits: { description: 'dirty B' } }));

    global.fetch = jest.fn(() => { throw new Error('should not be called'); });

    await expect(publishAll()).rejects.toThrow('Circular dependency detected');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(selectDirtyFiles(testStore.getState())).toHaveLength(2);
  });
});

// ─── Mixed real + virtual publishAll ─────────────────────────────────────────

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

    testStore.dispatch(setFile({
      file: {
        id: Q_VID, name: 'Mix Query', type: 'question' as const,
        path: '/org/Mix Query',
        content: { query: '', vizSettings: { type: 'table' as const }, connection_name: '' },
        created_at: '', updated_at: '', references: [] as number[],
        version: 1, last_edit_id: null,
      },
      references: [],
    }));
    testStore.dispatch(setEdit({
      fileId: Q_VID,
      edits: { query: 'SELECT mix FROM data', vizSettings: { type: 'table' as const }, connection_name: 'default' },
    }));

    testStore.dispatch(setFile({ file: makeDashboardDbFile(), references: [] }));
    testStore.dispatch(addQuestionToDashboard({ dashboardId: DASHBOARD_ID, questionId: Q_VID }));

    await act(async () => { await publishAll(); });

    const fetchMock = global.fetch as jest.Mock;
    const batchCreateCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes('/api/files/batch-create'));
    const batchSaveCalls   = fetchMock.mock.calls.filter(([u]) => String(u).includes('/api/files/batch-save'));

    expect(batchCreateCalls).toHaveLength(1);
    expect(batchSaveCalls).toHaveLength(1);

    const savedContent = testStore.getState().files.files[DASHBOARD_ID].content as DashboardContent;
    expect(savedContent.assets).toHaveLength(1);
    expect(savedContent.assets!.every(a => (a as { id: number }).id > 0)).toBe(true);

    expect(selectDirtyFiles(testStore.getState())).toHaveLength(0);
  });
});

// ─── Multiple questions in dashboard ─────────────────────────────────────────

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

    const removeBtns = await screen.findAllByLabelText('Remove from dashboard');
    expect(removeBtns).toHaveLength(2);
    await user.click(removeBtns[0]);

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

// ─── Dashboard parameter merging ─────────────────────────────────────────────

describe('Dashboard parameter merging', () => {
  setupTestDb(getTestDbPath('dashboard_ui'), { customInit: insertQuestionsWithSharedParams });

  let testStore: ReturnType<typeof storeModule.makeStore>;
  let getStoreSpy: jest.SpyInstance;

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
    version: 1, last_edit_id: null,
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
    references: [] as number[], version: 1, last_edit_id: null,
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
    references: [] as number[], version: 1, last_edit_id: null,
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

    await waitFor(() => {
      expect(screen.getAllByLabelText('start_date')).toHaveLength(1);
      expect(screen.getAllByLabelText('region')).toHaveLength(1);
    });
  });

  it('parameterValues submitted via setEdit persist in dashboard content after publishAll', async () => {
    testStore.dispatch(setEdit({
      fileId: DASHBOARD_ID,
      edits: { parameterValues: { start_date: '2024-01-01', region: 'North' } },
    }));

    const dirty = testStore.getState().files.files[DASHBOARD_ID];
    expect((dirty.persistableChanges as any)?.parameterValues).toMatchObject({
      start_date: '2024-01-01',
      region: 'North',
    });

    await act(async () => { await publishAll(); });

    const savedContent = testStore.getState().files.files[DASHBOARD_ID].content as DashboardContent;
    expect(savedContent.parameterValues).toMatchObject({ start_date: '2024-01-01', region: 'North' });
    expect(selectDirtyFiles(testStore.getState())).toHaveLength(0);
  });
});

// ─── Viewer dashboard fixtures ────────────────────────────────────────────────

const V_DASHBOARD_ID = 2002;
const V_QUESTION_ID = 2003;

const VIEWER_AUTH_USER = {
  id: 50,
  email: 'viewer@example.com',
  name: 'Viewer User',
  role: 'viewer' as UserRole,
  companyName: 'test-workspace',
  home_folder: '/org',
  mode: 'org' as const,
};

const VIEWER_EFFECTIVE_USER = {
  userId: 50,
  email: 'viewer@example.com',
  name: 'Viewer User',
  role: 'viewer' as UserRole,
  companyName: 'test-workspace',
  home_folder: '/org',
  mode: 'org' as const,
};

function makeViewerDashboardDbFile() {
  return {
    id: V_DASHBOARD_ID,
    name: 'Viewer Dashboard',
    type: 'dashboard' as const,
    path: '/org/Viewer Dashboard',
    content: { assets: [], layout: null },
    created_at: '2025-01-01T00:00:00Z',
    updated_at: new Date().toISOString(),
    references: [] as number[],
    version: 1,
    last_edit_id: null,
  };
}

function makeViewerQuestionDbFile() {
  return {
    id: V_QUESTION_ID,
    name: 'Sales Revenue',
    type: 'question' as const,
    path: '/org/Sales Revenue',
    content: { query: 'SELECT 1', vizSettings: { type: 'table' as const }, connection_name: '' },
    created_at: '2025-01-01T00:00:00Z',
    updated_at: new Date().toISOString(),
    references: [] as number[],
    version: 1,
    last_edit_id: null,
  };
}

async function insertViewerDashboardAndQuestion(_dbPath: string): Promise<void> {
  const { getAdapter } = await import('@/lib/database/adapter/factory');
  const db = await getAdapter();
  const now = new Date().toISOString();
  await db.query(
    `INSERT INTO files (id, name, path, type, content, file_references, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [V_DASHBOARD_ID, 'Viewer Dashboard', '/org/Viewer Dashboard', 'dashboard',
      JSON.stringify({ assets: [], layout: null }), '[]', now, now]
  );
  await db.query(
    `INSERT INTO files (id, name, path, type, content, file_references, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [V_QUESTION_ID, 'Sales Revenue', '/org/Sales Revenue', 'question',
      JSON.stringify({ query: 'SELECT 1', vizSettings: { type: 'table' }, connection_name: '' }),
      '[]', now, now]
  );
}

function makeViewerApiFetch(opts: { pythonPort?: number; llmPort?: number } = {}) {
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
    if (method === 'POST' && urlStr.includes('/api/files/template')) {
      return call(templateHandler, `${BASE}/api/files/template`, init);
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

// ─── Viewer role: dashboard header hides edit controls ───────────────────────

describe('Viewer role: dashboard header hides edit controls', () => {
  setupTestDb(getTestDbPath('viewer_readonly_ui'), { customInit: insertViewerDashboardAndQuestion });

  let testStore: ReturnType<typeof storeModule.makeStore>;
  let getStoreSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.requireMock('@/lib/auth/auth-helpers').getEffectiveUser.mockResolvedValue(VIEWER_EFFECTIVE_USER);

    testStore = storeModule.makeStore();
    testStore.dispatch(setUser(VIEWER_AUTH_USER));
    getStoreSpy = jest.spyOn(storeModule, 'getStore').mockReturnValue(testStore);

    testStore.dispatch(setFile({ file: makeViewerDashboardDbFile(), references: [] }));
    testStore.dispatch(setDashboardEditMode({ fileId: V_DASHBOARD_ID, editMode: false }));
    global.fetch = makeViewerApiFetch();
  });

  afterEach(() => {
    global.fetch = realFetch;
    getStoreSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('hides the Edit button for viewer on a dashboard', async () => {
    renderWithProviders(
      <FileHeader fileId={V_DASHBOARD_ID} fileType="dashboard" />,
      { store: testStore }
    );

    expect(await screen.findByText('Viewer Dashboard')).toBeInTheDocument();
    expect(screen.queryByLabelText('Edit')).toBeNull();
    expect(screen.queryByLabelText('Cancel editing')).toBeNull();
  });

  it('does not auto-enter edit mode when there are dirty files and user is a viewer', async () => {
    testStore.dispatch(setFile({ file: makeViewerQuestionDbFile(), references: [] }));
    testStore.dispatch(setEdit({
      fileId: V_QUESTION_ID,
      edits: { query: 'SELECT 2' },
    }));

    expect(selectDirtyFiles(testStore.getState()).length).toBeGreaterThan(0);

    renderWithProviders(
      <FileHeader fileId={V_DASHBOARD_ID} fileType="dashboard" />,
      { store: testStore }
    );

    expect(await screen.findByLabelText('Review 1 unsaved changes')).toBeInTheDocument();
    expect(testStore.getState().ui.dashboardEditMode?.[V_DASHBOARD_ID]).toBeFalsy();
  });
});

// ─── Viewer role: agent CreateFile is rejected ────────────────────────────────

describe('Viewer role: agent CreateFile is rejected', () => {
  setupTestDb(getTestDbPath('viewer_readonly_ui'), { customInit: insertViewerDashboardAndQuestion });

  let testStore: ReturnType<typeof storeModule.makeStore>;
  let getStoreSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.requireMock('@/lib/auth/auth-helpers').getEffectiveUser.mockResolvedValue(VIEWER_EFFECTIVE_USER);

    const pythonPort = sharedPythonPort();
    const llmPort = sharedLLMMockPort?.();

    testStore = storeModule.makeStore();
    testStore.dispatch(setUser(VIEWER_AUTH_USER));
    getStoreSpy = jest.spyOn(storeModule, 'getStore').mockReturnValue(testStore);

    global.fetch = makeViewerApiFetch({ pythonPort, llmPort });
  });

  afterEach(() => {
    global.fetch = realFetch;
    getStoreSpy.mockRestore();
  });

  it('returns a permission error when viewer agent tries to CreateFile', async () => {
    const mockServer = sharedGetLLMMockServer!();
    await mockServer.reset();
    await mockServer.configure([
      {
        response: {
          content: '',
          role: 'assistant',
          tool_calls: [{
            id: 'tc_viewer_create_q',
            type: 'function',
            function: {
              name: 'CreateFile',
              arguments: JSON.stringify({
                file_type: 'question',
                name: 'Sneaky Question',
                path: '/org',
                content: { query: 'SELECT 1', vizSettings: { type: 'table' }, connection_name: '' },
              }),
            },
          }],
          finish_reason: 'tool_calls',
        },
        usage: { total_tokens: 120, prompt_tokens: 90, completion_tokens: 30 },
      },
      {
        response: {
          content: "I'm sorry, your viewer role does not allow creating files.",
          role: 'assistant',
          tool_calls: [],
          finish_reason: 'stop',
        },
        usage: { total_tokens: 50, prompt_tokens: 30, completion_tokens: 20 },
      },
    ]);

    const fileCountBefore = Object.keys(testStore.getState().files.files).length;

    const CONV_ID = -800;
    testStore.dispatch(createConversation({
      conversationID: CONV_ID,
      agent: 'AnalystAgent',
      agent_args: { goal: 'Create a new question' },
    }));
    testStore.dispatch(sendMessage({
      conversationID: CONV_ID,
      message: 'Create a new question called Sneaky Question',
    }));

    const realConvId = await waitForConversationFinished(
      () => testStore.getState() as RootState,
      CONV_ID,
    );

    const conv = selectConversation(testStore.getState() as RootState, realConvId);
    expect(conv?.error).toBeUndefined();

    const fileCountAfter = Object.keys(testStore.getState().files.files).length;
    expect(fileCountAfter).toBe(fileCountBefore);

    const toolMsg = conv?.messages.find(
      m => m.role === 'tool' && (m as any).tool_call_id === 'tc_viewer_create_q'
    );
    expect(toolMsg).toBeDefined();
    const rawContent = (toolMsg as any)?.content;
    const resultPayload =
      typeof rawContent === 'string' ? JSON.parse(rawContent) : rawContent;
    expect(resultPayload?.success).toBe(false);
    expect(resultPayload?.error).toMatch(/viewer|permission|create/i);
  }, 45000);
});

// ─── Viewer role: agent EditFile on dashboard is rejected ─────────────────────

describe('Viewer role: agent EditFile on dashboard is rejected', () => {
  setupTestDb(getTestDbPath('viewer_readonly_ui'), { customInit: insertViewerDashboardAndQuestion });

  let testStore: ReturnType<typeof storeModule.makeStore>;
  let getStoreSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.requireMock('@/lib/auth/auth-helpers').getEffectiveUser.mockResolvedValue(VIEWER_EFFECTIVE_USER);

    const pythonPort = sharedPythonPort();
    const llmPort = sharedLLMMockPort?.();

    testStore = storeModule.makeStore();
    testStore.dispatch(setUser(VIEWER_AUTH_USER));
    getStoreSpy = jest.spyOn(storeModule, 'getStore').mockReturnValue(testStore);

    testStore.dispatch(setFile({ file: makeViewerDashboardDbFile(), references: [] }));
    testStore.dispatch(setFile({ file: makeViewerQuestionDbFile(), references: [] }));

    global.fetch = makeViewerApiFetch({ pythonPort, llmPort });
  });

  afterEach(() => {
    global.fetch = realFetch;
    getStoreSpy.mockRestore();
  });

  it('returns a permission error when agent calls EditFile on a dashboard as a viewer', async () => {
    const mockServer = sharedGetLLMMockServer!();
    await mockServer.reset();
    await mockServer.configure([
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
                fileId: V_DASHBOARD_ID,
                changes: [{
                  oldMatch: '"assets":[]',
                  newMatch: `"assets":[{"type":"question","id":${V_QUESTION_ID}}]`,
                }],
              }),
            },
          }],
          finish_reason: 'tool_calls',
        },
        usage: { total_tokens: 150, prompt_tokens: 120, completion_tokens: 30 },
      },
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

    const conv = selectConversation(testStore.getState() as RootState, realConvId);
    expect(conv?.error).toBeUndefined();

    const dashState = testStore.getState().files.files[V_DASHBOARD_ID];
    const mergedAssets = (
      ((dashState?.persistableChanges as Partial<DashboardContent>) ?? {})?.assets
      ?? (dashState?.content as DashboardContent)?.assets
      ?? []
    );
    expect(mergedAssets).toHaveLength(0);

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
  }); // end Viewer role: agent EditFile on dashboard is rejected

}); // end UI Agent E2E Suites
