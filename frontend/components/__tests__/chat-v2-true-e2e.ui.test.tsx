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
//        Turn 2 — frontend `EditFile(fileId, oldStr, newStr)` → bridge
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
import {
  registerFrontendTool,
  type FrontendToolHandler,
} from '@/lib/api/tool-handlers';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import * as storeModule from '@/store/store';
import { makeStore } from '@/store/store';
import { setupTestDb } from '@/test/harness/test-db';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { DocumentDB } from '@/lib/database/documents-db';
import { setShowAdvanced } from '@/store/uiSlice';
import ChatV2Container from '@/components/containers/ChatV2Container';
import { selectChatV2 } from '@/store/chatV2Slice';
import type { ContextContent, ConnectionContent } from '@/lib/types';
import type { ConversationLog, ConversationLogEntry } from '@/orchestrator/types';

const TEST_DB_PATH = getTestDbPath('chat_v2_true_e2e');

// Save EditFile handler so we can restore after the test (registry is global).
const ORIGINAL_EDIT_FILE_HANDLER: FrontendToolHandler | undefined =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- internal registry probe
  (globalThis as any).__originalEditFile;

describe('Chat V2 — TRUE end-to-end (whitelist + context docs + bridge → real Redux)', () => {
  setupTestDb(TEST_DB_PATH, { withTestConnection: false });

  // Custom fetch that PRESERVES the streaming Response (setupMockFetch's
  // interceptor calls .json() which would mangle text/event-stream bodies).
  // Routes /api/chat/v2/stream to the in-process Next.js handler.
  let originalFetch: typeof fetch;
  beforeAll(() => {
    originalFetch = global.fetch;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    global.fetch = (async (input: any, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input?.url ?? input?.toString?.() ?? '';
      if (url.includes('/api/chat/v2/stream')) {
        const req = new (await import('next/server')).NextRequest(
          url.startsWith('http') ? url : `http://localhost:3000${url}`,
          { method: init?.method ?? 'POST', body: init?.body as BodyInit | undefined, headers: init?.headers as HeadersInit | undefined },
        );
        return chatV2StreamHandler(req);
      }
      return originalFetch(input, init);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;
  });
  afterAll(() => { global.fetch = originalFetch; });

  let connId: number;
  let contextId: number;
  let chatId: number;
  let editTargetId: number;
  let lastSystemPromptSeen: string;
  let editHandlerInvocations: Array<{ args: Record<string, unknown> }>;

  beforeEach(async () => {
    lastSystemPromptSeen = '';
    editHandlerInvocations = [];

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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ConnectionContent.schema shape is loose
      } as any,
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

    // The file the agent will "edit" via the frontend bridge.
    editTargetId = await DocumentDB.create(
      'edit-target',
      '/org/edit-target',
      'question',
      { description: '', query: 'SELECT 1', vizSettings: { type: 'table', xCols: [], yCols: [] }, parameters: [], connection_name: 'test-conn' },
      [],
    );

    // The chat itself (draft) — agentArgs carries the contextFileId so chat-v2's
    // shared.ts loader pulls the right whitelist/docs.
    chatId = await DocumentDB.create(
      'New Chat',
      `/org/chats/draft-e2e-${Date.now()}.chat.json`,
      'chat',
      {
        log: [],
        agent: 'WebAnalystAgent',
        agent_args: { contextFileId: contextId },
        metadata: { updatedAt: new Date().toISOString() },
      },
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

    // ── Override EditFile frontend handler with a verifiable test stub ──
    // The real handler depends on heavy file-state plumbing; we just need to
    // prove the bridge calls the registered handler with real Redux dispatch.
    registerFrontendTool('EditFile', async (args, ctx) => {
      editHandlerInvocations.push({ args });
      // Verifiable Redux mutation — proves dispatch is plumbed through.
      ctx.dispatch?.(setShowAdvanced(true));
      return {
        content: `edited fileId=${args.fileId} (${args.oldStr} → ${args.newStr})`,
        details: { success: true },
      };
    });
  });

  afterEach(() => {
    if (ORIGINAL_EDIT_FILE_HANDLER) {
      registerFrontendTool('EditFile', ORIGINAL_EDIT_FILE_HANDLER);
    }
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
      // Turn 2, call 1: emit EditFile (frontend tool — bridge resolves it).
      fauxAssistantMessage(
        [fauxToolCall(
          'EditFile',
          { fileId: editTargetId, oldStr: 'SELECT 1', newStr: 'SELECT 2' },
          { id: 'ef_1' },
        )],
        { stopReason: 'toolUse' },
      ),
      // Turn 2, call 2: stop turn after the bridge resolves EditFile.
      fauxAssistantMessage('Edit applied.', { stopReason: 'stop' }),
    ]);

    // Use a full app-store (all slices + listeners) so useFile/filesSlice
    // works AND the chatV2Listener fires. Share with getStore() so tool
    // handlers (which call getStore()) see the same Redux instance.
    const store = makeStore();
    vi.spyOn(storeModule, 'getStore').mockReturnValue(store);

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

    // ── Turn 2 — frontend EditFile via bridge ──
    expect(store.getState().ui.showAdvanced).toBe(false);
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

    // The bridge invoked the registered EditFile handler with the right args.
    expect(editHandlerInvocations).toHaveLength(1);
    expect(editHandlerInvocations[0].args).toMatchObject({
      fileId: editTargetId,
      oldStr: 'SELECT 1',
      newStr: 'SELECT 2',
    });

    // Real Redux mutation landed (proves dispatch was wired through).
    expect(store.getState().ui.showAdvanced).toBe(true);

    // EditFile tool result is present and includes the handler's content.
    const efResult = findToolResult(c2.log, 'ef_1');
    expect(efResult).toContain(`edited fileId=${editTargetId}`);
    expect(efResult).toContain('SELECT 1 → SELECT 2');

    // Final stop turn from the LLM after the EditFile result.
    const finalStop = c2.log.findLast?.(
      (e: ConversationLogEntry) =>
        'role' in e && e.role === 'assistant' &&
        (e as { stopReason?: string }).stopReason === 'stop',
    );
    expect(finalStop).toBeDefined();
  });
});

// ── Helpers ────────────────────────────────────────────────────────────────

function findToolResult(log: ConversationLog, toolCallId: string): string | undefined {
  for (const entry of log) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- log entries are a discriminated union
    const e = entry as any;
    if (e?.role === 'toolResult' && e.toolCallId === toolCallId) {
      const text = (e.content ?? [])
        .filter((c: { type?: string }) => c?.type === 'text')
        .map((c: { text: string }) => c.text)
        .join('\n');
      return text;
    }
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
