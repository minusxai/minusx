// Phase 3 — TRUE end-to-end UI test for chat-v2.
//
// Drives the entire stack:
//   1. PGLite test DB with a connection (cached schema), a context file
//      whitelisting only the `users` table, and a fixture file to edit.
//   2. ChatV2Container rendered in jsdom.
//   3. /api/chat/v2/stream handler intercepted in-process via setupMockFetch
//      so the listener actually round-trips through the SSE pipe.
//   4. Faux LLM (`webAnalystFaux`) drives two turns:
//        Turn 1 — backend `SearchDBSchema(connection='test-conn', query='users')`
//                 → assert only `users` returned (whitelist enforced) AND
//                 → faux saw the context docs in the system prompt.
//        Turn 2 — frontend `EditFile(fileId, changes)` → bridge
//                 invokes the registered handler against real Redux → resume.
//   5. Final assertions on Redux state and the chat log.

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

const { mockRouterPush } = vi.hoisted(() => ({ mockRouterPush: vi.fn() }));
vi.mock('next/navigation', async () => {
  const actual = await vi.importActual<typeof import('next/navigation')>('next/navigation');
  return {
    ...actual,
    useRouter: () => ({
      push: mockRouterPush,
      replace: vi.fn(),
      back: vi.fn(),
      prefetch: vi.fn(),
    }),
    usePathname: () => '/f/100',
    useSearchParams: () => new URLSearchParams(),
  };
});

vi.mock('@/lib/navigation/NavigationGuardProvider', () => ({
  useNavigationGuard: () => ({
    navigate: vi.fn(),
    isBlocked: false,
    confirmNavigation: vi.fn(),
    cancelNavigation: vi.fn(),
  }),
  NavigationGuardProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/components/Markdown', () => {
  const React = require('react');
  const MarkdownMock = ({ children }: { children?: unknown }) =>
    React.createElement('span', { 'aria-label': 'markdown-stub' }, String(children ?? ''));
  return { __esModule: true, default: MarkdownMock };
});

import React from 'react';
import { screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  fauxAssistantMessage,
  fauxToolCall,
  type Context as PiContext,
} from '@mariozechner/pi-ai';
import { POST as chatV2StreamHandler } from '@/app/api/chat/v2/stream/route';
import { fauxRegistration as webAnalystFaux } from '@/agents/web-analyst/web-analyst';
import { setSchemaSource, resetSources } from '@/agents/benchmark-analyst/sources';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import * as storeModule from '@/store/store';
import { makeStore } from '@/store/store';
import { setupTestDb } from '@/test/harness/test-db';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { DocumentDB } from '@/lib/database/documents-db';
import { setFile, selectFile, selectMergedContent } from '@/store/filesSlice';
import { setUser } from '@/store/authSlice';
import ChatV2Container from '@/components/containers/ChatV2Container';
import { selectChatV2 } from '@/store/chatV2Slice';
import type { ContextContent, ConnectionContent, DbFile, QuestionContent } from '@/lib/types';
import type { ConversationLog, ConversationLogEntry } from '@/orchestrator/types';

const TEST_DB_PATH = getTestDbPath('chat_v2_true_e2e');

describe('Chat V2 — TRUE end-to-end (whitelist + context docs + bridge → real Redux)', () => {
  setupTestDb(TEST_DB_PATH, { withTestConnection: false });

  // Custom fetch that PRESERVES the streaming Response (setupMockFetch's
  // interceptor calls .json() which would mangle text/event-stream bodies).
  // Routes /api/chat/v2/stream to the in-process Next.js handler.
  let originalFetch: typeof fetch;
  beforeAll(() => {
    originalFetch = global.fetch;
    const patchedFetch: typeof fetch = async (input, init) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url.includes('/api/chat/v2/stream')) {
        const { NextRequest } = await import('next/server');
        const req = new NextRequest(
          url.startsWith('http') ? url : `http://localhost:3000${url}`,
          { method: init?.method ?? 'POST', body: init?.body as BodyInit | undefined, headers: init?.headers },
        );
        return chatV2StreamHandler(req);
      }
      return originalFetch(input, init);
    };
    global.fetch = patchedFetch;
  });
  afterAll(() => { global.fetch = originalFetch; });

  let connId: number;
  let contextId: number;
  let chatId: number;
  let editTargetId: number;
  let editTargetContent: QuestionContent;
  let lastSystemPromptSeen: string;
  // Captures the system prompt seen on the resume turn (Turn 2, after the
  // bridge sends back the EditFile result). The orchestrator reconstructs
  // the agent from the saved AgentInvocation context — this assertion proves
  // the whitelist + docs flow through resume, not just the first call.
  let resumeSystemPromptSeen: string;

  beforeEach(async () => {
    lastSystemPromptSeen = '';
    resumeSystemPromptSeen = '';

    // ── DB fixtures ──────────────────────────────────────────────────────────
    const connectionContent: ConnectionContent = {
      type: 'duckdb',
      config: {},
      schema: {
        schemas: [
          {
            schema: 'main',
            tables: [
              { table: 'users', columns: [{ name: 'id', type: 'INTEGER' }] },
              { table: 'orders', columns: [{ name: 'id', type: 'INTEGER' }] },
              { table: 'products', columns: [{ name: 'id', type: 'INTEGER' }] },
            ],
          },
        ],
        updated_at: new Date().toISOString(),
      },
    };
    // Note: DocumentDB.create defaults to draft=true; getFiles filters drafts
    // out so the contextLoader wouldn't see this connection. Publish via the
    // editId update path (mirrors the parity test pattern).
    connId = await DocumentDB.create('test-conn', '/org/database/test-conn', 'connection', connectionContent, []);
    await DocumentDB.update(connId, 'test-conn', '/org/database/test-conn', connectionContent, [], 'e2e-conn-publish');
    void connId;

    // Whitelist: only the 'users' table, plus a docs blob the LLM should see in
    // the system prompt.
    const contextContent: ContextContent = {
      published: { all: 1 },
      versions: [
        {
          version: 1,
          whitelist: [
            {
              name: 'test-conn',
              type: 'connection',
              children: [
                {
                  name: 'main',
                  type: 'schema',
                  children: [{ name: 'users', type: 'table' }],
                },
              ],
            },
          ],
          docs: [{ content: 'AGENT_DOCS_MARKER: only the users table is meaningful.', draft: false }],
          createdAt: new Date().toISOString(),
          createdBy: 1,
        },
      ],
      // The loader will overwrite these.
      fullSchema: [],
      fullDocs: [],
    };
    // The seed creates /org/context already; replace its content with our test fixture.
    const existingOrgCtx = await DocumentDB.getByPath('/org/context');
    if (existingOrgCtx) {
      contextId = existingOrgCtx.id;
      await DocumentDB.update(contextId, 'context', '/org/context', contextContent, [], 'e2e-context');
    } else {
      contextId = await DocumentDB.create('context', '/org/context', 'context', contextContent, []);
    }

    // The file the agent will edit via the frontend bridge — published so
    // permission checks pass; full content kept in `editTargetContent` so the
    // test can pre-populate Redux state (the real EditFile handler operates
    // off Redux, not a fresh DB read).
    editTargetContent = {
      description: '',
      query: 'SELECT 1',
      vizSettings: { type: 'table', xCols: [], yCols: [] },
      parameters: [],
      connection_name: 'test-conn',
    };
    editTargetId = await DocumentDB.create('edit-target', '/org/edit-target', 'question', editTargetContent, []);
    await DocumentDB.update(editTargetId, 'edit-target', '/org/edit-target', editTargetContent, [], 'e2e-edit-target-publish');

    // The chat itself (draft) — post-cleanup shape: content = { log: [] };
    // contextFileId is no longer stored on the chat. setupOrchestration's
    // buildServerAgentArgs falls back to the user's nearest-ancestor context
    // (which is /org/context, set above with the whitelist + AGENT_DOCS_MARKER).
    chatId = await DocumentDB.create(
      'New Chat',
      `/org/chats/draft-e2e-${Date.now()}.chat.json`,
      'chat',
      { log: [] },
      [],
    );

    // ── Schema source (returns ALL tables; chat-v2 must filter via whitelist) ──
    resetSources();
    setSchemaSource({
      async search(_query, _connection) {
        return [
          { table: 'users', columns: [{ name: 'id', type: 'INTEGER' }] },
          { table: 'orders', columns: [{ name: 'id', type: 'INTEGER' }] },
          { table: 'products', columns: [{ name: 'id', type: 'INTEGER' }] },
        ];
      },
    });

  });

  it('Turn 1: SearchDBSchema enforces whitelist; context docs reach the system prompt. Turn 2: EditFile via bridge mutates real Redux', async () => {
    // Faux LLM script. Use FauxResponseFactory for turn 1 so we can capture
    // the system prompt and assert that the context docs were injected.
    webAnalystFaux.setResponses([
      // Turn 1, call 1: emit SearchDBSchema.
      (context: PiContext) => {
        lastSystemPromptSeen = context.systemPrompt ?? '';
        return fauxAssistantMessage(
          [fauxToolCall(
            'SearchDBSchema',
            { connection: 'test-conn', query: 'users' },
            { id: 'sds_1' },
          )],
          { stopReason: 'toolUse' },
        );
      },
      // Turn 1, call 2: stop turn after seeing the SearchDBSchema result.
      fauxAssistantMessage('Found the users table.', { stopReason: 'stop' }),
      // Turn 2, call 1: emit EditFile (frontend tool — bridge resolves it
      // against the REAL registered handler in lib/api/tool-handlers.ts).
      // Args use the real handler's shape: `changes: [{oldMatch, newMatch}]`.
      fauxAssistantMessage(
        [fauxToolCall(
          'EditFile',
          {
            fileId: editTargetId,
            changes: [{ oldMatch: '"query":"SELECT 1"', newMatch: '"query":"SELECT 2"' }],
          },
          { id: 'ef_1' },
        )],
        { stopReason: 'toolUse' },
      ),
      // Turn 2, call 2: factory captures the resume-turn system prompt (so
      // we can assert context docs survive across orchestrator resume), then
      // emits a stop turn.
      (context: PiContext) => {
        resumeSystemPromptSeen = context.systemPrompt ?? '';
        return fauxAssistantMessage('Edit applied.', { stopReason: 'stop' });
      },
    ]);

    // Use a full app-store (all slices + listeners) so useFile/filesSlice
    // works AND the chatV2Listener fires. Share with getStore() so the real
    // EditFile handler (which calls getStore()) hits the same Redux instance.
    const store = makeStore();
    vi.spyOn(storeModule, 'getStore').mockReturnValue(store);

    // Pre-load the edit target into Redux as a published file with its full
    // content. The real EditFile handler reads from Redux to build its
    // string representation; `loadFiles` will see this as already-cached
    // (updatedAt > 0) and skip the network fetch.
    const editTargetDbFile: DbFile = {
      id: editTargetId,
      name: 'edit-target',
      path: '/org/edit-target',
      type: 'question',
      content: editTargetContent,
      references: [],
      version: 1,
      last_edit_id: 'e2e-init',
      draft: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    store.dispatch(setFile({ file: editTargetDbFile, references: [] }));
    // Auth user (EditFile permission check reads from auth slice).
    store.dispatch(setUser({
      id: 1,
      email: 'test@example.com',
      name: 'Test User',
      role: 'admin',
      home_folder: '/org',
      mode: 'org',
    }));

    renderWithProviders(<ChatV2Container fileId={chatId} />, { store });

    // ── Turn 1 — backend SearchDBSchema with whitelist + context docs ──
    const textarea = await screen.findByLabelText('chat-input');
    await act(async () => { await userEvent.type(textarea, 'what tables are there?'); });
    const sendBtn = await screen.findByLabelText('chat-send');
    await act(async () => { await userEvent.click(sendBtn); });

    await waitFor(() => {
      const c = selectChatV2(store.getState(), chatId);
      expect(c).toBeDefined();
      expect(c!.executionState).toBe('finished');
    }, { timeout: 8000 });

    const c1 = selectChatV2(store.getState(), chatId)!;

    // The faux factory captured the system prompt — the context docs marker
    // must appear in it (proves runChatTurn loaded the context file and
    // injected docs via RemoteAnalystAgent.getSystemPrompt).
    expect(lastSystemPromptSeen).toContain('AGENT_DOCS_MARKER');

    // SearchDBSchema toolResult must have ONLY the whitelisted `users` table.
    const sdsResult = findToolResult(c1.log, 'sds_1');
    expect(sdsResult).toBeDefined();
    const tablesReturned = parseTableNamesFromText(sdsResult!);
    expect(tablesReturned).toEqual(['users']);
    expect(tablesReturned).not.toContain('orders');
    expect(tablesReturned).not.toContain('products');

    // ── Turn 2 — frontend EditFile via bridge → REAL Redux mutation ──
    // Sanity: file Redux state starts with query='SELECT 1'.
    expect((selectMergedContent(store.getState(), editTargetId) as QuestionContent).query)
      .toBe('SELECT 1');

    await act(async () => { await userEvent.type(textarea, 'now edit the file'); });
    await act(async () => { await userEvent.click(sendBtn); });

    await waitFor(() => {
      const c = selectChatV2(store.getState(), chatId);
      // After the resume turn the executionState should be 'finished'
      // (stop-turn from the second resume cycle). We also need the EditFile
      // tool result in the log.
      if (!c || c.executionState !== 'finished') return false;
      return findToolResult(c.log, 'ef_1') !== undefined;
    }, { timeout: 8000 });

    const c2 = selectChatV2(store.getState(), chatId)!;

    // The REAL EditFile handler ran against real Redux: file content changed
    // from 'SELECT 1' to 'SELECT 2' via the bridge's executeToolCall →
    // editFileStr → Redux dispatch chain.
    const mergedAfter = selectMergedContent(store.getState(), editTargetId) as QuestionContent;
    expect(mergedAfter.query).toBe('SELECT 2');
    // Other content fields untouched.
    expect(mergedAfter.connection_name).toBe('test-conn');
    expect(mergedAfter.vizSettings.type).toBe('table');

    // The file's persistableChanges in Redux now reflects the edit
    // (editFileStr dispatches via filesSlice.editFile, which records dirty
    // overrides on FileState.persistableChanges before save).
    const fileStateAfter = selectFile(store.getState(), editTargetId);
    expect(fileStateAfter).toBeDefined();
    expect(
      (fileStateAfter!.persistableChanges as { query?: string } | undefined)?.query,
    ).toBe('SELECT 2');

    // EditFile tool result is in the log and indicates success.
    const efResult = findToolResult(c2.log, 'ef_1');
    expect(efResult).toBeDefined();
    expect(efResult).toContain('"success":true');

    // Final stop turn from the LLM after the EditFile result.
    const finalStop = [...c2.log].reverse().find(
      (e: ConversationLogEntry) =>
        'role' in e && e.role === 'assistant' &&
        (e as { stopReason?: string }).stopReason === 'stop',
    );
    expect(finalStop).toBeDefined();

    // The resume-turn system prompt also carried the context docs — proves
    // the orchestrator preserved the agent context (whitelistedTables +
    // contextDocs) across the UIE pause / bridge / resume cycle.
    expect(resumeSystemPromptSeen).toContain('AGENT_DOCS_MARKER');
  });
});

// ── Helpers ────────────────────────────────────────────────────────────────

function findToolResult(log: ConversationLog, toolCallId: string): string | undefined {
  for (const entry of log) {
    if (!('role' in entry) || entry.role !== 'toolResult') continue;
    if (entry.toolCallId !== toolCallId) continue;
    return entry.content
      .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
  }
  return undefined;
}

function parseTableNamesFromText(text: string): string[] {
  try {
    const parsed = JSON.parse(text) as Array<{ table: string }>;
    return parsed.map((r) => r.table);
  } catch {
    return [];
  }
}
