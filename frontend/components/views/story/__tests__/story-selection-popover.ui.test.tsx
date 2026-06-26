/**
 * StorySelectionPopover — shows the "Interact with {agentName}" pill once a selection
 * gesture completes (mouse-up) inside the story iframe, but ONLY while the story is in edit
 * mode (active). The story body lives in a same-origin iframe, so selection is read via the
 * iframe's contentWindow.getSelection (stubbed here with a real range rect) and the gesture is
 * listened for on the iframe's contentDocument. Queries use aria-labels only.
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

/** Render the popover wired to a real (empty) iframe — the story's rendering surface. */
function Harness({ active }: { active: boolean }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  return (
    <>
      <iframe ref={iframeRef} title="story frame" />
      <StorySelectionPopover iframeRef={iframeRef} source={SOURCE} active={active} />
    </>
  );
}

function getIframe(): HTMLIFrameElement {
  return document.querySelector('iframe[title="story frame"]') as HTMLIFrameElement;
}

const stubSelection = (iframe: HTMLIFrameElement, text: string, collapsed = false) => {
  // The component reads the selection from the iframe's contentWindow.
  (iframe.contentWindow as unknown as { getSelection: () => unknown }).getSelection = () => ({
    isCollapsed: collapsed,
    rangeCount: 1,
    toString: () => text,
    getRangeAt: () => ({
      getClientRects: () => [{ right: 120, bottom: 40 }],
      getBoundingClientRect: () => ({ right: 120, bottom: 40 }),
    }),
  });
};

// A selection gesture fires inside the iframe document (iframe events don't reach the top document).
const finishSelection = (iframe: HTMLIFrameElement) => fireEvent.mouseUp(iframe.contentDocument!.body);

describe('StorySelectionPopover', () => {
  it('shows the pill once the selection gesture finishes (mouse-up) in edit mode', async () => {
    renderWithProviders(<Harness active />);
    const iframe = getIframe();
    stubSelection(iframe, 'hello world');
    finishSelection(iframe);
    expect(await screen.findByLabelText('Interact with MinusX')).toBeInTheDocument();
  });

  it('does NOT show the pill when not in edit mode (active=false)', async () => {
    renderWithProviders(<Harness active={false} />);
    const iframe = getIframe();
    stubSelection(iframe, 'hello world');
    finishSelection(iframe);
    await waitFor(() => expect(screen.queryByLabelText('Interact with MinusX')).not.toBeInTheDocument());
  });

  it('does not show the pill for a collapsed (caret) selection', async () => {
    renderWithProviders(<Harness active />);
    const iframe = getIframe();
    stubSelection(iframe, 'hello world', /* collapsed */ true);
    finishSelection(iframe);
    await waitFor(() => expect(screen.queryByLabelText('Interact with MinusX')).not.toBeInTheDocument());
  });

  it('does not show the pill for a whitespace-only selection', async () => {
    renderWithProviders(<Harness active />);
    const iframe = getIframe();
    stubSelection(iframe, '   ');
    finishSelection(iframe);
    await waitFor(() => expect(screen.queryByLabelText('Interact with MinusX')).not.toBeInTheDocument());
  });
});
