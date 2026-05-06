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
