// Re-render perf test for ChatInterface.
//
// Background: a perf trace showed ChatInterface re-rendering on every streaming
// chunk because two of its useAppSelector calls returned the whole `conversations`
// map / `queryResults.results` map. When *any* conversation entry was mutated by a
// streaming event, the map identity changed and the parent re-rendered, cascading
// down to children like ExampleQuestions (46+ unnecessary renders in 16s).
//
// This test pins the contract: dispatching streaming updates to a conversation
// OTHER than the one displayed must not re-render the empty-state ExampleQuestions.
//
// Test strategy: mock ExampleQuestions with a render-counter, mount ChatInterface
// with no conversation yet, fire several `addStreamingMessage` actions targeting
// an unrelated conversation, and assert the counter stayed at its initial value.

import React from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { waitFor } from '@testing-library/react';

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
vi.mock('@/lib/chart/chart-attachments', () => ({ buildChartAttachments: vi.fn().mockResolvedValue([]) }));
vi.mock('@/components/Markdown', () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => React.createElement('span', null, children),
}));
vi.mock('@/components/explore/ChatInput', () => ({
  __esModule: true,
  default: () => React.createElement('div', { 'aria-label': 'chat input' }),
}));

// Render-counter mock for ExampleQuestions. We record every call to its render fn.
const renderCount = { value: 0 };
vi.mock('@/components/explore/message/ExampleQuestions', () => ({
  __esModule: true,
  default: () => {
    renderCount.value += 1;
    return React.createElement('div', { 'aria-label': 'example questions counter' });
  },
}));

import { createConversation, addStreamingMessage } from '@/store/chatSlice';
import * as storeModule from '@/store/store';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import ChatInterface from '@/components/explore/ChatInterface';

describe('ChatInterface re-render contract', () => {
  beforeAll(() => {
    Element.prototype.scrollTo = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { search: '?v=2', origin: 'http://localhost:3000', pathname: '/explore' },
      writable: true, configurable: true,
    });
  });

  it('does not re-render ExampleQuestions when an unrelated conversation receives streaming updates', async () => {
    const store = storeModule.makeStore();
    vi.spyOn(storeModule, 'getStore').mockReturnValue(store);

    // Two conversations exist in the store. We want conv 1 to be the displayed
    // (active) one — createConversation deactivates prior conversations and marks
    // the new one active, so we create the noise conversation (conv 2) FIRST and
    // the displayed conversation (conv 1) LAST. ChatInterface then shows the
    // empty conv 1 (→ ExampleQuestions) and we stream into the unrelated conv 2.
    store.dispatch(createConversation({ conversationID: 2, agent: 'AnalystAgent' }));
    store.dispatch(createConversation({ conversationID: 1, agent: 'AnalystAgent' }));

    renderCount.value = 0;

    const { findByLabelText } = renderWithProviders(
      <ChatInterface contextPath="/org/context" container="page" appState={null} />,
      { store },
    );

    // Sanity: ExampleQuestions actually mounts (otherwise the test is meaningless).
    expect(await findByLabelText('example questions counter')).toBeTruthy();

    // Wait for the initial render(s) to settle.
    await waitFor(() => {
      expect(renderCount.value).toBeGreaterThan(0);
    });
    const initialCount = renderCount.value;
     
    console.log('[chat-rerender test] initial render count =', initialCount);

    // Fire N streaming chunks to the OTHER conversation, with a real macrotask
    // gap between each so React-Redux's autoBatch enhancer (which coalesces
    // notifications within a microtask) actually emits N notifications.
    // Each one mutates state.chat.conversations[2], which changes the top-level
    // `conversations` map identity. ChatInterface must NOT re-render off of that.
    for (let i = 0; i < 10; i++) {
      store.dispatch(
        addStreamingMessage({
          conversationID: 2,
          type: 'StreamedThinking',
          payload: { chunk: `chunk ${i}` },
        }),
      );
      await new Promise((r) => setTimeout(r, 5));
    }

    // Give React a final flush window.
    await new Promise((r) => setTimeout(r, 30));

     
    console.log('[chat-rerender test] after 10 unrelated streaming updates: total =', renderCount.value);

    // After fix: zero extra renders (the displayed conversation didn't change).
    // The fork-chain selector + React.memo + stable props keep ExampleQuestions
    // at its initial mount count even with N unrelated streaming dispatches.
    expect(renderCount.value - initialCount).toBe(0);
  });
});
