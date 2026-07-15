/**
 * ChartTypeRail — the always-visible chart-type picker of the semantic
 * explorer (PyGWalker-style "Auto Viz" strip). Types that MATCH the current
 * shelf contents render first, in ranked order; the rest are dimmed but
 * clickable. Picking a type locks it (auto-inference stops changing it);
 * a reset affordance appears only while locked and hands control back to auto.
 */
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { ChartTypeRail } from '@/components/semantic-explorer';
import type { VizMatch } from '@/lib/semantic/infer-viz';

const RANKED: VizMatch[] = [
  { type: 'line', xCols: ['month'], yCols: ['revenue'], score: 100 },
  { type: 'area', xCols: ['month'], yCols: ['revenue'], score: 90 },
  { type: 'table', xCols: ['month'], yCols: ['revenue'], score: 80 },
];

function renderRail(props: Partial<React.ComponentProps<typeof ChartTypeRail>> = {}) {
  const onPick = vi.fn();
  renderWithProviders(
    <ChartTypeRail ranked={RANKED} value="line" locked={false} onPick={onPick} {...props} />
  );
  return { onPick };
}

describe('ChartTypeRail', () => {
  it('renders matching types first, in ranked order', () => {
    renderRail();
    const labels = screen.getAllByLabelText(/^Chart type /).map((el) => el.getAttribute('aria-label'));
    expect(labels.slice(0, 3)).toEqual(['Chart type Line', 'Chart type Area', 'Chart type Table']);
    // non-matching types are still present (dimmed but clickable)
    expect(labels).toContain('Chart type Pie');
    expect(labels).toContain('Chart type Bar');
  });

  it('picking a type reports it as locked', () => {
    const { onPick } = renderRail();
    fireEvent.click(screen.getByLabelText('Chart type Pie'));
    expect(onPick).toHaveBeenCalledWith('pie', true);
  });

  it('picking a matching type also locks it (an explicit choice is a choice)', () => {
    const { onPick } = renderRail();
    fireEvent.click(screen.getByLabelText('Chart type Area'));
    expect(onPick).toHaveBeenCalledWith('area', true);
  });

  it('reset-to-auto appears only while locked, and hands back the auto type unlocked', () => {
    const { onPick } = renderRail({ locked: true, value: 'pie' });
    fireEvent.click(screen.getByLabelText('Reset chart type to auto'));
    expect(onPick).toHaveBeenCalledWith('line', false);
  });

  it('no reset affordance while unlocked', () => {
    renderRail({ locked: false });
    expect(screen.queryByLabelText('Reset chart type to auto')).toBeNull();
  });
});
