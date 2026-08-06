// Regression: dragging/dropping an image into the floating bottom chat bar and
// starting a chat must carry the attachment through to the sidebar chat. The bug:
// FloatingChatWrapper.handleSend called clearChat(), which clears chatAttachments,
// wiping the image before the hand-off — so only the text was sent.

const { IMG } = vi.hoisted(() => ({
  IMG: { type: 'image', name: 'shot.png', content: '/uploads/1/x.png', metadata: {} },
}));

vi.mock('@/lib/navigation/use-navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/hooks/useContext', () => ({
  useContext: () => ({
    databases: [],
    availableSkills: [],
    agents: [{ name: 'yoyo', description: 'momo' }],
  }),
}));

// Stand in for ChatInput: controls that exercise model selection and message hand-off.
vi.mock('@/components/explore/ChatInput', () => ({
  __esModule: true,
  default: (props: {
    onSend: (m: string, a: unknown[]) => void;
    selectedGrade?: string | null;
    onGradeChange?: (grade: string) => void;
    agentOptions?: { name: string; description?: string }[];
    selectedAgent?: string | null;
    onAgentChange?: (name: string | null) => void;
  }) => React.createElement(
    'div',
    // The real ChatInput re-enables pointer events on its pill (the floating
    // wrapper row is pointer-events:none so clicks beside the pill fall through);
    // the mock must mirror that or userEvent refuses to click inside it.
    { style: { pointerEvents: 'auto' } },
    React.createElement('button', { 'aria-label': 'send-test', onClick: () => props.onSend('summarize this', [IMG]) }, 'send'),
    React.createElement('button', {
      'aria-label': 'select-grade-test',
      onClick: () => props.onGradeChange?.('advanced'),
    }, 'grade'),
    React.createElement('button', {
      'aria-label': 'select-agent-test',
      onClick: () => props.onAgentChange?.('yoyo'),
    }, 'agent'),
    React.createElement('span', { 'data-testid': 'selected-grade' }, props.selectedGrade ?? 'default'),
    React.createElement('span', { 'data-testid': 'selected-agent' }, props.selectedAgent ?? 'default'),
    React.createElement('span', { 'data-testid': 'agent-options' }, props.agentOptions?.map((agent) => agent.name).join(',') ?? ''),
  ),
}));

import React from 'react';
import { screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import * as storeModule from '@/store/store';
import { selectChatAttachments, setChatAgentSelection, setChatGradeSelection } from '@/store/uiSlice';
import FloatingChatWrapper from '@/components/app-shell/FloatingChatWrapper';

describe('FloatingChatWrapper: attachment hand-off to the sidebar chat', () => {
  it('preserves dropped attachments through clearChat when starting a chat', async () => {
    const store = storeModule.makeStore();
    renderWithProviders(<FloatingChatWrapper appState={null} />, { store });

    await act(async () => { await userEvent.click(screen.getByLabelText('send-test')); });

    // The dropped image must survive the hand-off, and the text must be queued.
    expect(selectChatAttachments(store.getState())).toEqual([IMG]);
    expect(store.getState().ui.sidebarPendingMessage).toBe('summarize this');
  });

  it('reads and writes the shared chat grade selection', async () => {
    const store = storeModule.makeStore();
    renderWithProviders(<FloatingChatWrapper appState={null} />, { store });

    await userEvent.click(screen.getByLabelText('select-grade-test'));
    expect(screen.getByTestId('selected-grade')).toHaveTextContent('advanced');
    expect(store.getState().ui.chatGradeSelection).toBe('advanced');

    act(() => {
      store.dispatch(setChatGradeSelection('lite'));
    });
    expect(screen.getByTestId('selected-grade')).toHaveTextContent('lite');
  });

  it('offers context agents and preserves the shared selection without a feature flag', () => {
    const store = storeModule.makeStore();
    store.dispatch(setChatAgentSelection('yoyo'));
    renderWithProviders(<FloatingChatWrapper appState={null} />, { store });

    expect(screen.getByTestId('agent-options')).toHaveTextContent('yoyo');
    expect(screen.getByTestId('selected-agent')).toHaveTextContent('yoyo');
  });

  it('offers context agents and shares the agent selection with the sidebar chat', async () => {
    const store = storeModule.makeStore();
    renderWithProviders(<FloatingChatWrapper appState={null} />, { store });

    expect(screen.getByTestId('agent-options')).toHaveTextContent('yoyo');
    await userEvent.click(screen.getByLabelText('select-agent-test'));
    expect(screen.getByTestId('selected-agent')).toHaveTextContent('yoyo');
    expect(store.getState().ui.chatAgentSelection).toBe('yoyo');

    act(() => {
      store.dispatch(setChatAgentSelection(null));
    });
    expect(screen.getByTestId('selected-agent')).toHaveTextContent('default');
  });
});
