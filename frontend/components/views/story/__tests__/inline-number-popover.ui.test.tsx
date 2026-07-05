/**
 * Regression: a story's interactive overlays (the <Number> footnote popover, chart action
 * menus, the query-error popover) used to pin to the TOP-LEFT corner of the page. The story
 * renders in a SHADOW ROOT, but ark-ui (Chakra Popover/Menu) defaulted its root node + Portal
 * target to the top `document`; floating-ui then measured the trigger in the wrong tree and
 * fell back to (0,0). AgentHtml now wraps each portaled embed in an <EnvironmentProvider> that
 * points at the shadow root, so the popover PORTALS INTO and positions against the same tree as
 * its trigger. We can't assert pixel positions in jsdom, but we CAN assert the behavioral fix:
 * the opened popover content lives inside the story shadow root, not in document.body.
 */
import React from 'react';
import { screen, within, waitFor, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';

// The footnote body is the source question's chart — stub it so we can find it by label.
vi.mock('@/components/containers/SmartEmbeddedQuestionContainer', () => ({
  __esModule: true,
  default: ({ questionId }: { questionId: number }) =>
    React.createElement('div', { 'aria-label': `source chart ${questionId}` }, 'chart'),
}));
vi.mock('@/components/containers/EmbeddedQuestionContainer', () => ({
  __esModule: true,
  default: () => React.createElement('div', { 'aria-label': 'inline chart' }, 'chart'),
}));

import StoryView from '@/components/views/story/StoryView';
import type { StoryContent } from '@/lib/types';

// A saved-id inline number (no query fetch needed): renders "$—" until data arrives; clicking it
// opens the footnote popover whose body is the (stubbed) source chart for question 1026.
const STORY =
  '<div class="story"><p>MRR is ' +
  '<span data-number-inline="{&quot;id&quot;:1026,&quot;prefix&quot;:&quot;$&quot;}" data-number-id="1026"></span>' +
  ' today.</p></div>';

const content: StoryContent = { description: null, story: STORY };

function storyRoot(): HTMLElement {
  return (screen.getByLabelText('Story document') as HTMLIFrameElement).contentDocument!.body;
}

describe('InlineNumber footnote popover — positioning context (iframe document)', () => {
  it('opens the footnote INSIDE the story iframe (not the top document.body → no top-left pin)', async () => {
    renderWithProviders(<StoryView content={content} />);

    // The number hydrates into a clickable figure inside the shadow root.
    let trigger: HTMLElement | undefined;
    await waitFor(() => {
      trigger = within(storyRoot() as unknown as HTMLElement).getByLabelText(/^live number/);
      expect(trigger).toBeTruthy();
    });

    fireEvent.click(trigger!);

    // The popover body (the source chart) must mount WITHIN the shadow root — that is what makes
    // ark position it against the trigger instead of pinning to the document's top-left.
    await waitFor(() => {
      const inShadow = within(storyRoot() as unknown as HTMLElement).queryByLabelText('source chart 1026');
      expect(inShadow).toBeTruthy();
    });
    // And it must NOT have leaked into the top-level document body (the old broken path).
    expect(document.body.querySelector('[aria-label="source chart 1026"]')).toBeNull();
  });

  // Leak fix: the popover content used to render EAGERLY (mounted even while closed). Because it
  // portals to the iframe body — a sibling of the story content — every closed popover sat in the
  // serializable body and got baked into content.story on save (30 numbers × repeated saves →
  // hundreds of orphan panels). With lazyMount, a popover the reader never opened is absent from
  // the DOM entirely, so serialize has nothing to capture; it mounts only on open.
  it('does not mount the footnote popover while it is closed (no serializable leak)', async () => {
    renderWithProviders(<StoryView content={content} />);

    let trigger: HTMLElement | undefined;
    await waitFor(() => {
      trigger = within(storyRoot() as unknown as HTMLElement).getByLabelText(/^live number/);
      expect(trigger).toBeTruthy();
    });

    // Closed (never opened): the popover body (source chart) is NOT anywhere in the iframe
    // document, and none of the portaled popover parts (positioner/content — the DOM that leaks
    // into the serializable body) are mounted. (The trigger part stays on the number span itself,
    // inside the [data-number-inline] placeholder, which serialize clears — that's fine.)
    expect(within(storyRoot() as unknown as HTMLElement).queryByLabelText('source chart 1026')).toBeNull();
    expect((storyRoot() as unknown as HTMLElement).querySelectorAll('[data-part="positioner"], [data-part="content"]').length).toBe(0);

    // Open → it mounts (the popover still works).
    fireEvent.click(trigger!);
    await waitFor(() => {
      expect(within(storyRoot() as unknown as HTMLElement).queryByLabelText('source chart 1026')).toBeTruthy();
    });
  });
});
