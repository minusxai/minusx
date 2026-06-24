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
 * Also hosts the JSON view (header eye/code toggle), like DashboardView —
 * read-only without a fileId, editable with one (full-content edits). All
 * element queries by aria-label per repo convention (the Monaco mock labels
 * the JsonEditor textarea "JSON editor").
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

vi.mock('@/components/containers/EmbeddedQuestionContainer', () => ({
  __esModule: true,
  default: ({ question }: { question: { query: string; connection_name: string; vizSettings: { type: string } } }) =>
    React.createElement('div', { 'aria-label': `Inline question ${question.vizSettings.type}` }, question.query),
}));

import StoryView from '@/components/views/story/StoryView';

// Real-world Google Fonts @import — note the SEMICOLONS inside the URL
// (wght@0,700;0,900): the hoister must not cut the import short there, or the
// leftover URL garbage poisons the next CSS rule.
const FONT_IMPORT =
  "@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,900&family=Space+Mono:wght@400;700&display=swap');";

const STORY =
  `<style>${FONT_IMPORT}\n.hs{--ink:#e8dfc8;background:#06090e;color:var(--ink);}\n.hs h1{font-size:64px;color:#c8781a;}</style>` +
  '<div class="hs" style="padding:80px"><h1>The year demand went vertical</h1>' +
  '<p>Narrative paragraph.</p>' +
  '<div data-question-id="14" style="width:1100px;height:420px"></div></div>';

const content: StoryContent = {
  description: 'demo',
  story: STORY,
};

const emptyContent: StoryContent = { description: null, story: null };

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

  it('hoists the COMPLETE @import (web fonts) to document.head and out of the shadow styles', async () => {
    const { unmount } = renderWithProviders(<StoryView content={content} />);
    await waitFor(() => {
      const fontTag = document.head.querySelector('style[data-mx-story-fonts]');
      // The full import survives, including the part after the in-URL semicolons
      expect(fontTag?.textContent).toContain(FONT_IMPORT);
    });
    const storyStyle = Array.from(storyRoot().querySelectorAll('style'))
      .find(s => s.textContent?.includes('.hs h1'));
    // No import remnants left behind to poison the following rules
    expect(storyStyle?.textContent).not.toContain('@import');
    expect(storyStyle?.textContent).not.toContain('fonts.googleapis.com');
    expect(storyStyle?.textContent).toContain('.hs{--ink:#e8dfc8;');
    unmount();
    expect(document.head.querySelector('style[data-mx-story-fonts]')).toBeNull();
  });

  it('hydrates chart placeholders with live embedded questions', async () => {
    renderWithProviders(<StoryView content={content} />);
    await waitFor(() => {
      expect(within(storyRoot() as unknown as HTMLElement).getByLabelText('Embedded question 14')).toBeTruthy();
    });
  });

  it('hydrates an INLINE <Question query=…> placeholder with a live embedded question', async () => {
    const inlineStory =
      '<div class="hs"><h2>Live KPI</h2>' +
      '<div data-question-inline="{&quot;query&quot;:&quot;SELECT SUM(mrr) AS mrr FROM metrics&quot;,&quot;connection_name&quot;:&quot;duckdb&quot;,&quot;vizSettings&quot;:{&quot;type&quot;:&quot;single_value&quot;}}" style="width:100%;height:200px"></div></div>';
    renderWithProviders(<StoryView content={{ description: null, story: inlineStory }} />);
    await waitFor(() => {
      const el = within(storyRoot() as unknown as HTMLElement).getByLabelText('Inline question single_value');
      expect(el.textContent).toContain('SELECT SUM(mrr) AS mrr FROM metrics');
    });
  });

  it('sizes an inline single_value embed COMPACT — honors a small height, no 340px chart floor', async () => {
    const story =
      '<div class="hs"><div data-question-inline="{&quot;query&quot;:&quot;SELECT 1&quot;,&quot;connection_name&quot;:&quot;duckdb&quot;,&quot;vizSettings&quot;:{&quot;type&quot;:&quot;single_value&quot;}}" style="width:100%;height:90px"></div></div>';
    renderWithProviders(<StoryView content={{ description: null, story }} />);
    await waitFor(() => {
      const div = storyRoot().querySelector('[data-question-inline]') as HTMLElement;
      expect(div?.style.height).toBe('90px'); // honored, NOT clamped up to 340px
    });
  });

  it('still applies the 340px chart floor to a NON-single_value inline embed', async () => {
    const story =
      '<div class="hs"><div data-question-inline="{&quot;query&quot;:&quot;SELECT 1&quot;,&quot;connection_name&quot;:&quot;duckdb&quot;,&quot;vizSettings&quot;:{&quot;type&quot;:&quot;table&quot;}}" style="width:100%;height:90px"></div></div>';
    renderWithProviders(<StoryView content={{ description: null, story }} />);
    await waitFor(() => {
      const div = storyRoot().querySelector('[data-question-inline]') as HTMLElement;
      expect(div?.style.height).toBe('340px'); // clamped up to the chart floor
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

  // The JSON/XML "Code view" moved out of StoryView into the shared CodeView
  // (rendered centrally by FileView) — see components/views/__tests__/code-view.ui.test.tsx.
  it('renders the story visual canvas (never a code editor)', () => {
    renderWithProviders(<StoryView content={content} />);
    expect(screen.getByLabelText('Story page')).toBeInTheDocument();
    expect(screen.queryByLabelText('JSON editor')).not.toBeInTheDocument();
  });
});
