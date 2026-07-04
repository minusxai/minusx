// Legacy (v1) chat opened in v2 mode: the v2 engine can't continue it, so the
// chat surface shows the read-only history but replaces the input with a
// "New Chat" CTA. A v2 chat keeps its normal input. Drives ChatInterface via the
// real isLegacyChatInV2 (v2 mode from ?v=2) + useConversation's file version.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { makeStore } from '@/store/store';
import { createConversation } from '@/store/chatSlice';

const { conversationVersion } = vi.hoisted(() => ({ conversationVersion: { value: 1 } }));

// next/navigation drives useUseChatV2 (?v=2 → v2 mode).
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/explore',
  useSearchParams: () => new URLSearchParams('v=2'),
}));
vi.mock('@/lib/navigation/NavigationGuardProvider', () => ({
  useNavigationGuard: () => ({ navigate: vi.fn(), isBlocked: false, confirmNavigation: vi.fn(), cancelNavigation: vi.fn() }),
  NavigationGuardProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/lib/hooks/useConfigs', () => ({
  useConfigs: () => ({ config: { branding: { agentName: 'MinusX' } } }),
}));
vi.mock('@/lib/hooks/useContext', () => ({
  useContext: () => ({ contextId: 1, databases: [], documentation: '', availableSkills: [], contextLoading: false }),
}));
// The opened conversation; `version` flips between legacy (1) and v2 (2).
vi.mock('@/lib/hooks/useConversation', () => ({
  useConversation: () => ({
    conversation: {
      conversationID: 1, version: conversationVersion.value, executionState: 'FINISHED',
      messages: [{ role: 'user', content: 'old question' }], pending_tool_calls: [], agent_args: {},
    },
    isLoading: false,
    error: null,
  }),
}));
// Leaf input — its presence (aria-label "Send message") means the chat is continuable.
vi.mock('@/components/explore/ChatInput', () => ({
  __esModule: true,
  default: () => React.createElement('button', { 'aria-label': 'Send message' }),
}));

import ChatInterface from '@/components/explore/ChatInterface';

function render() {
  const store = makeStore();
  store.dispatch(createConversation({ conversationID: 1, agent: 'AnalystAgent' }));
  return renderWithProviders(
    <ChatInterface conversationId={1} contextPath="/org/context" container="page" appState={null} />, { store },
  );
}

describe('legacy chat in v2 mode', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));
    // jsdom doesn't implement scrollTo; ChatInterface auto-scrolls on messages.
    Element.prototype.scrollTo = vi.fn();
  });

  it('legacy (v1) chat: shows a New Chat CTA and hides the input', async () => {
    conversationVersion.value = 1;
    render();
    expect(await screen.findByLabelText('Start a new chat')).toBeTruthy();
    expect(screen.queryByLabelText('Send message')).toBeNull();
  });

  it('v2 chat: shows the input, no legacy CTA', async () => {
    conversationVersion.value = 2;
    render();
    expect(await screen.findByLabelText('Send message')).toBeTruthy();
    expect(screen.queryByLabelText('Start a new chat')).toBeNull();
  });
});
