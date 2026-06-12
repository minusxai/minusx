/**
 * StoryView — a single-page scrolling data story: one agent-authored HTML
 * document on a fixed 1280px-wide canvas (any height), rendered into a
 * SHADOW ROOT on the story host. Scripts/handlers are stripped, but <style>
 * blocks, classes and web fonts are ALLOWED — the shadow tree scopes them
 * natively (no leakage either way), while CSS variables (color-mode tokens)
 * and document fonts still inherit, so embedded charts render correctly.
 * <div data-question-id="N"> placeholders hydrate into live charts via
 * portals into the shadow root. @import lines (web fonts) are hoisted to
 * document.head — font-faces don't load inside shadow trees.
 * Also hosts the read-only JSON view (header eye/code toggle), like
 * DashboardView/PresentationView. All element queries by aria-label per repo
 * convention (the Monaco mock renders a textarea labeled "SQL editor").
 */
import React from 'react';
import { screen, within, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import type { StoryContent } from '@/lib/types';

vi.mock('@/components/containers/SmartEmbeddedQuestionContainer', () => ({
  __esModule: true,
  default: ({ questionId }: { questionId: number }) =>
    React.createElement('div', { 'aria-label': `Embedded question ${questionId}` }),
}));

import StoryView from '@/components/views/story/StoryView';

const STORY =
  '<style>@import url("https://fonts.example/lora.css");\n.hs h1{font-size:64px;color:#c8781a;}</style>' +
  '<div class="hs" style="padding:80px"><h1>The year demand went vertical</h1>' +
  '<p>Narrative paragraph.</p>' +
  '<div data-question-id="14" style="width:1100px;height:420px"></div></div>';

const content: StoryContent = {
  description: 'demo',
  assets: [{ type: 'question', id: 14 }],
  story: STORY,
};

const emptyContent: StoryContent = { description: null, assets: [], story: null };

/** The story renders inside a shadow root on the story host. */
function storyRoot(): ShadowRoot {
  const host = screen.getByLabelText('Story document');
  return host.shadowRoot!;
}

describe('StoryView', () => {
  it('shows the empty state when there is no story', () => {
    renderWithProviders(<StoryView content={emptyContent} />);
    expect(screen.getByLabelText('No story')).toBeInTheDocument();
  });

  it('renders the story HTML inside the story shadow root', async () => {
    renderWithProviders(<StoryView content={content} />);
    expect(screen.getByLabelText('Story page')).toBeInTheDocument();
    await waitFor(() => {
      expect(storyRoot().textContent).toContain('The year demand went vertical');
      expect(storyRoot().textContent).toContain('Narrative paragraph.');
    });
  });

  it('preserves agent <style> blocks inside the shadow root', async () => {
    renderWithProviders(<StoryView content={content} />);
    await waitFor(() => {
      const styles = Array.from(storyRoot().querySelectorAll('style'));
      expect(styles.some(s => s.textContent?.includes('.hs h1'))).toBe(true);
    });
  });

  it('hoists @import (web fonts) to document.head and out of the shadow styles', async () => {
    const { unmount } = renderWithProviders(<StoryView content={content} />);
    await waitFor(() => {
      const fontTag = document.head.querySelector('style[data-mx-story-fonts]');
      expect(fontTag?.textContent).toContain('fonts.example/lora.css');
    });
    const styles = Array.from(storyRoot().querySelectorAll('style'));
    expect(styles.some(s => s.textContent?.includes('@import'))).toBe(false);
    unmount();
    expect(document.head.querySelector('style[data-mx-story-fonts]')).toBeNull();
  });

  it('hydrates chart placeholders with live embedded questions', async () => {
    renderWithProviders(<StoryView content={content} />);
    await waitFor(() => {
      expect(within(storyRoot() as unknown as HTMLElement).getByLabelText('Embedded question 14')).toBeTruthy();
    });
  });

  it('sanitizes hostile HTML', async () => {
    renderWithProviders(
      <StoryView content={{ ...emptyContent, story: '<script>window.__pwned = true;</script><div onclick="alert(1)">Safe</div>' }} />
    );
    await waitFor(() => {
      expect(storyRoot().textContent).toContain('Safe');
    });
    expect(storyRoot().querySelector('script')).toBeNull();
    expect(storyRoot().querySelector('[onclick]')).toBeNull();
    expect((window as any).__pwned).toBeUndefined();
  });

  it('shows the read-only JSON view when viewMode is json', () => {
    renderWithProviders(<StoryView content={content} viewMode="json" />);
    const editor = screen.getByLabelText('SQL editor') as HTMLTextAreaElement;
    expect(editor.value).toContain('data-question-id');
    expect(editor.readOnly).toBe(true);
    expect(screen.queryByLabelText('Story page')).not.toBeInTheDocument();
  });

  it('shows the story (not JSON) when viewMode is visual', () => {
    renderWithProviders(<StoryView content={content} viewMode="visual" />);
    expect(screen.getByLabelText('Story page')).toBeInTheDocument();
    expect(screen.queryByLabelText('SQL editor')).not.toBeInTheDocument();
  });
});
