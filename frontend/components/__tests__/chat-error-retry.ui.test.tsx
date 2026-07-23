// Contract for the two-way error-retry affordance in ChatInterface.
//
// A failed chat turn is classified transient vs terminal (see classifyErrorRetryability):
//  - transient (network / 500 / 429 / timeout / unknown) → offer "Try again", which cleanly REPLAYS
//    the failed turn server-side (retryConversationTurn → manual autoRetry). It must NOT append a
//    "Continue" user bubble (the old behavior — pollutes the transcript and, for context-length,
//    just re-failed).
//  - terminal (context-length / auth / malformed) → NO "Try again"; the identical request would
//    re-fail, so steer the user to a fresh chat ("Start a new chat").
//
// This pins: transient error → "Try again" present, "Start a new chat" absent; terminal error →
// "Start a new chat" present, "Try again" absent; clicking "Try again" clears the error WITHOUT
// appending a "Continue" message.

import React from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/explore',
  useSearchParams: () => new URLSearchParams('v=2'),
}));
vi.mock('@/lib/navigation/NavigationGuardProvider', () => ({
  useNavigationGuard: () => ({ navigate: vi.fn(), isBlocked: false, confirmNavigation: vi.fn(), cancelNavigation: vi.fn() }),
  NavigationGuardProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/lib/hooks/useConfigs', () => ({ useConfigs: () => ({ config: { branding: { agentName: 'MinusX' } } }) }));
vi.mock('@/lib/hooks/useContext', () => ({
  useContext: () => ({ contextId: 1, databases: [], documentation: '', availableSkills: [], contextLoading: false }),
}));
vi.mock('@/components/Markdown', () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => React.createElement('span', null, children),
}));
vi.mock('@/components/explore/ChatInput', () => ({
  __esModule: true,
  default: () => React.createElement('div', { 'aria-label': 'chat input' }),
}));

import { loadConversation, selectConversation, type Conversation, type UserMessage } from '@/store/chatSlice';
import type { ErrorRetryability } from '@/lib/chat/error-retryability';
import * as storeModule from '@/store/store';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { fireEvent, waitFor } from '@testing-library/react';
import ChatInterface from '@/components/explore/ChatInterface';

const TS = '2026-06-02T00:00:00.000Z';

function userMsg(content: string): UserMessage {
  return { role: 'user', content, created_at: TS };
}

function makeErroredConversation(error: string, errorRetryability: ErrorRetryability): Conversation {
  return {
    _id: `conv-${errorRetryability}`,
    conversationID: 1,
    log_index: 1,
    executionState: 'FINISHED',
    messages: [userMsg('what is revenue?')],
    pending_tool_calls: [],
    agent: 'AnalystAgent',
    agent_args: {},
    error,
    errorRetryability,
    streamedCompletedToolCalls: [],
    streamedThinking: '',
  };
}

function renderWith(conv: Conversation) {
  const store = storeModule.makeStore();
  vi.spyOn(storeModule, 'getStore').mockReturnValue(store);
  store.dispatch(loadConversation({ conversation: conv, setAsActive: true }));
  const utils = renderWithProviders(
    <ChatInterface contextPath="/org/context" container="page" appState={null} />,
    { store },
  );
  return { ...utils, store };
}

describe('Chat error retry affordance', () => {
  beforeAll(() => {
    Element.prototype.scrollTo = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { search: '?v=2', origin: 'http://localhost:3000', pathname: '/explore' },
      writable: true, configurable: true,
    });
  });

  it('transient error → shows "Try again", not "Start a new chat"', async () => {
    const { findByLabelText, queryByLabelText } = renderWith(
      makeErroredConversation('Network error', 'transient'),
    );
    expect(await findByLabelText('Try again')).toBeTruthy();
    expect(queryByLabelText('Start a new chat')).toBeNull();
  });

  it('terminal error → shows "Start a new chat", not "Try again"', async () => {
    const { findByLabelText, queryByLabelText } = renderWith(
      makeErroredConversation('prompt is too long: 250000 tokens > 200000 maximum', 'terminal'),
    );
    expect(await findByLabelText('Start a new chat')).toBeTruthy();
    expect(queryByLabelText('Try again')).toBeNull();
  });

  // A context overflow and a bad API key are both terminal, but only ONE of them is fixed by
  // starting a new chat. Telling an admin with an expired key that the conversation "grew too
  // long" sends them down entirely the wrong path.
  it('a provider auth failure points at Settings → Models, not at conversation length', async () => {
    const { findByLabelText, queryByLabelText, container } = renderWith(makeErroredConversation(
      '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
      'terminal',
    ));
    expect(await findByLabelText('Open model settings')).toBeTruthy();
    expect(container.textContent).toMatch(/Settings → Models/);
    expect(container.textContent).not.toMatch(/grown too long/);
    // "Start a new chat" cannot help — the next chat fails identically.
    expect(queryByLabelText('Start a new chat')).toBeNull();
    expect(queryByLabelText('Try again')).toBeNull();
  });

  it('a context overflow still steers to a new chat', async () => {
    const { findByLabelText, container } = renderWith(makeErroredConversation(
      'prompt is too long: 250000 tokens > 200000 maximum',
      'terminal',
    ));
    expect(await findByLabelText('Start a new chat')).toBeTruthy();
    expect(container.textContent).toMatch(/grown too long/);
  });

  it('clicking "Try again" clears the error WITHOUT appending a "Continue" message', async () => {
    // Hang the network so the retry listener stays pending and never re-sets the error — we assert
    // only the synchronous reducer effect of retryConversationTurn (error cleared, no new bubble).
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    try {
      const { store, findByLabelText } = renderWith(makeErroredConversation('Network error', 'transient'));
      const btn = await findByLabelText('Try again');
      fireEvent.click(btn);
      await waitFor(() => {
        const conv = selectConversation(store.getState(), 1);
        expect(conv?.error).toBeUndefined();
      });
      const conv = selectConversation(store.getState(), 1);
      // The old bug appended a 'Continue' user message; the replay path must not.
      expect(conv?.messages.some((m) => m.role === 'user' && (m as UserMessage).content === 'Continue')).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
