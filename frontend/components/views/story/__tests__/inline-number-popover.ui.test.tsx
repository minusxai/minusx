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

function storyRoot(): ShadowRoot {
  return screen.getByLabelText('Story document').shadowRoot!;
}

describe('InlineNumber footnote popover — positioning context (shadow root)', () => {
  it('opens the footnote INSIDE the story shadow root (not document.body → no top-left pin)', async () => {
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
});
