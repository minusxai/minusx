// Regression: dragging/dropping an image into the floating bottom chat bar and
// starting a chat must carry the attachment through to the sidebar chat. The bug:
// FloatingChatWrapper.handleSend called clearChat(), which clears chatAttachments,
// wiping the image before the hand-off — so only the text was sent.

const { IMG } = vi.hoisted(() => ({
  IMG: { type: 'image', name: 'shot.png', content: '/uploads/1/x.png', metadata: {} },
}));

vi.mock('@/lib/navigation/use-navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/hooks/useContext', () => ({ useContext: () => ({ databases: [], availableSkills: [] }) }));

// Stand in for ChatInput: a button that emits onSend(message, [the dropped image]).
vi.mock('@/components/explore/ChatInput', () => ({
  __esModule: true,
  default: (props: { onSend: (m: string, a: unknown[]) => void }) =>
    React.createElement('button', { 'aria-label': 'send-test', onClick: () => props.onSend('summarize this', [IMG]) }, 'send'),
}));

import React from 'react';
import { screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import * as storeModule from '@/store/store';
import { selectChatAttachments } from '@/store/uiSlice';
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
});
