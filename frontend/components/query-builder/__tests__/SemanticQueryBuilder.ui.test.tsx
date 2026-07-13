/**
 * SemanticQueryBuilder component tests (jsdom).
 *
 * The Semantic tier compiles entirely client-side (compileSemanticQuery →
 * irToSqlLocal), so these tests assert on the REAL generated SQL: picking
 * measures/dimensions/time grain emits both the updated SemanticQuerySpec and
 * dialect SQL with the expected aggregates, joins and DATE_TRUNC.
 */
import React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { SemanticQueryBuilder } from '@/components/query-builder';
import type { SemanticModel } from '@/lib/types';
import type { SemanticQuerySpec } from '@/lib/validation/atlas-schemas';

const ORDERS_MODEL: SemanticModel = {
  name: 'Orders',
  connection: 'warehouse',
  table: 'orders',
  timeDimension: { column: 'created_at', label: 'Order date' },
  dimensions: [
    { name: 'Status', column: 'status' },
    { name: 'Region', column: 'region', join: 'c' },
  ],
  joins: [{ table: 'customers', alias: 'c', leftColumn: 'customer_id', rightColumn: 'id' }],
  measures: [
    { name: 'Revenue', agg: 'SUM', column: 'amount' },
    { name: 'Orders', agg: 'COUNT' },
  ],
  metrics: [{ name: 'AOV', type: 'ratio', numerator: 'Revenue', denominator: 'Orders' }],
};

const renderBuilder = (props: Partial<React.ComponentProps<typeof SemanticQueryBuilder>> = {}) => {
  const onChange = vi.fn();
  renderWithProviders(
    <SemanticQueryBuilder
      models={[ORDERS_MODEL]}
      dialect="duckdb"
      value={null}
      onChange={onChange}
      {...props}
    />
  );
  return onChange;
};

describe('SemanticQueryBuilder', () => {
  it('defaults to the first model and measure, showing curated names', () => {
    renderBuilder();
    expect(screen.getAllByText('Orders').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Revenue').length).toBeGreaterThan(0);
  });

  it('adding a dimension emits the spec and SQL with the join applied invisibly', async () => {
    const onChange = renderBuilder();

    fireEvent.click(screen.getByLabelText('Add semantic dimension').querySelector('button')!);
    fireEvent.click(await screen.findByLabelText('Dimensions: Region'));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const [spec, sql] = onChange.mock.calls.at(-1)! as [SemanticQuerySpec, string];
    expect(spec.dimensions).toEqual(['Region']);
    expect(sql).toContain('LEFT JOIN customers c');
    expect(sql).toContain('c.region');
    expect(sql).toContain('SUM(amount) AS revenue');
    expect(sql).toContain('GROUP BY');
  });

  it('picking a time grain emits DATE_TRUNC SQL ordered by time', async () => {
    const onChange = renderBuilder();

    fireEvent.click(screen.getByLabelText('Add time grain').querySelector('button')!);
    fireEvent.click(await screen.findByLabelText('Time grain: MONTH'));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const [spec, sql] = onChange.mock.calls.at(-1)! as [SemanticQuerySpec, string];
    expect(spec.timeGrain).toBe('MONTH');
    expect(sql).toContain("DATE_TRUNC('MONTH', created_at)");
    expect(sql).toMatch(/ORDER BY DATE_TRUNC\('MONTH', created_at\)/);
  });

  it('adding a ratio metric emits NULLIF-guarded SQL', async () => {
    const onChange = renderBuilder();

    fireEvent.click(screen.getByLabelText('Add semantic measure').querySelector('button')!);
    fireEvent.click(await screen.findByLabelText('Measures & metrics: AOV'));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const [spec, sql] = onChange.mock.calls.at(-1)! as [SemanticQuerySpec, string];
    expect(spec.measures).toEqual(['Revenue', 'AOV']);
    expect(sql).toContain('SUM(amount) * 1.0 / NULLIF(COUNT(*), 0)');
  });

  it('restores a persisted spec (question re-opens where it was built)', () => {
    renderBuilder({
      value: { model: 'Orders', measures: ['Revenue'], dimensions: ['Status'], timeGrain: 'WEEK' },
    });
    expect(screen.getAllByText('Status').length).toBeGreaterThan(0);
    expect(screen.getByText('per WEEK')).toBeTruthy();
  });
});
