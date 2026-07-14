/**
 * SemanticCanvas — click-to-toggle semantic editor. LEFT: the picker — the
 * full field list (measures / dimensions / time), always visible,
 * independently scrollable, with a search bar that FILTERS it (and surfaces
 * matches from other tables). RIGHT: static summary of what's selected
 * (removable chips), time grain, filters, limit, execute. Clicking a field
 * toggles it; there is no drag and drop — every field has exactly one home,
 * so a click is unambiguous. Every edit compiles REAL SQL client-side and
 * emits spec + SQL + viz columns.
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
  it('empty state shows a BROWSABLE table list, not a blank search box', () => {
    renderCanvas({ value: null });
    expect(screen.getByLabelText('Pick table: Orders')).toBeTruthy();
    expect(screen.getByLabelText('Pick table: Users')).toBeTruthy();
    expect(screen.getByLabelText('Semantic field search')).toBeTruthy();
  });

  it('picking a table from the empty-state list loads its model', () => {
    const { onSelectModel } = renderCanvas({ value: null });
    fireEvent.click(screen.getByLabelText('Pick table: Users'));
    expect(onSelectModel).toHaveBeenCalledWith(expect.objectContaining({ table: 'users' }));
  });

  it('the full field list is visible with no typing; clicking a dimension toggles it on', async () => {
    const { onChange } = renderCanvas();
    expect(screen.getByLabelText('Field measure: Revenue')).toBeTruthy();
    expect(screen.getByLabelText('Field measure: Orders')).toBeTruthy();
    expect(screen.getByLabelText('Field dimension: Status')).toBeTruthy();
    expect(screen.getByLabelText('Field time: Order date')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Field dimension: Status'));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const [spec, sql, viz] = onChange.mock.calls.at(-1)!;
    expect(spec.dimensions).toEqual(['Status']);
    expect(sql).toContain('GROUP BY');
    expect(sql).toContain('SUM(amount) AS revenue');
    expect(viz).toMatchObject({ type: 'bar', xCols: ['status'], yCols: ['revenue'] });
    expect(screen.getByLabelText('Dimensions chip: Status')).toBeTruthy();
  });

  it('clicking an assigned field toggles it OFF again', async () => {
    const { onChange } = renderCanvas({
      value: { model: 'Orders', table: 'orders', measures: ['Revenue'], dimensions: ['Status'] },
    });
    fireEvent.click(screen.getByLabelText('Field dimension: Status'));
    await waitFor(() => {
      const [spec] = onChange.mock.calls.at(-1)!;
      expect(spec.dimensions).toEqual([]);
    });
  });

  it('dimensions are unbounded; joins apply invisibly', async () => {
    const { onChange } = renderCanvas();
    fireEvent.click(screen.getByLabelText('Field dimension: Status'));
    fireEvent.click(screen.getByLabelText('Field dimension: Region'));
    await waitFor(() => expect(screen.getByLabelText('Dimensions chip: Region')).toBeTruthy());
    const [spec, sql] = onChange.mock.calls.at(-1)!;
    expect(spec.dimensions).toEqual(['Status', 'Region']);
    expect(sql).toContain('LEFT JOIN customers c');
  });

  it('clicking the time field sets a grain and viz becomes a line chart', async () => {
    const { onChange } = renderCanvas();
    fireEvent.click(screen.getByLabelText('Field time: Order date'));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const [spec, sql, viz] = onChange.mock.calls.at(-1)!;
    expect(spec.timeGrain).toBe('MONTH');
    expect(sql).toContain("DATE_TRUNC('MONTH', created_at)");
    expect(viz).toMatchObject({ type: 'line', xCols: ['month'] });
    fireEvent.change(screen.getByLabelText('Time grain'), { target: { value: 'WEEK' } });
    await waitFor(() => {
      const [s2] = onChange.mock.calls.at(-1)!;
      expect(s2.timeGrain).toBe('WEEK');
    });
  });

  it('ANY temporal column can be the time axis (timeColumn on non-default)', async () => {
    const model: SemanticModel = {
      ...ORDERS_MODEL,
      dimensions: [
        ...ORDERS_MODEL.dimensions,
        { name: 'Delivered At', column: 'delivered_at', temporal: true },
      ],
    };
    const { onChange } = renderCanvas({ models: [model] });
    fireEvent.click(screen.getByLabelText('Field time: Delivered At'));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const [spec, sql] = onChange.mock.calls.at(-1)!;
    expect(spec.timeGrain).toBe('MONTH');
    expect(spec.timeColumn).toBe('delivered_at');
    expect(sql).toContain("DATE_TRUNC('MONTH', delivered_at)");
    // clicking the default moves the axis back (timeColumn cleared)
    fireEvent.click(screen.getByLabelText('Field time: Order date'));
    await waitFor(() => {
      const [s2] = onChange.mock.calls.at(-1)!;
      expect(s2.timeColumn).toBeUndefined();
      expect(s2.timeGrain).toBe('MONTH');
    });
  });

  it('the search bar FILTERS the visible field list', async () => {
    renderCanvas();
    fireEvent.change(screen.getByLabelText('Semantic field search'), { target: { value: 'reven' } });
    await waitFor(() => expect(screen.queryByLabelText('Field dimension: Status')).toBeNull());
    expect(screen.getByLabelText('Field measure: Revenue')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Semantic field search'), { target: { value: '' } });
    await waitFor(() => expect(screen.getByLabelText('Field dimension: Status')).toBeTruthy());
  });

  it('filtering also surfaces matches from OTHER tables (model inferred on pick)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { fields: [
        { kind: 'measure', name: 'Total Spend', model: 'Users', connection: 'warehouse', table: 'users' },
        { kind: 'measure', name: 'Revenue', model: 'Orders', connection: 'warehouse', table: 'orders' },
      ] } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { onSelectModel } = renderCanvas();

    fireEvent.change(screen.getByLabelText('Semantic field search'), { target: { value: 'spend' } });
    fireEvent.click(await screen.findByLabelText('Other table field measure: Total Spend (Users)', undefined, { timeout: 3000 }));
    expect(onSelectModel).toHaveBeenCalledWith(expect.objectContaining({ table: 'users' }));
    vi.unstubAllGlobals();
  });

  it('removing a selected chip updates the spec', async () => {
    const { onChange } = renderCanvas({
      value: { model: 'Orders', table: 'orders', measures: ['Revenue'], dimensions: ['Status'] },
    });
    fireEvent.click(screen.getByLabelText('Remove Status from Dimensions'));
    await waitFor(() => {
      const [spec] = onChange.mock.calls.at(-1)!;
      expect(spec.dimensions).toEqual([]);
    });
  });

  it('restores a persisted spec onto the selection panel', () => {
    renderCanvas({
      value: { model: 'Orders', table: 'orders', measures: ['Revenue', 'Orders'], dimensions: ['Status', 'Region'], timeGrain: 'WEEK' },
    });
    expect(screen.getByLabelText('Measures chip: Revenue')).toBeTruthy();
    expect(screen.getByLabelText('Measures chip: Orders')).toBeTruthy();
    expect(screen.getByLabelText('Time chip: Order date')).toBeTruthy();
    expect(screen.getByLabelText('Dimensions chip: Status')).toBeTruthy();
    expect(screen.getByLabelText('Dimensions chip: Region')).toBeTruthy();
  });

  it('execute is wired', async () => {
    const onExecute = vi.fn();
    renderCanvas({ value: { model: 'Orders', table: 'orders', measures: ['Revenue'], dimensions: [] }, onExecute });
    fireEvent.click(screen.getByLabelText('Execute semantic query'));
    expect(onExecute).toHaveBeenCalled();
  });
});
