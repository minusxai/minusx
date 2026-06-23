/**
 * EditSelectionPlugin — shows the "Interact with {agentName}" pill once a selection
 * gesture completes (mouse-up), and hides it when the selection collapses.
 *
 * Lexical can't run meaningfully in jsdom, so we mock the composer context + the
 * selection primitives and drive the listeners directly (same mocking approach as
 * context-docs-editor.ui.test.tsx). Queries use aria-labels only.
 */

const h = vi.hoisted(() => {
  const state: { selection: unknown; updateCb: ((p: unknown) => void) | null; editor: unknown } = {
    selection: null,
    updateCb: null,
    editor: null,
  };
  const readState = { read: (fn: () => void) => fn() };
  state.editor = {
    registerUpdateListener: (cb: (p: unknown) => void) => { state.updateCb = cb; return () => {}; },
    getEditorState: () => readState,
  };
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
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { EditSelectionPlugin } from '@/components/lexical/EditSelectionPlugin';
import type { EditWithAgentSource } from '@/lib/chat/edit-with-agent';

const SOURCE: EditWithAgentSource = { editorKind: 'richtext', fileName: 'Summary', filePath: '/org/Summary' };

const finishSelection = () => fireEvent.mouseUp(document.body);
const fireUpdate = () => act(() => { h.updateCb?.({ editorState: { read: (fn: () => void) => fn() } }); });

beforeEach(() => {
  h.selection = null;
  // jsdom returns zeros for getBoundingClientRect; stub a real range rect.
  window.getSelection = (() => ({
    rangeCount: 1,
    getRangeAt: () => ({
      getClientRects: () => [{ left: 20, right: 120, bottom: 40 }],
      getBoundingClientRect: () => ({ left: 20, right: 120, bottom: 40 }),
    }),
  })) as unknown as typeof window.getSelection;
});

describe('EditSelectionPlugin', () => {
  it('shows the pill once the selection gesture finishes (mouse-up)', async () => {
    renderWithProviders(<EditSelectionPlugin source={SOURCE} />);
    h.selection = { __range: true, isCollapsed: () => false, getTextContent: () => 'hello world' };
    finishSelection();
    expect(await screen.findByLabelText('Interact with MinusX')).toBeInTheDocument();
  });

  it('does not show while a selection is in progress (no mouse-up yet)', async () => {
    renderWithProviders(<EditSelectionPlugin source={SOURCE} />);
    h.selection = { __range: true, isCollapsed: () => false, getTextContent: () => 'hello world' };
    fireUpdate(); // selection changing mid-drag must NOT reveal the pill
    await waitFor(() => expect(screen.queryByLabelText('Interact with MinusX')).not.toBeInTheDocument());
  });

  it('hides the pill when the selection collapses', async () => {
    renderWithProviders(<EditSelectionPlugin source={SOURCE} />);
    h.selection = { __range: true, isCollapsed: () => false, getTextContent: () => 'hello world' };
    finishSelection();
    expect(await screen.findByLabelText('Interact with MinusX')).toBeInTheDocument();

    h.selection = { __range: true, isCollapsed: () => true };
    fireUpdate();
    await waitFor(() => expect(screen.queryByLabelText('Interact with MinusX')).not.toBeInTheDocument());
  });

  it('does not show the pill for a whitespace-only selection', async () => {
    renderWithProviders(<EditSelectionPlugin source={SOURCE} />);
    h.selection = { __range: true, isCollapsed: () => false, getTextContent: () => '   ' };
    finishSelection();
    await waitFor(() => expect(screen.queryByLabelText('Interact with MinusX')).not.toBeInTheDocument());
  });
});
