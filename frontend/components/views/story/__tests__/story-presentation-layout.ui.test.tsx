/**
 * StoryView — presentation (fullscreen) layout adaptation.
 * In normal view the reading column is capped at the 1280px design canvas. While
 * presenting (generic shared-header Present button → fullscreen), the story goes
 * full-view: the cap is dropped so it fills the viewport, mirroring how
 * NotebookView widens its reading layout while presenting.
 */
import React from 'react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import type { StoryContent } from '@/lib/types';

const h = vi.hoisted(() => ({ presenting: false }));

vi.mock('@/components/file-toolbar/PresentationContext', () => ({
  usePresentation: () => ({ isPresenting: h.presenting, supported: true, toggle: () => {} }),
}));

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

describe('StoryView — presentation layout', () => {
  afterEach(() => { h.presenting = false; });

  it('caps the reading column at the 1280px design canvas in normal view', async () => {
    h.presenting = false;
    const { findByLabelText } = renderStory();
    const canvas = await findByLabelText('Story canvas');
    expect(canvas.style.maxWidth).toBe('1280px');
  });

  it('drops the cap to full-view width while presenting', async () => {
    h.presenting = true;
    const { findByLabelText } = renderStory();
    const canvas = await findByLabelText('Story canvas');
    expect(canvas.style.maxWidth).toBe('100%');
  });
});
