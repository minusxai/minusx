// TrendPlot label wiring: the metric label reflects the column alias when set, else the raw column name.
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { TrendPlot } from '../TrendPlot';

describe('TrendPlot — metric label', () => {
  it('renders the column alias when one is set', () => {
    renderWithProviders(
      <TrendPlot
        series={[{ name: 'total_revenue', data: [100, 200] }]}
        xAxisData={['2025-01-01', '2025-02-01']}
        yAxisColumns={['total_revenue']}
        columnFormats={{ total_revenue: { alias: 'revenue (usd)' } }}
      />
    );
    expect(screen.getByLabelText('trend label total_revenue').textContent).toBe('revenue (usd)');
  });

  it('falls back to the (formatted) column name when no alias is set', () => {
    renderWithProviders(
      <TrendPlot
        series={[{ name: 'total_revenue', data: [100, 200] }]}
        xAxisData={['2025-01-01', '2025-02-01']}
        yAxisColumns={['total_revenue']}
      />
    );
    expect(screen.getByLabelText('trend label total_revenue').textContent).toBe('total_revenue');
  });
});
