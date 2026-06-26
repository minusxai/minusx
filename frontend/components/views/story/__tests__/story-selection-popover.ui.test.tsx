/**
 * StorySelectionPopover — shows the "Interact with {agentName}" pill once a selection
 * gesture completes (mouse-up) inside the story shadow root, but ONLY while the story
 * is in edit mode (active). The story body lives in a shadow tree, so selection is read
 * via getShadowRootSelection; jsdom's ShadowRoot has no getSelection, so the component
 * falls back to window.getSelection — which we stub with a real range rect. Queries use
 * aria-labels only. (Sibling of components/lexical/__tests__/edit-selection-plugin.ui.test.tsx.)
 */

vi.mock('@/lib/hooks/useConfigs', () => ({
  useConfigs: () => ({ config: { branding: { agentName: 'MinusX' } }, loading: false }),
}));

import { useRef } from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import StorySelectionPopover from '@/components/views/story/StorySelectionPopover';
import type { EditWithAgentSource } from '@/lib/chat/edit-with-agent';

const SOURCE: EditWithAgentSource = { editorKind: 'richtext', fileName: 'Q3 Story', filePath: '/org/Q3-Story', fileId: 12 };

/** Render the popover with a host element that owns an (empty) shadow root. */
function Harness({ active }: { active: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  return (
    <>
      <div ref={hostRef} />
      <StorySelectionPopover hostRef={hostRef} source={SOURCE} active={active} />
    </>
  );
}

const finishSelection = () => fireEvent.mouseUp(document.body);

const stubSelection = (text: string, collapsed = false) => {
  window.getSelection = (() => ({
    isCollapsed: collapsed,
    rangeCount: 1,
    toString: () => text,
    getRangeAt: () => ({
      getClientRects: () => [{ right: 120, bottom: 40 }],
      getBoundingClientRect: () => ({ right: 120, bottom: 40 }),
    }),
  })) as unknown as typeof window.getSelection;
};

beforeEach(() => {
  stubSelection('hello world');
});

describe('StorySelectionPopover', () => {
  it('shows the pill once the selection gesture finishes (mouse-up) in edit mode', async () => {
    renderWithProviders(<Harness active />);
    finishSelection();
    expect(await screen.findByLabelText('Interact with MinusX')).toBeInTheDocument();
  });

  it('does NOT show the pill when not in edit mode (active=false)', async () => {
    renderWithProviders(<Harness active={false} />);
    finishSelection();
    await waitFor(() => expect(screen.queryByLabelText('Interact with MinusX')).not.toBeInTheDocument());
  });

  it('does not show the pill for a collapsed (caret) selection', async () => {
    renderWithProviders(<Harness active />);
    stubSelection('hello world', /* collapsed */ true);
    finishSelection();
    await waitFor(() => expect(screen.queryByLabelText('Interact with MinusX')).not.toBeInTheDocument());
  });

  it('does not show the pill for a whitespace-only selection', async () => {
    renderWithProviders(<Harness active />);
    stubSelection('   ');
    finishSelection();
    await waitFor(() => expect(screen.queryByLabelText('Interact with MinusX')).not.toBeInTheDocument());
  });
});
