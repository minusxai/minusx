/**
 * SemanticExplorer — the single-surface semantic editor that replaces
 * SemanticCanvas. TOP: the shelves first (selected Measures / Dimensions /
 * Time / Filters chips + Limit), then a compact strip with the table chip,
 * field search and Run button. BELOW: the full field vocabulary split into
 * two click-to-toggle columns — Dimensions (with Time beneath) | Measures.
 * No drag and drop: every field has exactly one home, so a click is
 * unambiguous. Every edit compiles REAL SQL client-side and emits spec +
 * SQL + viz columns.
 */
import React from 'react';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { SemanticExplorer } from '@/components/query-builder';
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
  const defaults = {
    models: [ORDERS_MODEL],
    stubs: STUBS,
    onSelectModel,
    dialect: 'duckdb',
    path: '/org',
    connectionName: 'warehouse',
    value: STARTED,
    onChange,
  };
  const view = renderWithProviders(<SemanticExplorer {...defaults} {...props} />);
  const rerenderExplorer = (next: Partial<React.ComponentProps<typeof SemanticExplorer>> = {}) =>
    view.rerender(<SemanticExplorer {...defaults} {...props} {...next} />);
  return { onChange, onSelectModel, rerenderExplorer };
}

describe('SemanticExplorer', () => {
  // --- LAYOUT: shelves on top, two field columns (Time under Dimensions) -----

  it('splits the field vocabulary into Dimensions / Measures / Time sections', () => {
    renderExplorer();
    const dims = within(screen.getByLabelText('Dimensions column'));
    const measures = within(screen.getByLabelText('Measures column'));
    const time = within(screen.getByLabelText('Time column'));

    expect(measures.getByLabelText('Field measure: Revenue')).toBeTruthy();
    expect(measures.getByLabelText('Field measure: Orders')).toBeTruthy();
    expect(dims.getByLabelText('Field dimension: Status')).toBeTruthy();
    expect(dims.getByLabelText('Field dimension: Region')).toBeTruthy();
    expect(time.getByLabelText('Field time: Order date')).toBeTruthy();

    // no cross-contamination between columns
    expect(dims.queryByLabelText('Field measure: Revenue')).toBeNull();
    expect(measures.queryByLabelText('Field dimension: Status')).toBeNull();
    expect(time.queryByLabelText('Field dimension: Status')).toBeNull();
  });

  it('selected chips live in the shelves strip on top, ABOVE the search/run strip', () => {
    renderExplorer({
      value: { model: 'Orders', table: 'orders', measures: ['Revenue'], dimensions: ['Status'] },
    });
    const shelvesEl = screen.getByLabelText('Semantic shelves');
    const shelves = within(shelvesEl);
    expect(shelves.getByLabelText('Measures chip: Revenue')).toBeTruthy();
    expect(shelves.getByLabelText('Dimensions chip: Status')).toBeTruthy();

    // the shelves come FIRST; table chip + search + run sit below them
    const search = screen.getByLabelText('Semantic field search');
    expect(shelvesEl.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // --- Behavior carried over from SemanticCanvas -----------------------------

  it('empty state shows a BROWSABLE table list, not a blank search box', () => {
    renderExplorer({ value: null });
    expect(screen.getByLabelText('Pick table: Orders')).toBeTruthy();
    expect(screen.getByLabelText('Pick table: Users')).toBeTruthy();
    expect(screen.getByLabelText('Semantic field search')).toBeTruthy();
  });

  it('the table browser lists data models (views) FIRST, separated from tables', () => {
    renderExplorer({
      value: null,
      stubs: [
        ...STUBS,
        { name: 'Revenue Model', connection: 'warehouse', schema: '_views', table: 'revenue_model' },
      ],
    });
    const models = within(screen.getByLabelText('Data models section'));
    const tables = within(screen.getByLabelText('Tables section'));

    expect(models.getByLabelText('Pick table: Revenue Model')).toBeTruthy();
    expect(tables.getByLabelText('Pick table: Orders')).toBeTruthy();
    expect(tables.getByLabelText('Pick table: Users')).toBeTruthy();
    // no cross-contamination
    expect(models.queryByLabelText('Pick table: Orders')).toBeNull();
    expect(tables.queryByLabelText('Pick table: Revenue Model')).toBeNull();

    // models come first in the document
    const modelsEl = screen.getByLabelText('Data models section');
    const tablesEl = screen.getByLabelText('Tables section');
    expect(modelsEl.compareDocumentPosition(tablesEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('no Data models section when the schema has no views', () => {
    renderExplorer({ value: null });
    expect(screen.queryByLabelText('Data models section')).toBeNull();
    expect(screen.getByLabelText('Tables section')).toBeTruthy();
  });

  it('picking a table from the empty-state list loads its model', () => {
    const { onSelectModel } = renderExplorer({ value: null });
    fireEvent.click(screen.getByLabelText('Pick table: Users'));
    expect(onSelectModel).toHaveBeenCalledWith(expect.objectContaining({ table: 'users' }));
  });

  it('clicking a dimension toggles it on and emits spec + SQL + viz', async () => {
    const { onChange } = renderExplorer();
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
    await waitFor(() => expect(screen.getByLabelText('Dimensions chip: Region')).toBeTruthy());
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
    // clicking the default moves the axis back (timeColumn cleared)
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

  it('an existing filter chip can be EDITED in place', async () => {
    const { onChange } = renderExplorer({
      value: {
        model: 'Orders', table: 'orders', measures: ['Revenue'], dimensions: [],
        filters: [{ dimension: 'Status', operator: '=', value: 'done' }],
      },
    });

    // clicking the chip opens the editor, prefilled with the filter
    fireEvent.click(screen.getByLabelText('Filter chip: Status'));
    const input = await screen.findByLabelText('Semantic filter value');
    expect((input as HTMLInputElement).value).toBe('done');

    fireEvent.change(input, { target: { value: 'cancelled' } });
    fireEvent.click(screen.getByLabelText('Apply semantic filter'));

    await waitFor(() => {
      const [spec, sql] = onChange.mock.calls.at(-1)!;
      expect(spec.filters).toEqual([{ dimension: 'Status', operator: '=', value: 'cancelled' }]);
      expect(sql).toContain('cancelled');
    });
  });

  it('removing a selected chip updates the spec', async () => {
    const { onChange } = renderExplorer({
      value: { model: 'Orders', table: 'orders', measures: ['Revenue'], dimensions: ['Status'] },
    });
    fireEvent.click(screen.getByLabelText('Remove Status from Dimensions'));
    await waitFor(() => {
      const [spec] = onChange.mock.calls.at(-1)!;
      expect(spec.dimensions).toEqual([]);
    });
  });

  it('the table can be CHANGED after picking one', () => {
    const { onSelectModel } = renderExplorer();
    fireEvent.click(screen.getByLabelText('Change table'));
    // back to the browsable tables list
    fireEvent.click(screen.getByLabelText('Pick table: Users'));
    expect(onSelectModel).toHaveBeenCalledWith(expect.objectContaining({ table: 'users' }));
  });

  it('restores a persisted spec onto the shelves', () => {
    renderExplorer({
      value: { model: 'Orders', table: 'orders', measures: ['Revenue', 'Orders'], dimensions: ['Status', 'Region'], timeGrain: 'WEEK' },
    });
    expect(screen.getByLabelText('Measures chip: Revenue')).toBeTruthy();
    expect(screen.getByLabelText('Measures chip: Orders')).toBeTruthy();
    expect(screen.getByLabelText('Time chip: Order date')).toBeTruthy();
    expect(screen.getByLabelText('Dimensions chip: Status')).toBeTruthy();
    expect(screen.getByLabelText('Dimensions chip: Region')).toBeTruthy();
  });

  it('adopts an EXTERNAL value change (header Cancel, agent edit) — no stale shelves', async () => {
    const { rerenderExplorer } = renderExplorer({
      value: { model: 'Orders', table: 'orders', measures: ['Revenue'], dimensions: ['Status'] },
    });
    expect(screen.getByLabelText('Dimensions chip: Status')).toBeTruthy();

    // Cancel reverted the content: the persisted spec no longer has Status.
    rerenderExplorer({ value: { model: 'Orders', table: 'orders', measures: ['Revenue'], dimensions: [] } });

    await waitFor(() => expect(screen.queryByLabelText('Dimensions chip: Status')).toBeNull());
  });

  it("the explorer's OWN edit echoing back through the value prop does not reset it", async () => {
    const { onChange, rerenderExplorer } = renderExplorer();

    fireEvent.click(screen.getByLabelText('Field dimension: Status'));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const [emittedSpec] = onChange.mock.calls.at(-1)!;

    // The parent persists the spec and hands it back (fresh object, same shape).
    rerenderExplorer({ value: JSON.parse(JSON.stringify(emittedSpec)) });

    expect(screen.getByLabelText('Dimensions chip: Status')).toBeTruthy();
    expect(onChange).toHaveBeenCalledTimes(1); // no feedback loop
  });

  it('execute is wired', async () => {
    const onExecute = vi.fn();
    renderExplorer({ value: { model: 'Orders', table: 'orders', measures: ['Revenue'], dimensions: [] }, onExecute });
    fireEvent.click(screen.getByLabelText('Execute semantic query'));
    expect(onExecute).toHaveBeenCalled();
  });

  it('the auto-run toggle is wired (and only offered when the parent supports it)', () => {
    const onToggleAutoRun = vi.fn();
    renderExplorer({ onExecute: vi.fn(), autoRun: true, onToggleAutoRun });
    fireEvent.click(screen.getByLabelText('Toggle auto-run'));
    expect(onToggleAutoRun).toHaveBeenCalled();
  });

  it('no auto-run toggle without a parent handler', () => {
    renderExplorer({ onExecute: vi.fn() });
    expect(screen.queryByLabelText('Toggle auto-run')).toBeNull();
  });
});
