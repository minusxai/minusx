/**
 * Regression: the ChartCarousel thumbnail strip wrapped each mini-chart in a real <button>, but the
 * mini-chart (QuestionVisualization) renders its own <button>s → a <button> nested in a <button>,
 * which is invalid HTML and threw a React hydration error in the console. The thumbnail is now a
 * role="button" element, so no nesting. This guards that structure.
 */
import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';

// The mini-chart renders interactive <button>s (viz-type buttons, etc.). Stand in with a bare button
// so the only nesting under test is the thumbnail wrapper.
vi.mock('@/components/question/QuestionVisualization', () => ({
  QuestionVisualization: () => React.createElement('button', { 'aria-label': 'inner-viz-button' }, 'viz'),
}));

import ChartCarousel, { type ChartItem } from '@/components/explore/tools/ChartCarousel';

const item = (name: string): ChartItem => ({
  name,
  question: { query: 'SELECT 1 AS v', connection_name: 'x', vizSettings: { type: 'bar' } } as never,
  queryResult: { columns: ['v'], types: ['number'], rows: [{ v: 1 }] } as never,
});

describe('ChartCarousel — no nested <button> (hydration-safe thumbnails)', () => {
  it('renders the thumbnail selector as role=button (not a real <button>) and never nests buttons', () => {
    const { container } = renderWithProviders(
      <ChartCarousel items={[item('A'), item('B')]} databaseName="x" />,
    );

    // Thumbnail selector exists and is answerable by aria-label…
    const thumb = screen.getByLabelText('Switch to chart 1: A');
    // …but is NOT a real <button> (which would nest the mini-chart's buttons).
    expect(thumb.tagName).not.toBe('BUTTON');
    expect(thumb.getAttribute('role')).toBe('button');

    // No <button> is nested inside another <button> anywhere in the tree.
    expect(container.querySelectorAll('button button').length).toBe(0);
  });
});
