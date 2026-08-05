// The two surfaces of the conversation-size limit, which are NOT the same mechanism.
//
//  1. The pre-emptive gate: ChatInterface replaces the composer once the conversation's last
//     stamped context size is over TOKEN_LIMIT, so the user never writes a message that would be
//     refused. This is an AFFORDANCE — `runConversationTurn` is the enforcement, and it runs for
//     Slack and scheduled jobs too. Both call the same predicate (`conversationTooLong`) so the
//     browser can never disagree with the server about where the line is.
//  2. The banner after a refusal: when the server does refuse (or a turn aborts mid-run), the
//     error carries a typed reason and the banner says exactly what happened.
//
// The signal behind (1) is `lastContextTokens` — the last LLM call's `usage.totalTokens`, stamped
// server-side at turn end (the full prompt is re-sent every call, so it IS the whole-conversation
// context). It rides the conversation row, so the gate works on reload for every role.
//
// A single large query could trip the limit on turn one — but starting a fresh chat there is
// useless (it re-runs the same query and hits the same size). The gate must therefore only fire
// once there is more than one user turn of history to actually shed.

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

import { loadConversation, type Conversation, type UserMessage } from '@/store/chatSlice';
import * as storeModule from '@/store/store';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import ChatInterface from '@/components/explore/ChatInterface';
import ChatErrorBanner from '@/components/explore/ChatErrorBanner';
import { TOKEN_LIMIT } from '@/lib/chat/conversation-limits';

const TS = '2026-06-02T00:00:00.000Z';

function userMsg(content: string): UserMessage {
  return { role: 'user', content, created_at: TS };
}

function makeConversation(userMessages: number, tokens = TOKEN_LIMIT + 1): Conversation {
  const messages: Conversation['messages'] = [];
  for (let i = 0; i < userMessages; i++) {
    messages.push(userMsg(`question ${i + 1}`));
  }
  return {
    lastContextTokens: tokens,
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

function mountChat(conversation: Conversation) {
  const store = storeModule.makeStore();
  vi.spyOn(storeModule, 'getStore').mockReturnValue(store);
  store.dispatch(loadConversation({ conversation, setAsActive: true }));
  return renderWithProviders(
    <ChatInterface contextPath="/org/context" container="page" appState={null} />,
    { store },
  );
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
    const { findByLabelText, queryByLabelText } = mountChat(makeConversation(1));

    // Input stays usable...
    expect(await findByLabelText('chat input')).toBeTruthy();
    // ...and the lock-out banner is absent.
    expect(queryByLabelText('conversation too long warning')).toBeNull();
  });

  it('shows the gate when over the limit with 2+ user messages', async () => {
    const { findByLabelText, queryByLabelText } = mountChat(makeConversation(2, TOKEN_LIMIT * 2));

    // Banner replaces the input.
    expect(await findByLabelText('conversation too long warning')).toBeTruthy();
    expect(queryByLabelText('chat input')).toBeNull();
  });

  it('gates one token over the limit — the browser reads the same TOKEN_LIMIT the server enforces', async () => {
    // The discriminating case: this conversation is over the shared limit but under the old
    // hardcoded 300k, so it only gates if the component really is reading `conversationTooLong`.
    const { findByLabelText, queryByLabelText } = mountChat(makeConversation(2, TOKEN_LIMIT + 1));

    expect(await findByLabelText('conversation too long warning')).toBeTruthy();
    expect(queryByLabelText('chat input')).toBeNull();
  });

  it('does NOT gate a conversation exactly AT the limit — the limit is a ceiling to exceed', async () => {
    const { findByLabelText, queryByLabelText } = mountChat(makeConversation(2, TOKEN_LIMIT));

    expect(await findByLabelText('chat input')).toBeTruthy();
    expect(queryByLabelText('conversation too long warning')).toBeNull();
  });
});

// The post-refusal surface. Before the typed reason existed, every terminal error fell back to one
// hedged sentence ("may have grown too long or hit a limit") because the classifier was GUESSING
// from provider prose. When the refusal is ours we know exactly what happened and can say so.
describe('Terminal error banner — conversation too long', () => {
  const bannerProps = {
    error: 'This conversation exceeds the token limit (250000 tokens > 200000). Start a new chat to keep going.',
    isTerminalError: true,
    devMode: false,
    colSpan: 12,
    colStart: 1,
    conversationID: 1,
    handleNewChat: vi.fn(),
  };

  it('states the length limit plainly when the typed reason says so', async () => {
    const { findByText, findByLabelText } = renderWithProviders(
      <ChatErrorBanner {...bannerProps} terminalReason="conversation_too_long" />,
    );

    expect(await findByText(/reached its length limit/i)).toBeTruthy();
    expect(await findByLabelText('Start a new chat')).toBeTruthy();
  });

  it('falls back to message classification when no typed reason is present', async () => {
    const { findByText } = renderWithProviders(<ChatErrorBanner {...bannerProps} />);

    // The hedged context_length copy — correct, just less specific.
    expect(await findByText(/can't continue/i)).toBeTruthy();
  });
});
