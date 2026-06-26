// Regression test for the "Enter sends nothing, message disappears" bug.
//
// Both ChatInput and the LexicalMentionEditor inside it use React.memo with
// custom comparators that DELIBERATELY ignore callback identity (`onSend`,
// `onSubmit`) — they assume the parent passes a reference-stable callback so
// the editor's KEY_ENTER_COMMAND can be registered once via useEffect.
//
// If ChatInterface passes a fresh closure each render, the comparators skip
// re-renders, the editor's first-mount `onSubmit` closure stays bound, the
// Enter handler keeps invoking THAT closure (which closes over `input=''` from
// mount time), so handleSend's `if (input.trim())` guard short-circuits and
// no message is sent — but Lexical still clears the editor afterwards, hence
// "the message disappears and nothing happens". The Run button works because
// it goes through ChatInput's *current* handleSend closure on each click.
//
// The contract this test pins: ChatInterface MUST pass a reference-stable
// onSend to ChatInput.

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

// ChatInput mock: records the onSend reference passed on each render.
const captured: { onSends: Array<(input: string, attachments?: unknown[]) => void> } = { onSends: [] };
vi.mock('@/components/explore/ChatInput', () => ({
  __esModule: true,
  default: (props: { onSend: (input: string, attachments?: unknown[]) => void }) => {
    captured.onSends.push(props.onSend);
    return React.createElement('div', { 'aria-label': 'chat input mock' });
  },
}));

import { createConversation, addStreamingMessage } from '@/store/chatSlice';
import * as storeModule from '@/store/store';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import ChatInterface from '@/components/explore/ChatInterface';

describe('ChatInterface onSend stability contract', () => {
  beforeAll(() => {
    Element.prototype.scrollTo = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { search: '?v=2', origin: 'http://localhost:3000', pathname: '/explore' },
      writable: true, configurable: true,
    });
  });

  it('passes a reference-stable onSend to ChatInput across re-renders', async () => {
    const store = storeModule.makeStore();
    vi.spyOn(storeModule, 'getStore').mockReturnValue(store);

    store.dispatch(createConversation({ conversationID: 1, agent: 'AnalystAgent' }));
    captured.onSends = [];

    renderWithProviders(
      <ChatInterface contextPath="/org/context" container="page" appState={null} />,
      { store },
    );

    // Wait for initial render to settle, then capture the baseline ref.
    await new Promise((r) => setTimeout(r, 30));
    expect(captured.onSends.length).toBeGreaterThan(0);
    const firstOnSend = captured.onSends[0];

    // Force several re-renders by mutating Redux state. Each one would, with
    // the bug, produce a fresh handleSendMessage closure on the parent — but
    // because ChatInput's memo skips those re-renders, ChatInput still holds
    // the FIRST onSend it ever received. The fix makes the FIRST onSend a
    // stable wrapper that always calls the latest impl.
    for (let i = 0; i < 5; i++) {
      store.dispatch(
        addStreamingMessage({
          conversationID: 1,
          type: 'StreamedThinking',
          payload: { chunk: `chunk ${i}` },
        }),
      );
      await new Promise((r) => setTimeout(r, 5));
    }
    await new Promise((r) => setTimeout(r, 30));

    // Every onSend the parent passed must be === to the first one.
    // (Strict-equal because the comparator literally checks `===` after the
    // ignore list, and React.memo bypass requires this anyway.)
    for (const seen of captured.onSends) {
      expect(seen).toBe(firstOnSend);
    }
  });
});
