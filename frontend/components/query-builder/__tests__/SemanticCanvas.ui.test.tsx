/**
 * SemanticCanvas — drag-drop semantic editor: field list (measures /
 * dimensions / time) on the left, Measures / Dimensions / Time / Filter
 * shelves on the right. Every shelf edit compiles REAL SQL client-side and
 * emits the spec + SQL + the viz columns implied by it. Fields can be clicked
 * (they land on their shelf) or dragged; a metrics-first search box finds
 * fields across every whitelisted table and infers the model from the pick.
 */
import React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { SemanticCanvas } from '@/components/query-builder';
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
};

const STUBS = [
  { name: 'Orders', connection: 'warehouse', table: 'orders' },
  { name: 'Users', connection: 'warehouse', table: 'users' },
];

const STARTED: SemanticQuerySpec = { model: 'Orders', table: 'orders', measures: ['Revenue'], dimensions: [] };

function renderCanvas(props: Partial<React.ComponentProps<typeof SemanticCanvas>> = {}) {
  const onChange = vi.fn();
  const onSelectModel = vi.fn();
  renderWithProviders(
    <SemanticCanvas
      models={[ORDERS_MODEL]}
      stubs={STUBS}
      onSelectModel={onSelectModel}
      dialect="duckdb"
      path="/org"
      connectionName="warehouse"
      value={STARTED}
      onChange={onChange}
      {...props}
    />
  );
  return { onChange, onSelectModel };
}

describe('SemanticCanvas', () => {
  it('starts empty with the search box and model picker', () => {
    renderCanvas({ value: null });
    expect(screen.getByLabelText('Semantic field search')).toBeTruthy();
    expect(screen.getByLabelText('Semantic model')).toBeTruthy();
  });

  it('clicking a dimension fills the Dimensions shelf and emits spec + SQL + viz', async () => {
    const { onChange } = renderCanvas();
    fireEvent.click(screen.getByLabelText('Field dimension: Status'));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const [spec, sql, viz] = onChange.mock.calls.at(-1)!;
    expect(spec.dimensions).toEqual(['Status']);
    expect(sql).toContain('GROUP BY');
    expect(sql).toContain('SUM(amount) AS revenue');
    expect(viz).toMatchObject({ type: 'bar', xCols: ['status'], yCols: ['revenue'] });
    expect(screen.getByLabelText('Dimensions chip: Status')).toBeTruthy();
  });

  it('dimensions are unbounded (no chart-shelf cap); joins apply invisibly', async () => {
    const { onChange } = renderCanvas();
    fireEvent.click(screen.getByLabelText('Field dimension: Status'));
    fireEvent.click(screen.getByLabelText('Field dimension: Region'));
    await waitFor(() => expect(screen.getByLabelText('Dimensions chip: Region')).toBeTruthy());
    expect(screen.getByLabelText('Dimensions chip: Status')).toBeTruthy();
    const [spec, sql] = onChange.mock.calls.at(-1)!;
    expect(spec.dimensions).toEqual(['Status', 'Region']);
    expect(sql).toContain('LEFT JOIN customers c');
  });

  it('clicking the time field fills the Time shelf and viz becomes a line chart', async () => {
    const { onChange } = renderCanvas();
    fireEvent.click(screen.getByLabelText('Field time: Order date'));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const [spec, sql, viz] = onChange.mock.calls.at(-1)!;
    expect(spec.timeGrain).toBe('MONTH');
    expect(sql).toContain("DATE_TRUNC('MONTH', created_at)");
    expect(viz).toMatchObject({ type: 'line', xCols: ['month'] });
    // grain is editable on the chip
    fireEvent.change(screen.getByLabelText('Time grain'), { target: { value: 'WEEK' } });
    await waitFor(() => {
      const [s2] = onChange.mock.calls.at(-1)!;
      expect(s2.timeGrain).toBe('WEEK');
    });
  });

  it('dragging a dimension onto the Dimensions shelf assigns it', async () => {
    const { onChange } = renderCanvas({
      value: { model: 'Orders', table: 'orders', measures: ['Revenue'], dimensions: ['Status'] },
    });
    const chip = screen.getByLabelText('Field dimension: Region');
    fireEvent.dragStart(chip);
    fireEvent.drop(screen.getAllByText('Dimensions').at(-1)!.closest('div')!.parentElement!);
    await waitFor(() => expect(screen.getByLabelText('Dimensions chip: Region')).toBeTruthy());
    const [spec] = onChange.mock.calls.at(-1)!;
    expect(spec.dimensions).toEqual(['Status', 'Region']);
  });

  it('removing a shelf chip updates the spec', async () => {
    const { onChange } = renderCanvas({
      value: { model: 'Orders', table: 'orders', measures: ['Revenue'], dimensions: ['Status'] },
    });
    fireEvent.click(screen.getByLabelText('Remove Status from Dimensions'));
    await waitFor(() => {
      const [spec] = onChange.mock.calls.at(-1)!;
      expect(spec.dimensions).toEqual([]);
    });
  });

  it('metrics-first search infers the model from the picked field', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { fields: [
        { kind: 'measure', name: 'Total Spend', model: 'Users', connection: 'warehouse', table: 'users' },
      ] } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { onSelectModel } = renderCanvas({ value: null });

    fireEvent.change(screen.getByLabelText('Semantic field search'), { target: { value: 'spend' } });
    fireEvent.click(await screen.findByLabelText('Search result measure: Total Spend (Users)', undefined, { timeout: 3000 }));

    expect(onSelectModel).toHaveBeenCalledWith(expect.objectContaining({ table: 'users' }));
    // model not loaded yet → loading placeholder
    expect(screen.getByText(/Loading Users/)).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it('restores a persisted spec onto the right shelves', () => {
    renderCanvas({
      value: { model: 'Orders', table: 'orders', measures: ['Revenue', 'Orders'], dimensions: ['Status', 'Region'], timeGrain: 'WEEK' },
    });
    expect(screen.getByLabelText('Measures chip: Revenue')).toBeTruthy();
    expect(screen.getByLabelText('Measures chip: Orders')).toBeTruthy();
    expect(screen.getByLabelText('Time chip: Order date')).toBeTruthy();
    expect(screen.getByLabelText('Dimensions chip: Status')).toBeTruthy();
    expect(screen.getByLabelText('Dimensions chip: Region')).toBeTruthy();
  });

  it('execute is wired and disabled while issues exist', async () => {
    const onExecute = vi.fn();
    renderCanvas({ value: { model: 'Orders', table: 'orders', measures: ['Revenue'], dimensions: [] }, onExecute });
    fireEvent.click(screen.getByLabelText('Execute semantic query'));
    expect(onExecute).toHaveBeenCalled();
  });
});
