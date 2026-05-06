// Phase-3 UI tests: chats list view, chat detail rendering, streaming consumer.
// Pattern follows the existing *.ui.test.tsx infrastructure (jsdom, aria-label
// queries only, renderWithProviders).

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
    usePathname: () => '/chats',
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

vi.mock('@/components/Breadcrumb', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: () => React.createElement('div', { 'aria-label': 'breadcrumb-stub' }),
  };
});

vi.mock('@/lib/hooks/file-state-hooks', async () => {
  const actual = await vi.importActual<typeof import('@/lib/hooks/file-state-hooks')>(
    '@/lib/hooks/file-state-hooks',
  );
  return {
    ...actual,
    useFilesByCriteria: vi.fn(),
    useFile: vi.fn(),
  };
});

import React from 'react';
import { screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useFilesByCriteria, useFile } from '@/lib/hooks/file-state-hooks';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { makeStore } from '@/store/store';
import ChatsPage from '@/app/chats/page';
import ChatV2Container from '@/components/containers/ChatV2Container';
import {
  loadChatV2,
  sendChatV2Message,
  selectChatV2,
} from '@/store/chatV2Slice';
import { setUseChatV2 } from '@/store/uiSlice';
import { resolveUseChatV2 } from '@/lib/chat-v2/use-chat-v2';
import type { ConversationLog } from '@/orchestrator/types';

const mockedUseFilesByCriteria = useFilesByCriteria as unknown as ReturnType<typeof vi.fn>;
const mockedUseFile = useFile as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockedUseFilesByCriteria.mockReset();
  mockedUseFile.mockReset();
  mockRouterPush.mockReset();
});

describe('Phase 3 UI — Chats list view', () => {
  it('renders chat rows from useFilesByCriteria and a "new chat" affordance', async () => {
    mockedUseFilesByCriteria.mockReturnValue({
      files: [
        { id: 101, name: 'Show top customers', path: '/org/chats/show-top.chat.json', type: 'chat', updatedAt: 1700000000 },
        { id: 102, name: 'Q3 revenue analysis', path: '/org/chats/q3-rev.chat.json', type: 'chat', updatedAt: 1700001000 },
      ],
      loading: false,
      error: null,
    });

    renderWithProviders(<ChatsPage />);

    expect(await screen.findByLabelText('chats-page-title')).toBeDefined();
    expect(await screen.findByLabelText('new-chat')).toBeDefined();
    const list = await screen.findByLabelText('chats-list');
    expect(list).toBeDefined();
    expect(await screen.findByLabelText('chat-row-101')).toBeDefined();
    expect(await screen.findByLabelText('chat-row-102')).toBeDefined();
  });

  it('shows empty state when there are no chats', async () => {
    mockedUseFilesByCriteria.mockReturnValue({ files: [], loading: false, error: null });
    renderWithProviders(<ChatsPage />);
    expect(await screen.findByLabelText('chats-empty-state')).toBeDefined();
  });
});

describe('Phase 3 UI — Chat detail rendering', () => {
  it('renders the user invocation, assistant text, and a tool-call entry from a known log', async () => {
    const fileId = 555;
    const log: ConversationLog = [
      {
        type: 'toolCall',
        id: 'root_ui',
        name: 'WebAnalystAgent',
        arguments: { userMessage: 'rename foo to bar' },
        context: { userId: '1', mode: 'org' },
        parent_id: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'I will edit that for you.' },
          {
            type: 'toolCall',
            id: 'edit_ui',
            name: 'EditFile',
            arguments: { fileId: 1, oldStr: 'foo', newStr: 'bar' },
          },
        ],
        stopReason: 'toolUse',
        parent_id: 'root_ui',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      {
        role: 'toolResult',
        toolCallId: 'edit_ui',
        toolName: 'EditFile',
        content: [{ type: 'text', text: 'Edit applied.' }],
        isError: false,
        timestamp: Date.now(),
        parent_id: 'root_ui',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'Done.' }],
        stopReason: 'stop',
        parent_id: 'root_ui',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    ];

    mockedUseFile.mockReturnValue({
      fileState: {
        id: fileId,
        name: 'rename foo to bar',
        type: 'chat',
        path: '/org/chats/rename.chat.json',
        loading: false,
        updatedAt: 1700000000,
        content: { log, agent: 'WebAnalystAgent', agent_args: {} },
      },
    });

    const store = makeStore();
    act(() => {
      store.dispatch(loadChatV2({ chatId: fileId, log }));
    });

    renderWithProviders(<ChatV2Container fileId={fileId} />, { store });

    expect(await screen.findByLabelText('chat-log')).toBeDefined();
    expect(await screen.findByLabelText('chat-message-user')).toBeDefined();
    expect(await screen.findAllByLabelText('chat-message-assistant')).toBeDefined();
    expect(await screen.findByLabelText('chat-tool-EditFile')).toBeDefined();
    expect(await screen.findByLabelText('chat-input')).toBeDefined();
    expect(await screen.findByLabelText('chat-send')).toBeDefined();
  });
});

describe('Phase 3 UI — Streaming consumer (SSE)', () => {
  beforeEach(() => {
    // Stub fetch to emit a real SSE response. Format mirrors the server route.
    const originalFetch = global.fetch;
    // Two orchestrator events — verifies streaming path. Final `done` frame
    // resolves with `done: 'stop'` so the listener doesn't loop into the
    // bridge (which would need a real Redux file fixture).
    const sseBody = [
      'event: orchestrator',
      'data: {"type":"start","parent_id":"root"}',
      '',
      'event: orchestrator',
      'data: {"type":"text","delta":"Hi","parent_id":"root"}',
      '',
      'event: done',
      'data: {"chatId":777,"forked":false,"log":[{"type":"toolCall","id":"root","name":"WebAnalystAgent","arguments":{"userMessage":"hi"},"context":{},"parent_id":null}],"pendingToolCalls":[],"done":"stop"}',
      '',
      '',
    ].join('\n');

    global.fetch = vi.fn(async (url: string | URL | Request) => {
      const u = url.toString();
      if (u.includes('/api/chat/v2/stream')) {
        return new Response(sseBody, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }
      return originalFetch(url);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;
  });

  it('listener consumes SSE incrementally — streamingEvents populates DURING the turn and is cleared by chatTurnCompleted', async () => {
    const store = makeStore();
    const chatId = 0;

    // Subscribe before dispatching so we capture the per-action state at
    // every step. We assert the listener actually pushed orchestrator events
    // into `streamingEvents` mid-stream (i.e., before the `done` frame
    // resets it), not just that the final state is consistent.
    let maxStreamingEventsSeen = 0;
    const unsubscribe = store.subscribe(() => {
      const c = selectChatV2(store.getState(), chatId) ?? selectChatV2(store.getState(), 777);
      if (c && c.streamingEvents.length > maxStreamingEventsSeen) {
        maxStreamingEventsSeen = c.streamingEvents.length;
      }
    });

    await act(async () => {
      store.dispatch(sendChatV2Message({ chatId, message: 'hi' }));
    });

    // Wait for the chatTurnCompleted to land (chatV2 chats[777] populated).
    await waitFor(() => {
      const c = selectChatV2(store.getState(), 777);
      expect(c).toBeDefined();
      expect(c!.log.length).toBeGreaterThan(0);
      expect(c!.executionState).toBe('finished');
    }, { timeout: 5000 });

    unsubscribe();

    // The SSE body we mocked emits two `event: orchestrator` frames before
    // the `done` frame. Verify the listener saw both before the canonical
    // log replaced them.
    expect(maxStreamingEventsSeen).toBeGreaterThanOrEqual(2);

    // After done: canonical log supersedes the streaming buffer, no pending.
    const finalState = selectChatV2(store.getState(), 777);
    expect(finalState!.streamingEvents).toEqual([]);
    expect(finalState!.pendingToolCalls).toEqual([]);
  });
});

describe('Phase 3 UI — end-to-end user journey', () => {
  // Walks the entire path the user actually takes:
  //   1. Toggle is off → resolveUseChatV2 says "Conversations" surface.
  //   2. Toggle is on → resolveUseChatV2 says "Chats" surface.
  //   3. Click "New Chat" on /chats → fetch /api/chat/v2/new → router pushed
  //      to /f/<newId>.
  //   4. ChatV2Container loads the new draft → user types → /api/chat/v2/stream
  //      drives a faux turn → executionState reaches 'finished' with log filled.

  beforeEach(() => {
    mockedUseFilesByCriteria.mockReset();
    mockedUseFile.mockReset();
    mockRouterPush.mockReset();
    mockedUseFilesByCriteria.mockReturnValue({ files: [], loading: false, error: null });
  });

  it('Step A — toggle gates which sidebar link shows', () => {
    // Off → Conversations.
    expect(resolveUseChatV2(false, '')).toBe(false);
    // On (pref) → Chats.
    expect(resolveUseChatV2(true, '')).toBe(true);
    // URL override forces Chats even when pref is off.
    expect(resolveUseChatV2(false, '?v=2')).toBe(true);
  });

  it('Step B — flipping setUseChatV2 updates the live store value', () => {
    const store = makeStore();
    expect(store.getState().ui.useChatV2).toBe(false);
    act(() => { store.dispatch(setUseChatV2(true)); });
    expect(store.getState().ui.useChatV2).toBe(true);
  });

  it('Step C — clicking "New Chat" hits /api/chat/v2/new and routes to /f/<chatId>', async () => {
    const originalFetch = global.fetch;
    const fetchSpy = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = url.toString();
      if (u.includes('/api/chat/v2/new') && init?.method === 'POST') {
        return new Response(JSON.stringify({ chatId: 4242 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return originalFetch(url);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;
    global.fetch = fetchSpy;

    try {
      renderWithProviders(<ChatsPage />);
      const newChatBtn = await screen.findByLabelText('new-chat');
      await act(async () => {
        await userEvent.click(newChatBtn);
      });

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalled();
        const calledNew = fetchSpy.mock.calls.some(
          (args: unknown[]) => String(args[0]).includes('/api/chat/v2/new'),
        );
        expect(calledNew).toBe(true);
      });
      await waitFor(() => {
        expect(mockRouterPush).toHaveBeenCalledWith('/f/4242');
      });
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('Step D — typing+sending in ChatV2Container drives /api/chat/v2/stream and reaches finished state', async () => {
    const fileId = 4242;

    // Mock useFile so ChatV2Container has a draft to render.
    mockedUseFile.mockReturnValue({
      fileState: {
        id: fileId,
        name: 'New Chat',
        type: 'chat',
        path: '/org/chats/draft-x.chat.json',
        loading: false,
        updatedAt: 1700000000,
        content: { log: [], agent: 'WebAnalystAgent', agent_args: {}, metadata: { updatedAt: '' } },
      },
    });

    const sseBody = [
      'event: orchestrator',
      'data: {"type":"start","parent_id":"root"}',
      '',
      'event: done',
      `data: ${JSON.stringify({
        chatId: fileId,
        forked: false,
        log: [
          {
            type: 'toolCall',
            id: 'root',
            name: 'WebAnalystAgent',
            arguments: { userMessage: 'hello world' },
            context: {},
            parent_id: null,
          },
          {
            role: 'assistant',
            content: [{ type: 'text', text: 'Hi there.' }],
            stopReason: 'stop',
            parent_id: 'root',
          },
        ],
        pendingToolCalls: [],
        done: 'stop',
      })}`,
      '',
      '',
    ].join('\n');

    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (url: string | URL | Request) => {
      const u = url.toString();
      if (u.includes('/api/chat/v2/stream')) {
        return new Response(sseBody, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }
      return originalFetch(url);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;

    try {
      const store = makeStore();
      renderWithProviders(<ChatV2Container fileId={fileId} />, { store });

      const textarea = await screen.findByLabelText('chat-input');
      await act(async () => {
        await userEvent.type(textarea, 'hello world');
      });

      const sendBtn = await screen.findByLabelText('chat-send');
      await act(async () => {
        await userEvent.click(sendBtn);
      });

      // Wait for finished state.
      await waitFor(() => {
        const c = selectChatV2(store.getState(), fileId);
        expect(c).toBeDefined();
        expect(c!.executionState).toBe('finished');
        expect(c!.log.length).toBeGreaterThanOrEqual(2);
      }, { timeout: 5000 });

      // Final assistant turn rendered.
      const finalLog = selectChatV2(store.getState(), fileId)!.log;
      const stopEntry = finalLog.find(
        (e) =>
          'role' in e && e.role === 'assistant' &&
          (e as { stopReason?: string }).stopReason === 'stop',
      );
      expect(stopEntry).toBeDefined();
    } finally {
      global.fetch = originalFetch;
    }
  });
});
