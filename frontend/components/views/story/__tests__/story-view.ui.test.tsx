/**
 * StoryView — a single-page scrolling data story: one agent-authored HTML
 * document on a fixed 1280px-wide canvas (any height), sanitized, with
 * <div data-question-id="N"> placeholders hydrated into live charts.
 * All element queries by aria-label per repo convention.
 */
import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';

vi.mock('@/components/containers/SmartEmbeddedQuestionContainer', () => ({
  __esModule: true,
  default: ({ questionId }: { questionId: number }) =>
    React.createElement('div', { 'aria-label': `Embedded question ${questionId}` }),
}));

import StoryView from '@/components/views/story/StoryView';

const STORY =
  '<div style="padding:80px"><h1 style="font-size:64px">The year demand went vertical</h1>' +
  '<p>Narrative paragraph.</p>' +
  '<div data-question-id="14" style="width:1100px;height:420px"></div></div>';

describe('StoryView', () => {
  it('shows the empty state when there is no story', () => {
    renderWithProviders(<StoryView story={null} />);
    expect(screen.getByLabelText('No story')).toBeInTheDocument();
  });

  it('renders the story HTML on the story page', async () => {
    renderWithProviders(<StoryView story={STORY} />);
    const page = screen.getByLabelText('Story page');
    expect(page.textContent).toContain('The year demand went vertical');
    expect(page.textContent).toContain('Narrative paragraph.');
  });

  it('hydrates chart placeholders with live embedded questions', async () => {
    renderWithProviders(<StoryView story={STORY} />);
    expect(await screen.findByLabelText('Embedded question 14')).toBeInTheDocument();
  });

  it('sanitizes hostile HTML', () => {
    const { container } = renderWithProviders(
      <StoryView story={'<script>window.__pwned = true;</script><div onclick="alert(1)">Safe</div>'} />
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('[onclick]')).toBeNull();
    expect((window as any).__pwned).toBeUndefined();
    expect(container.textContent).toContain('Safe');
  });
});
