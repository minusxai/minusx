/**
 * EditWithAgentPopover — the shared pill→command-card popover used by both editors.
 * Verifies the full send chain through the REAL store: pill → click → Ask/Edit
 * segmented control + composer → Enter stages the snippet attachment + opens chat +
 * sends the action-framed message. Per repo convention, queries use aria-labels only.
 */

vi.mock('@/lib/hooks/useConfigs', () => ({
  useConfigs: () => ({ config: { branding: { agentName: 'MinusX' } }, loading: false }),
}));

import { useState } from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import EditWithAgentPopover from '@/components/EditWithAgentPopover';
import type { EditWithAgentSource } from '@/lib/chat/edit-with-agent';

const SOURCE: EditWithAgentSource = { editorKind: 'sql', fileName: 'Revenue', filePath: '/org/Revenue', lineRange: { start: 2, end: 4 } };

function Harness({ selectedText = 'select 1', source = SOURCE }: { selectedText?: string; source?: EditWithAgentSource }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>({ x: 10, y: 10 });
  return <EditWithAgentPopover position={pos} selectedText={selectedText} source={source} onClose={() => setPos(null)} />;
}

describe('EditWithAgentPopover', () => {
  it('shows Ask and Edit directly on the pill', async () => {
    renderWithProviders(<Harness />);
    expect(await screen.findByLabelText('Interact with MinusX')).toBeInTheDocument();
    expect(await screen.findByLabelText('Ask MinusX')).toBeInTheDocument();
    expect(await screen.findByLabelText('Edit MinusX')).toBeInTheDocument();
    expect(screen.queryByLabelText('Message for MinusX')).not.toBeInTheDocument();
  });

  it('opens the composer when an action is clicked', async () => {
    renderWithProviders(<Harness />);
    fireEvent.click(await screen.findByLabelText('Ask MinusX'));
    expect(await screen.findByLabelText('Message for MinusX')).toBeInTheDocument();
  });

  it('Ask: stages the snippet and sends the ask-framed message on Enter', async () => {
    const { store } = renderWithProviders(<Harness />);
    fireEvent.click(await screen.findByLabelText('Ask MinusX'));
    const input = await screen.findByLabelText('Message for MinusX');
    await userEvent.type(input, 'what does this do?');
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      const ui = store.getState().ui;
      expect(ui.chatAttachments).toHaveLength(1);
      expect(ui.chatAttachments[0]).toMatchObject({
        type: 'text',
        name: 'Selection from Revenue (SQL, lines 2–4) [/org/Revenue]',
        content: 'select 1',
        metadata: { language: 'sql', sourceLabel: 'Revenue' },
      });
      expect(ui.sidebarPendingMessage).toBe('Answer a question about the attached selection: what does this do?');
      expect(ui.rightSidebarCollapsed).toBe(false);
      expect(ui.activeSidebarSection).toBe('chat');
    });
  });

  it('Edit: uses the edit framing when the Edit action is clicked', async () => {
    const { store } = renderWithProviders(<Harness />);
    fireEvent.click(await screen.findByLabelText('Edit MinusX'));
    const input = await screen.findByLabelText('Message for MinusX');
    await userEvent.type(input, 'make it count(*)');
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(store.getState().ui.sidebarPendingMessage).toBe('Edit the attached selection as follows: make it count(*)');
    });
  });

  it('does not send when the instruction is blank', async () => {
    const { store } = renderWithProviders(<Harness />);
    fireEvent.click(await screen.findByLabelText('Ask MinusX'));
    const input = await screen.findByLabelText('Message for MinusX');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(store.getState().ui.sidebarPendingMessage).toBeNull();
    expect(store.getState().ui.chatAttachments).toHaveLength(0);
  });

  it('closes on Escape', async () => {
    renderWithProviders(<Harness />);
    expect(await screen.findByLabelText('Interact with MinusX')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByLabelText('Interact with MinusX')).not.toBeInTheDocument();
    });
  });

  it('renders nothing for a whitespace-only selection', () => {
    renderWithProviders(<Harness selectedText="   " />);
    expect(screen.queryByLabelText('Interact with MinusX')).not.toBeInTheDocument();
  });
});
