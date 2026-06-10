/**
 * SlideHtml — renders one agent-authored HTML slide (sanitized) on the fixed
 * 1280×720 canvas and hydrates <div data-question-id="N"> placeholders with
 * live embedded question charts via portals.
 */
import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';

vi.mock('@/components/containers/SmartEmbeddedQuestionContainer', () => ({
  __esModule: true,
  default: ({ questionId }: { questionId: number }) =>
    React.createElement('div', { 'aria-label': `Embedded question ${questionId}` }),
}));

import SlideHtml from '@/components/views/deck/SlideHtml';

describe('SlideHtml', () => {
  it('renders the slide HTML', () => {
    const { container } = renderWithProviders(
      <SlideHtml html={'<h1 style="color:red">Quarterly Review</h1>'} />
    );
    expect(container.textContent).toContain('Quarterly Review');
  });

  it('strips scripts, event handlers, iframes, and style tags', () => {
    const hostile =
      '<script>window.__pwned = true;</script>' +
      '<style>body { background: red; }</style>' +
      '<iframe src="https://evil.example"></iframe>' +
      '<object data="x"></object>' +
      '<a href="javascript:alert(1)" onclick="alert(1)">Click</a>' +
      '<div onmouseover="alert(2)">Safe text</div>';
    const { container } = renderWithProviders(<SlideHtml html={hostile} />);

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('style')).toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('object')).toBeNull();
    expect(container.querySelector('[onclick]')).toBeNull();
    expect(container.querySelector('[onmouseover]')).toBeNull();
    const link = container.querySelector('a');
    expect(link?.getAttribute('href') ?? '').not.toContain('javascript:');
    expect((window as any).__pwned).toBeUndefined();
    expect(container.textContent).toContain('Safe text');
  });

  it('keeps inline style attributes', () => {
    const { container } = renderWithProviders(
      <SlideHtml html={'<div style="position:absolute;left:40px">Styled</div>'} />
    );
    const el = [...container.querySelectorAll('div[style]')].find(d => d.textContent === 'Styled');
    expect(el?.getAttribute('style')).toContain('position');
  });

  it('hydrates chart placeholders and clears their fallback content', async () => {
    const { container } = renderWithProviders(
      <SlideHtml html={'<div data-question-id="42" style="width:600px;height:340px">Loading chart…</div>'} />
    );
    const chart = await screen.findByLabelText('Embedded question 42');
    expect(chart).toBeInTheDocument();
    expect(container.textContent).not.toContain('Loading chart…');
  });

  it('re-discovers placeholders when the html prop changes', async () => {
    const { rerender } = renderWithProviders(
      <SlideHtml html={'<div data-question-id="42"></div>'} />
    );
    await screen.findByLabelText('Embedded question 42');

    rerender(<SlideHtml html={'<div data-question-id="7"></div>'} />);
    await screen.findByLabelText('Embedded question 7');
    await waitFor(() => {
      expect(screen.queryByLabelText('Embedded question 42')).toBeNull();
    });
  });

  it('hydrates multiple placeholders on one slide', async () => {
    renderWithProviders(
      <SlideHtml html={'<div data-question-id="1"></div><div data-question-id="2"></div>'} />
    );
    await screen.findByLabelText('Embedded question 1');
    await screen.findByLabelText('Embedded question 2');
  });
});
