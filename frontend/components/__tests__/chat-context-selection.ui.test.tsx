import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { makeStore } from '@/store/store';
import { createConversation } from '@/store/chatSlice';

// ── Mocks: external boundaries + the leaf input widget ──────────────────────
vi.mock('@/lib/navigation/use-navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/explore',
  useSearchParams: () => new URLSearchParams('v=2'),
}));
vi.mock('@/lib/navigation/NavigationGuardProvider', () => ({
  useNavigationGuard: () => ({ navigate: vi.fn(), isBlocked: false, confirmNavigation: vi.fn(), cancelNavigation: vi.fn() }),
  NavigationGuardProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/lib/hooks/useConfigs', () => ({
  useConfigs: () => ({ config: { branding: { agentName: 'MinusX' }, city: 'SF', allowedVizTypes: undefined } }),
}));
vi.mock('@/lib/hooks/useConversation', () => ({
  useConversation: () => ({
    conversation: { conversationID: 1, executionState: 'FINISHED', messages: [], pending_tool_calls: [], agent_args: {} },
    isLoading: false,
    error: null,
  }),
}));

// The SELECTED context: useContext resolves contextPath → contextId. This is the
// selection the user made; the fix must carry contextId into agent_args.context_file_id.
const SELECTED_CONTEXT_ID = 42;
vi.mock('@/lib/hooks/useContext', () => ({
  useContext: () => ({
    contextId: SELECTED_CONTEXT_ID,
    databases: [],
    documentation: 'selected-context-docs',
    availableSkills: [],
    contextLoading: false,
  }),
}));

// Leaf input widget — we test ChatInterface's send logic, not the editor. Expose a
// Send button that invokes the real onSend the way ChatInput would.
vi.mock('@/components/explore/ChatInput', () => ({
  __esModule: true,
  default: ({ onSend, onModelChange }: {
    onSend: (msg: string, atts: unknown[]) => void;
    onModelChange: (model: { providerName: string; model: string }) => void;
  }) => React.createElement(React.Fragment, null,
    React.createElement('button', {
      'aria-label': 'Select chat model',
      onClick: () => onModelChange({ providerName: 'openai-team', model: 'gpt-5.4' }),
    }),
    React.createElement('button', { 'aria-label': 'Send message', onClick: () => onSend('hello', []) }),
  ),
}));

import ChatInterface from '@/components/explore/ChatInterface';

describe('Chat honors the selected context file', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));
  });

  it('sends agent_args.context_file_id from the selected context when a message is sent', async () => {
    const store = makeStore();
    // Existing, idle conversation being viewed.
    store.dispatch(createConversation({ conversationID: 1, agent: 'AnalystAgent' }));

    renderWithProviders(
      <ChatInterface conversationId={1} contextPath="/org/selected-context" container="page" appState={null} />,
      { store },
    );

    // next/dynamic loads the (mocked) ChatInput asynchronously.
    const sendButton = await screen.findByLabelText('Send message');
    fireEvent.click(sendButton);

    await waitFor(() => {
      const conv = store.getState().chat.conversations[1];
      expect(conv.agent_args?.context_file_id).toBe(SELECTED_CONTEXT_ID);
    });
  });

  it('sends the selected chat model as an analyst override', async () => {
    const store = makeStore();
    store.dispatch(createConversation({ conversationID: 1, agent: 'AnalystAgent' }));

    renderWithProviders(
      <ChatInterface conversationId={1} contextPath="/org/selected-context" container="page" appState={null} />,
      { store },
    );

    fireEvent.click(await screen.findByLabelText('Select chat model'));
    fireEvent.click(screen.getByLabelText('Send message'));

    await waitFor(() => {
      expect(store.getState().chat.conversations[1].agent_args?.model_override).toEqual({
        providerName: 'openai-team', model: 'gpt-5.4',
      });
    });
  });
});
