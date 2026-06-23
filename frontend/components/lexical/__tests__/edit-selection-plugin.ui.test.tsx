/**
 * EditSelectionPlugin — shows the "Edit with {agentName}" pill when there's a
 * non-collapsed text selection in the Lexical editor, and hides it otherwise.
 *
 * Lexical can't run meaningfully in jsdom, so we mock the composer context + the
 * selection primitives and drive the registered update listener directly (same
 * mocking approach as context-docs-editor.ui.test.tsx). Queries use aria-labels only.
 */

const h = vi.hoisted(() => {
  const state: { selection: unknown; updateCb: ((p: unknown) => void) | null; editor: unknown } = {
    selection: null,
    updateCb: null,
    editor: null,
  };
  state.editor = { registerUpdateListener: (cb: (p: unknown) => void) => { state.updateCb = cb; return () => {}; } };
  return state;
});

vi.mock('lexical', () => ({
  $getSelection: () => h.selection,
  $isRangeSelection: (s: unknown) => !!s && (s as { __range?: boolean }).__range === true,
}));
vi.mock('@lexical/react/LexicalComposerContext', () => ({ useLexicalComposerContext: () => [h.editor] }));
vi.mock('@/lib/hooks/useConfigs', () => ({
  useConfigs: () => ({ config: { branding: { agentName: 'MinusX' } }, loading: false }),
}));

import { act } from 'react';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { EditSelectionPlugin } from '@/components/lexical/EditSelectionPlugin';
import type { EditWithAgentSource } from '@/lib/chat/edit-with-agent';

const SOURCE: EditWithAgentSource = { editorKind: 'richtext', fileName: 'Summary', filePath: '/org/Summary' };

const fireUpdate = () => act(() => { h.updateCb?.({ editorState: { read: (fn: () => void) => fn() } }); });

beforeEach(() => {
  h.selection = null;
  // jsdom returns zeros for getBoundingClientRect; stub a real range rect.
  window.getSelection = (() => ({
    rangeCount: 1,
    getRangeAt: () => ({ getBoundingClientRect: () => ({ left: 20, bottom: 40 }) }),
  })) as unknown as typeof window.getSelection;
});

describe('EditSelectionPlugin', () => {
  it('shows the pill when there is a non-collapsed selection', async () => {
    renderWithProviders(<EditSelectionPlugin source={SOURCE} />);
    h.selection = { __range: true, isCollapsed: () => false, getTextContent: () => 'hello world' };
    fireUpdate();
    expect(await screen.findByLabelText('Interact with MinusX')).toBeInTheDocument();
  });

  it('hides the pill when the selection collapses', async () => {
    renderWithProviders(<EditSelectionPlugin source={SOURCE} />);
    h.selection = { __range: true, isCollapsed: () => false, getTextContent: () => 'hello world' };
    fireUpdate();
    expect(await screen.findByLabelText('Interact with MinusX')).toBeInTheDocument();

    h.selection = { __range: true, isCollapsed: () => true };
    fireUpdate();
    await waitFor(() => expect(screen.queryByLabelText('Interact with MinusX')).not.toBeInTheDocument());
  });

  it('does not show the pill for a whitespace-only selection', async () => {
    renderWithProviders(<EditSelectionPlugin source={SOURCE} />);
    h.selection = { __range: true, isCollapsed: () => false, getTextContent: () => '   ' };
    fireUpdate();
    await waitFor(() => expect(screen.queryByLabelText('Interact with MinusX')).not.toBeInTheDocument());
  });
});
