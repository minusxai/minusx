/**
 * Column-stat mini charts (Renderer_v2 Phase 2): the table-header histogram/top-values sparks
 * were the last LIVE ECharts consumers outside the deleted rollback path. They are plain
 * hand-rendered SVG now — same props, no chart engine, no canvas, native <title> tooltips.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { MiniHistogram } from '@/components/plotx/MiniHistogram';
import { MiniBarChart } from '@/components/plotx/MiniBarChart';

describe('MiniHistogram — plain SVG', () => {
  const data = [
    { bin: 0, binMin: 0, binMax: 10, count: 4 },
    { bin: 1, binMin: 10, binMax: 20, count: 9 },
    { bin: 2, binMin: 20, binMax: 30, count: 2 },
  ];

  it('renders one svg rect per bin, heights proportional to counts — no chart engine', () => {
    const { getByLabelText } = renderWithProviders(<MiniHistogram data={data} />);
    const svg = getByLabelText('Histogram of 3 bins');
    const rects = svg.querySelectorAll('rect');
    expect(rects.length).toBe(3);
    const h = (i: number) => parseFloat(rects[i].getAttribute('height')!);
    expect(h(1)).toBeGreaterThan(h(0));
    expect(h(0)).toBeGreaterThan(h(2));
    expect(svg.querySelector('canvas')).toBeNull();
  });

  it('renders nothing for empty data', () => {
    const { container } = renderWithProviders(<MiniHistogram data={[]} />);
    expect(container.querySelector('svg')).toBeNull();
  });
});

describe('MiniBarChart — plain SVG', () => {
  const data = [
    { value: 'iOS', count: 30 },
    { value: 'Android', count: 20 },
  ];

  it('renders one bar row per value with proportional widths', () => {
    const { getByLabelText } = renderWithProviders(<MiniBarChart data={data} totalUnique={5} />);
    const svg = getByLabelText('Top values bar chart');
    const rects = svg.querySelectorAll('rect');
    expect(rects.length).toBe(2);
    const w = (i: number) => parseFloat(rects[i].getAttribute('width')!);
    expect(w(0)).toBeGreaterThan(w(1));
    expect(svg.querySelector('canvas')).toBeNull();
  });
});
