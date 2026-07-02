// Gate contract for the "Conversation too long" lock-out.
//
// Background: ChatInterface replaces the chat input with a hard "Conversation
// too long — start a new chat" banner once a turn's LLM call exceeds the token
// limit. `total_tokens` is the whole-conversation context (the full prompt is
// re-sent every call), so a single large query could trip it on turn one — but
// starting a fresh chat there is useless (it re-runs the same query and hits
// the same size). The gate must therefore only fire once there is more than one
// user turn of history to actually shed by starting over.
//
// This pins the contract: over-limit + 1 user message → input stays usable
// (no banner); over-limit + 2 user messages → banner replaces the input.

import React from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined, DB_PATH: undefined, DB_DIR: undefined, getDbType: () => 'pglite' as const,
}));
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

import { loadConversation, type Conversation, type DebugMessage, type UserMessage } from '@/store/chatSlice';
import * as storeModule from '@/store/store';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import ChatInterface from '@/components/explore/ChatInterface';

const TS = '2026-06-02T00:00:00.000Z';

function userMsg(content: string): UserMessage {
  return { role: 'user', content, created_at: TS };
}

function debugWithTokens(total_tokens: number): DebugMessage {
  return {
    role: 'debug',
    task_unique_id: 'task-1',
    duration: 1,
    created_at: TS,
    llmDebug: [{
      model: 'claude', duration: 1, total_tokens,
      prompt_tokens: total_tokens - 1_000, completion_tokens: 1_000, cost: 0,
    }],
  };
}

function makeConversation(userMessages: number, tokens = 300_000): Conversation {
  const messages: Conversation['messages'] = [];
  for (let i = 0; i < userMessages; i++) {
    messages.push(userMsg(`question ${i + 1}`));
  }
  messages.push(debugWithTokens(tokens));
  return {
    _id: `conv-${userMessages}`,
    conversationID: 1,
    log_index: messages.length,
    executionState: 'FINISHED',
    messages,
    pending_tool_calls: [],
    agent: 'AnalystAgent',
    agent_args: {},
    streamedCompletedToolCalls: [],
    streamedThinking: '',
  };
}

describe('Conversation too long gate', () => {
  beforeAll(() => {
    Element.prototype.scrollTo = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { search: '?v=2', origin: 'http://localhost:3000', pathname: '/explore' },
      writable: true, configurable: true,
    });
  });

  it('does NOT show the gate when over-limit on a single-query conversation', async () => {
    const store = storeModule.makeStore();
    vi.spyOn(storeModule, 'getStore').mockReturnValue(store);
    store.dispatch(loadConversation({ conversation: makeConversation(1), setAsActive: true }));

    const { findByLabelText, queryByLabelText } = renderWithProviders(
      <ChatInterface contextPath="/org/context" container="page" appState={null} />,
      { store },
    );

    // Input stays usable...
    expect(await findByLabelText('chat input')).toBeTruthy();
    // ...and the lock-out banner is absent.
    expect(queryByLabelText('conversation too long warning')).toBeNull();
  });

  it('shows the gate when over the limit (150k) with 2+ user messages', async () => {
    const store = storeModule.makeStore();
    vi.spyOn(storeModule, 'getStore').mockReturnValue(store);
    store.dispatch(loadConversation({ conversation: makeConversation(2, 300_000), setAsActive: true }));

    const { findByLabelText, queryByLabelText } = renderWithProviders(
      <ChatInterface contextPath="/org/context" container="page" appState={null} />,
      { store },
    );

    // Banner replaces the input.
    expect(await findByLabelText('conversation too long warning')).toBeTruthy();
    expect(queryByLabelText('chat input')).toBeNull();
  });

  it('does NOT gate a normal turn under the limit (~100k), even with 2+ messages', async () => {
    // The threshold must sit below the model window (~200k-400k) so it warns before the hard error,
    // but a normal turn well under it stays usable — no naggy lock-out.
    const store = storeModule.makeStore();
    vi.spyOn(storeModule, 'getStore').mockReturnValue(store);
    store.dispatch(loadConversation({ conversation: makeConversation(2, 100_000), setAsActive: true }));

    const { findByLabelText, queryByLabelText } = renderWithProviders(
      <ChatInterface contextPath="/org/context" container="page" appState={null} />,
      { store },
    );

    expect(await findByLabelText('chat input')).toBeTruthy();
    expect(queryByLabelText('conversation too long warning')).toBeNull();
  });
});
