/**
 * SemanticExplorer — the single-surface semantic exploration canvas.
 * LEFT: the fields rail (measures / dimensions / time, searchable, click OR
 * drag). RIGHT: semantic shelves (Metrics / Group by / Time / Filters) as drop
 * zones with removable chips, the always-visible chart-type rail, limit, and
 * execute. Every edit compiles REAL SQL client-side and emits
 * (spec, sql, viz) where viz is the auto-inferred match for the spec.
 *
 * Ported from SemanticCanvas.ui.test.tsx (same field/chip aria vocabulary) +
 * the new drag-drop, filter-edit, and chart-type interactions.
 */
import React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { SemanticExplorer } from '@/components/semantic-explorer';
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

function renderExplorer(props: Partial<React.ComponentProps<typeof SemanticExplorer>> = {}) {
  const onChange = vi.fn();
  const onSelectModel = vi.fn();
  const onVizTypeChange = vi.fn();
  renderWithProviders(
    <SemanticExplorer
      models={[ORDERS_MODEL]}
      stubs={STUBS}
      onSelectModel={onSelectModel}
      dialect="duckdb"
      path="/org"
      connectionName="warehouse"
      value={STARTED}
      onChange={onChange}
      vizType="table"
      vizTypeLocked={false}
      onVizTypeChange={onVizTypeChange}
      {...props}
    />
  );
  return { onChange, onSelectModel, onVizTypeChange };
}

describe('SemanticExplorer — fields rail (ported)', () => {
  it('empty state shows a BROWSABLE table list, not a blank search box', () => {
    renderExplorer({ value: null });
    expect(screen.getByLabelText('Pick table: Orders')).toBeTruthy();
    expect(screen.getByLabelText('Pick table: Users')).toBeTruthy();
    expect(screen.getByLabelText('Semantic field search')).toBeTruthy();
  });

  it('picking a table from the empty-state list loads its model', () => {
    const { onSelectModel } = renderExplorer({ value: null });
    fireEvent.click(screen.getByLabelText('Pick table: Users'));
    expect(onSelectModel).toHaveBeenCalledWith(expect.objectContaining({ table: 'users' }));
  });

  it('the full field list is visible with no typing; clicking a dimension toggles it on', async () => {
    const { onChange } = renderExplorer();
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
    expect(screen.getByLabelText('Group by chip: Status')).toBeTruthy();
  });

  it('clicking an assigned field toggles it OFF again', async () => {
    const { onChange } = renderExplorer({
      value: { model: 'Orders', table: 'orders', measures: ['Revenue'], dimensions: ['Status'] },
    });
    fireEvent.click(screen.getByLabelText('Field dimension: Status'));
    await waitFor(() => {
      const [spec] = onChange.mock.calls.at(-1)!;
      expect(spec.dimensions).toEqual([]);
    });
  });

  it('dimensions are unbounded; joins apply invisibly', async () => {
    const { onChange } = renderExplorer();
    fireEvent.click(screen.getByLabelText('Field dimension: Status'));
    fireEvent.click(screen.getByLabelText('Field dimension: Region'));
    await waitFor(() => expect(screen.getByLabelText('Group by chip: Region')).toBeTruthy());
    const [spec, sql] = onChange.mock.calls.at(-1)!;
    expect(spec.dimensions).toEqual(['Status', 'Region']);
    expect(sql).toContain('LEFT JOIN customers c');
  });

  it('clicking the time field sets a grain and viz becomes a line chart', async () => {
    const { onChange } = renderExplorer();
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
    const { onChange } = renderExplorer({ models: [model] });
    fireEvent.click(screen.getByLabelText('Field time: Delivered At'));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const [spec, sql] = onChange.mock.calls.at(-1)!;
    expect(spec.timeGrain).toBe('MONTH');
    expect(spec.timeColumn).toBe('delivered_at');
    expect(sql).toContain("DATE_TRUNC('MONTH', delivered_at)");
    fireEvent.click(screen.getByLabelText('Field time: Order date'));
    await waitFor(() => {
      const [s2] = onChange.mock.calls.at(-1)!;
      expect(s2.timeColumn).toBeUndefined();
      expect(s2.timeGrain).toBe('MONTH');
    });
  });

  it('the search bar FILTERS the visible field list', async () => {
    renderExplorer();
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
    const { onSelectModel } = renderExplorer();

    fireEvent.change(screen.getByLabelText('Semantic field search'), { target: { value: 'spend' } });
    fireEvent.click(await screen.findByLabelText('Other table field measure: Total Spend (Users)', undefined, { timeout: 3000 }));
    expect(onSelectModel).toHaveBeenCalledWith(expect.objectContaining({ table: 'users' }));
    vi.unstubAllGlobals();
  });

  it('the table can be CHANGED after picking one', () => {
    const { onSelectModel } = renderExplorer();
    fireEvent.click(screen.getByLabelText('Change table'));
    fireEvent.click(screen.getByLabelText('Pick table: Users'));
    expect(onSelectModel).toHaveBeenCalledWith(expect.objectContaining({ table: 'users' }));
  });
});

describe('SemanticExplorer — shelves', () => {
  it('removing a chip from a shelf updates the spec', async () => {
    const { onChange } = renderExplorer({
      value: { model: 'Orders', table: 'orders', measures: ['Revenue'], dimensions: ['Status'] },
    });
    fireEvent.click(screen.getByLabelText('Remove Status from Group by'));
    await waitFor(() => {
      const [spec] = onChange.mock.calls.at(-1)!;
      expect(spec.dimensions).toEqual([]);
    });
  });

  it('restores a persisted spec onto the shelves', () => {
    renderExplorer({
      value: { model: 'Orders', table: 'orders', measures: ['Revenue', 'Orders'], dimensions: ['Status', 'Region'], timeGrain: 'WEEK' },
    });
    expect(screen.getByLabelText('Metrics chip: Revenue')).toBeTruthy();
    expect(screen.getByLabelText('Metrics chip: Orders')).toBeTruthy();
    expect(screen.getByLabelText('Time chip: Order date')).toBeTruthy();
    expect(screen.getByLabelText('Group by chip: Status')).toBeTruthy();
    expect(screen.getByLabelText('Group by chip: Region')).toBeTruthy();
  });

  it('dragging a measure onto the Metrics shelf adds it', async () => {
    const { onChange } = renderExplorer();
    fireEvent.dragStart(screen.getByLabelText('Field measure: Orders'));
    fireEvent.drop(screen.getByLabelText('Metrics shelf'));
    await waitFor(() => {
      const [spec] = onChange.mock.calls.at(-1)!;
      expect(spec.measures).toEqual(['Revenue', 'Orders']);
    });
  });

  it('dragging a dimension onto the Group by shelf adds it; onto Metrics it does nothing', async () => {
    const { onChange } = renderExplorer();
    fireEvent.dragStart(screen.getByLabelText('Field dimension: Status'));
    fireEvent.drop(screen.getByLabelText('Metrics shelf'));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.dragStart(screen.getByLabelText('Field dimension: Status'));
    fireEvent.drop(screen.getByLabelText('Group by shelf'));
    await waitFor(() => {
      const [spec] = onChange.mock.calls.at(-1)!;
      expect(spec.dimensions).toEqual(['Status']);
    });
  });

  it('dragging a temporal field onto the Time shelf sets the axis', async () => {
    const { onChange } = renderExplorer();
    fireEvent.dragStart(screen.getByLabelText('Field time: Order date'));
    fireEvent.drop(screen.getByLabelText('Time shelf'));
    await waitFor(() => {
      const [spec] = onChange.mock.calls.at(-1)!;
      expect(spec.timeGrain).toBe('MONTH');
    });
  });

  it('dropping a dimension on the Filters shelf opens the filter editor preseeded', async () => {
    const { onChange } = renderExplorer();
    fireEvent.dragStart(screen.getByLabelText('Field dimension: Status'));
    fireEvent.drop(screen.getByLabelText('Filters shelf'));
    // editor open, dimension step skipped: operators visible immediately
    fireEvent.click(await screen.findByLabelText('Semantic operator ='));
    fireEvent.change(screen.getByLabelText('Semantic filter value'), { target: { value: 'active' } });
    fireEvent.click(screen.getByLabelText('Apply semantic filter'));
    await waitFor(() => {
      const [spec] = onChange.mock.calls.at(-1)!;
      expect(spec.filters).toEqual([{ dimension: 'Status', operator: '=', value: 'active' }]);
    });
  });

  it('clicking a filter chip edits it in place (replaces, not appends)', async () => {
    const { onChange } = renderExplorer({
      value: {
        model: 'Orders', table: 'orders', measures: ['Revenue'], dimensions: [],
        filters: [{ dimension: 'Status', operator: '=', value: 'active' }],
      },
    });
    fireEvent.click(screen.getByLabelText('Filter chip: Status'));
    const valueInput = await screen.findByLabelText('Semantic filter value');
    fireEvent.change(valueInput, { target: { value: 'cancelled' } });
    fireEvent.click(screen.getByLabelText('Apply semantic filter'));
    await waitFor(() => {
      const [spec] = onChange.mock.calls.at(-1)!;
      expect(spec.filters).toEqual([{ dimension: 'Status', operator: '=', value: 'cancelled' }]);
    });
  });
});

describe('SemanticExplorer — chart type rail', () => {
  it('shows the rail and picking a type reports a locked choice', () => {
    const { onVizTypeChange } = renderExplorer({
      value: { model: 'Orders', table: 'orders', measures: ['Revenue'], dimensions: ['Status'] },
    });
    fireEvent.click(screen.getByLabelText('Chart type Pie'));
    expect(onVizTypeChange).toHaveBeenCalledWith('pie', true);
  });

  it('reset-to-auto hands the inferred type back unlocked', () => {
    const { onVizTypeChange } = renderExplorer({
      value: { model: 'Orders', table: 'orders', measures: ['Revenue'], dimensions: ['Status'] },
      vizType: 'pie',
      vizTypeLocked: true,
    });
    fireEvent.click(screen.getByLabelText('Reset chart type to auto'));
    expect(onVizTypeChange).toHaveBeenCalledWith('bar', false);
  });
});

describe('SemanticExplorer — execute', () => {
  it('execute is wired', () => {
    const onExecute = vi.fn();
    renderExplorer({ value: { model: 'Orders', table: 'orders', measures: ['Revenue'], dimensions: [] }, onExecute });
    fireEvent.click(screen.getByLabelText('Execute semantic query'));
    expect(onExecute).toHaveBeenCalled();
  });
});
