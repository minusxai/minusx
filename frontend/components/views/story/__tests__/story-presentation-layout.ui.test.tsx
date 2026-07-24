/** StoryView fills the width supplied by its parent in every viewing mode. */
import React from 'react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import type { StoryContent } from '@/lib/types';

// Keep the mount light — the story surface's embedded question containers are irrelevant here.
vi.mock('@/components/containers/SmartEmbeddedQuestionContainer', () => ({
  __esModule: true, default: () => React.createElement('div', { 'aria-label': 'Embedded question' }),
}));
vi.mock('@/components/containers/EmbeddedQuestionContainer', () => ({
  __esModule: true, default: () => React.createElement('div', { 'aria-label': 'Inline embed' }),
}));

import StoryView from '@/components/views/story/StoryView';

const CONTENT: StoryContent = { story: '<div class="s"><h1>Title</h1><p>Body</p></div>' } as StoryContent;

function renderStory() {
  return renderWithProviders(
    <StoryView content={CONTENT} fileId={1} headerEditMode={false} colorMode="light" />,
  );
}

describe('StoryView — fluid layout', () => {
  it('does not cap the story canvas width', async () => {
    const { findByLabelText } = renderStory();
    const canvas = await findByLabelText('Story canvas');
    expect(canvas.style.maxWidth).toBe('');
  });
});
