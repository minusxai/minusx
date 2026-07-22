/**
 * SemanticExplorer — the single-surface semantic editor that replaces
 * SemanticCanvas. TOP: the shelves first (selected Measures / Dimensions /
 * Time / Filters chips + Limit), then a compact strip with the model chip,
 * field search and Run button. BELOW: the full field vocabulary split into
 * two click-to-toggle columns — Dimensions (with Time beneath) | Measures
 * (every metric type in one list). No drag and drop: every field has exactly
 * one home, so a click is unambiguous. Every edit compiles REAL SQL
 * client-side and emits spec + SQL + viz columns.
 *
 * With no spec yet the columns give way to the AUTHORED-MODEL picker
 * (Semantic_Model_v2.md §2.4 — the UI lists models, dimensions and metrics,
 * never raw tables), so a fresh question can always start a semantic query.
 */
import React from 'react';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { SemanticExplorer } from '@/components/query-builder';
import type { SemanticModelV2 } from '@/lib/types';
import type { SemanticQuerySpec } from '@/lib/validation/atlas-schemas';

const ORDERS_MODEL: SemanticModelV2 = {
  name: 'Orders',
  connection: 'warehouse',
  primary: { kind: 'table', table: 'orders' },
  dimensions: [
    { name: 'Order date', source: 'primary', column: 'created_at', temporal: true },
    { name: 'Status', source: 'primary', column: 'status' },
    { name: 'Region', source: 'c', column: 'region' },
  ],
  references: [{
    source: { kind: 'table', table: 'customers' },
    alias: 'c',
    relationship: 'many_to_one',
    joinType: 'LEFT',
    on: [{ primaryColumn: 'customer_id', referencedColumn: 'id' }],
  }],
  metrics: [
    { name: 'Revenue', type: 'aggregation', agg: 'SUM', column: 'amount' },
    { name: 'Orders', type: 'aggregation', agg: 'COUNT' },
  ],
};

/** A second authored model — a table primary with a schema and a description. */
const USERS_MODEL: SemanticModelV2 = {
  name: 'Users',
  description: 'One row per signed-up user',
  connection: 'warehouse',
  primary: { kind: 'table', schema: 'public', table: 'users' },
  dimensions: [{ name: 'Country', source: 'primary', column: 'country' }],
  metrics: [
    { name: 'User Count', type: 'aggregation', agg: 'COUNT' },
    { name: 'Total Spend', type: 'aggregation', agg: 'SUM', column: 'spend' },
  ],
};

/** A model-primary (data model / view) — addressed as `_views.<name>`. */
const REVENUE_MODEL: SemanticModelV2 = {
  name: 'Revenue Model',
  connection: 'warehouse',
  primary: { kind: 'model', view: 'revenue_model' },
  dimensions: [{ name: 'Month', source: 'primary', column: 'month', temporal: true }],
  metrics: [{ name: 'Revenue', type: 'aggregation', agg: 'SUM', column: 'revenue' }],
};

/** Ratio/SQL metrics live in the same list as aggregations. */
const ORDERS_WITH_METRICS: SemanticModelV2 = {
  ...ORDERS_MODEL,
  metrics: [
    ...ORDERS_MODEL.metrics,
    { name: 'Avg Order Value', type: 'ratio', numerator: 'Revenue', denominator: 'Orders' },
    { name: 'Net Revenue', type: 'sql', sql: 'SUM(primary.amount) - SUM(primary.refund)' },
  ],
};

const STARTED: SemanticQuerySpec = { model: 'Orders', table: 'orders', metrics: ['Revenue'], dimensions: [] };

function renderExplorer(props: Partial<React.ComponentProps<typeof SemanticExplorer>> = {}) {
  const onChange = vi.fn();
  const defaults = {
    models: [ORDERS_MODEL],
    dialect: 'duckdb',
    path: '/org',
    connectionName: 'warehouse',
    value: STARTED,
    onChange,
  };
  const view = renderWithProviders(<SemanticExplorer {...defaults} {...props} />);
  const rerenderExplorer = (next: Partial<React.ComponentProps<typeof SemanticExplorer>> = {}) =>
    view.rerender(<SemanticExplorer {...defaults} {...props} {...next} />);
  return { onChange, rerenderExplorer };
}

describe('SemanticExplorer', () => {
  // --- M5: authored models only — no-models empty state ----------------------

  it('with NO models, renders an empty state pointing at the context editor', () => {
    renderExplorer({ models: [], value: null });
    const empty = screen.getByLabelText('semantic-models-empty-state');
    expect(empty.textContent).toContain('No semantic models yet');
    expect(empty.textContent).toContain('knowledge base');
    // nothing to pick — neither authored models nor raw tables
    expect(screen.queryByLabelText('Semantic model picker')).toBeNull();
    expect(screen.queryByLabelText('Pick model: Orders')).toBeNull();
  });

  // --- LAYOUT: shelves on top, two field columns (Time under Dimensions) -----

  it('splits the field vocabulary into Dimensions / Measures / Time sections', () => {
    renderExplorer();
    const dims = within(screen.getByLabelText('Dimensions column'));
    const measures = within(screen.getByLabelText('Metrics column'));
    const time = within(screen.getByLabelText('Time column'));

    expect(measures.getByLabelText('Field metric: Revenue')).toBeTruthy();
    expect(measures.getByLabelText('Field metric: Orders')).toBeTruthy();
    expect(dims.getByLabelText('Field dimension: Status')).toBeTruthy();
    expect(dims.getByLabelText('Field dimension: Region')).toBeTruthy();
    expect(time.getByLabelText('Field time: Order date')).toBeTruthy();

    // no cross-contamination between columns
    expect(dims.queryByLabelText('Field metric: Revenue')).toBeNull();
    expect(measures.queryByLabelText('Field dimension: Status')).toBeNull();
    expect(time.queryByLabelText('Field dimension: Status')).toBeNull();
  });

  it('selected chips live in the shelves strip on top, ABOVE the search/run strip', () => {
    renderExplorer({
      value: { model: 'Orders', table: 'orders', metrics: ['Revenue'], dimensions: ['Status'] },
    });
    const shelvesEl = screen.getByLabelText('Semantic shelves');
    const shelves = within(shelvesEl);
    expect(shelves.getByLabelText('Metrics chip: Revenue')).toBeTruthy();
    expect(shelves.getByLabelText('Dimensions chip: Status')).toBeTruthy();

    // the shelves come FIRST; model chip + search + run sit below them
    const search = screen.getByLabelText('Semantic field search');
    expect(shelvesEl.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // --- GAP 1: the authored-model picker is the entry point --------------------

  it('with no spec, lists the AUTHORED MODELS by name — never raw tables (§2.4)', () => {
    renderExplorer({ value: null, models: [ORDERS_MODEL, USERS_MODEL, REVENUE_MODEL] });
    const picker = within(screen.getByLabelText('Semantic model picker'));

    expect(picker.getByLabelText('Pick model: Orders')).toBeTruthy();
    expect(picker.getByLabelText('Pick model: Users')).toBeTruthy();
    expect(picker.getByLabelText('Pick model: Revenue Model')).toBeTruthy();
    expect(screen.getByLabelText('Semantic field search')).toBeTruthy();

    // the raw-table browser is gone: no table rows, no table/data-model headers
    expect(screen.queryByLabelText('Pick table: Orders')).toBeNull();
    expect(screen.queryByLabelText('Tables section')).toBeNull();
    expect(screen.queryByLabelText('Data models section')).toBeNull();
  });

  it('each picker row subtitles the model with its primary source and description', () => {
    renderExplorer({ value: null, models: [ORDERS_MODEL, USERS_MODEL, REVENUE_MODEL] });

    expect(screen.getByLabelText('Pick model: Orders').textContent).toContain('orders');
    const users = screen.getByLabelText('Pick model: Users');
    expect(users.textContent).toContain('public.users');
    expect(users.textContent).toContain('One row per signed-up user');
    // a model-primary is addressed under the views schema
    expect(screen.getByLabelText('Pick model: Revenue Model').textContent).toContain('_views.revenue_model');
  });

  it('picking an authored model seeds a spec whose model is the AUTHORED NAME', async () => {
    const { onChange } = renderExplorer({ value: null, models: [ORDERS_MODEL, USERS_MODEL] });
    fireEvent.click(screen.getByLabelText('Pick model: Users'));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const [spec, sql] = onChange.mock.calls.at(-1)!;
    expect(spec.model).toBe('Users');
    expect(spec.table).toBe('users');
    expect(spec.schema).toBe('public');
    expect(spec.metrics).toEqual(['User Count']); // default measure seeded → runnable
    expect(sql).toContain('users');

    // the picked model's vocabulary is immediately browsable — never a stuck
    // "Loading …" (the stub names used to only match a model by coincidence)
    expect(screen.getByLabelText('Field dimension: Country')).toBeTruthy();
    expect(screen.queryByLabelText('Semantic model picker')).toBeNull();
  });

  it('picking a MODEL-primary seeds the views schema', async () => {
    const { onChange } = renderExplorer({ value: null, models: [REVENUE_MODEL, ORDERS_MODEL] });
    fireEvent.click(screen.getByLabelText('Pick model: Revenue Model'));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const [spec] = onChange.mock.calls.at(-1)!;
    expect(spec.model).toBe('Revenue Model');
    expect(spec.table).toBe('revenue_model');
    expect(spec.schema).toBe('_views');
  });

  it('the search box filters the model picker', async () => {
    renderExplorer({ value: null, models: [ORDERS_MODEL, USERS_MODEL, REVENUE_MODEL] });
    fireEvent.change(screen.getByLabelText('Semantic field search'), { target: { value: 'reven' } });
    await waitFor(() => expect(screen.queryByLabelText('Pick model: Orders')).toBeNull());
    expect(screen.getByLabelText('Pick model: Revenue Model')).toBeTruthy();
  });

  it('the model can be CHANGED after picking one', async () => {
    const { onChange } = renderExplorer({ models: [ORDERS_MODEL, USERS_MODEL] });
    fireEvent.click(screen.getByLabelText('Change model'));
    // back to the authored-model picker
    fireEvent.click(screen.getByLabelText('Pick model: Users'));
    await waitFor(() => {
      const [spec] = onChange.mock.calls.at(-1)!;
      expect(spec.model).toBe('Users');
    });
  });

  // --- GAP 2: authored metrics are selectable ---------------------------------

  it('authored METRICS sit in the Measures column beside measures, marked distinctly', () => {
    renderExplorer({ models: [ORDERS_WITH_METRICS] });
    const measures = within(screen.getByLabelText('Metrics column'));

    expect(measures.getByLabelText('Field metric: Revenue')).toBeTruthy();
    expect(measures.getByLabelText('Field metric: Avg Order Value')).toBeTruthy();
    expect(measures.getByLabelText('Field metric: Net Revenue')).toBeTruthy();
    // metrics have no agg — they are labelled by their kind instead
    expect(measures.getByLabelText('Field metric: Avg Order Value').textContent).toContain('ratio');
    expect(measures.getByLabelText('Field metric: Net Revenue').textContent).toContain('sql');
  });

  it('clicking a SQL metric selects it like a measure and compiles its expression', async () => {
    const { onChange } = renderExplorer({ models: [ORDERS_WITH_METRICS] });
    fireEvent.click(screen.getByLabelText('Field metric: Net Revenue'));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const [spec, sql] = onChange.mock.calls.at(-1)!;
    expect(spec.metrics).toEqual(['Revenue', 'Net Revenue']);
    expect(sql).toContain('SUM(orders.amount) - SUM(orders.refund)');
    expect(screen.getByLabelText('Metrics chip: Net Revenue')).toBeTruthy();

    // and toggles off again, exactly like a measure
    fireEvent.click(screen.getByLabelText('Field metric: Net Revenue'));
    await waitFor(() => {
      const [next] = onChange.mock.calls.at(-1)!;
      expect(next.metrics).toEqual(['Revenue']);
    });
  });

  it('a RATIO metric compiles to its NULLIF-guarded expression', async () => {
    const { onChange } = renderExplorer({ models: [ORDERS_WITH_METRICS] });
    fireEvent.click(screen.getByLabelText('Field metric: Avg Order Value'));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const [spec, sql] = onChange.mock.calls.at(-1)!;
    expect(spec.metrics).toEqual(['Revenue', 'Avg Order Value']);
    expect(sql).toContain('NULLIF');
  });

  it('the search bar filters metrics too', async () => {
    renderExplorer({ models: [ORDERS_WITH_METRICS] });
    fireEvent.change(screen.getByLabelText('Semantic field search'), { target: { value: 'net' } });
    await waitFor(() => expect(screen.queryByLabelText('Field metric: Revenue')).toBeNull());
    expect(screen.getByLabelText('Field metric: Net Revenue')).toBeTruthy();
  });

  // --- Behavior carried over from SemanticCanvas -----------------------------

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
      value: { model: 'Orders', table: 'orders', metrics: ['Revenue'], dimensions: ['Status'] },
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
    const model: SemanticModelV2 = {
      ...ORDERS_MODEL,
      dimensions: [
        ...ORDERS_MODEL.dimensions,
        { name: 'Delivered At', source: 'primary', column: 'delivered_at', temporal: true },
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
    expect(screen.getByLabelText('Field metric: Revenue')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Semantic field search'), { target: { value: '' } });
    await waitFor(() => expect(screen.getByLabelText('Field dimension: Status')).toBeTruthy());
  });

  it('filtering also surfaces matches from OTHER models (picking one switches model)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { fields: [
        { kind: 'metric', name: 'Total Spend', model: 'Users', connection: 'warehouse', schema: 'public', table: 'users' },
        { kind: 'metric', name: 'Revenue', model: 'Orders', connection: 'warehouse', table: 'orders' },
      ] } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderExplorer({ models: [ORDERS_MODEL, USERS_MODEL] });

    fireEvent.change(screen.getByLabelText('Semantic field search'), { target: { value: 'spend' } });
    fireEvent.click(await screen.findByLabelText('Other model field metric: Total Spend (Users)', undefined, { timeout: 3000 }));

    expect(screen.getByLabelText('Metrics chip: Total Spend')).toBeTruthy();
    expect(screen.getByLabelText('Change model').textContent).toContain('Users');
    // the switched-to model's own vocabulary is what's listed now
    expect(screen.getByLabelText('Field dimension: Country')).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it('a METRIC search hit selects the metric on its model', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { fields: [
        { kind: 'metric', name: 'Net Revenue', model: 'Orders', connection: 'warehouse', table: 'orders' },
      ] } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderExplorer({ models: [ORDERS_WITH_METRICS], value: { model: 'Users', table: 'users', metrics: ['User Count'], dimensions: [] } });

    fireEvent.change(screen.getByLabelText('Semantic field search'), { target: { value: 'net' } });
    fireEvent.click(await screen.findByLabelText('Other model field metric: Net Revenue (Orders)', undefined, { timeout: 3000 }));

    expect(screen.getByLabelText('Metrics chip: Net Revenue')).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it('an existing filter chip can be EDITED in place', async () => {
    const { onChange } = renderExplorer({
      value: {
        model: 'Orders', table: 'orders', metrics: ['Revenue'], dimensions: [],
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
      value: { model: 'Orders', table: 'orders', metrics: ['Revenue'], dimensions: ['Status'] },
    });
    fireEvent.click(screen.getByLabelText('Remove Status from Dimensions'));
    await waitFor(() => {
      const [spec] = onChange.mock.calls.at(-1)!;
      expect(spec.dimensions).toEqual([]);
    });
  });

  it('restores a persisted spec onto the shelves', () => {
    renderExplorer({
      value: { model: 'Orders', table: 'orders', metrics: ['Revenue', 'Orders'], dimensions: ['Status', 'Region'], timeGrain: 'WEEK' },
    });
    expect(screen.getByLabelText('Metrics chip: Revenue')).toBeTruthy();
    expect(screen.getByLabelText('Metrics chip: Orders')).toBeTruthy();
    expect(screen.getByLabelText('Time chip: Order date')).toBeTruthy();
    expect(screen.getByLabelText('Dimensions chip: Status')).toBeTruthy();
    expect(screen.getByLabelText('Dimensions chip: Region')).toBeTruthy();
  });

  it('adopts an EXTERNAL value change (header Cancel, agent edit) — no stale shelves', async () => {
    const { rerenderExplorer } = renderExplorer({
      value: { model: 'Orders', table: 'orders', metrics: ['Revenue'], dimensions: ['Status'] },
    });
    expect(screen.getByLabelText('Dimensions chip: Status')).toBeTruthy();

    // Cancel reverted the content: the persisted spec no longer has Status.
    rerenderExplorer({ value: { model: 'Orders', table: 'orders', metrics: ['Revenue'], dimensions: [] } });

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
    renderExplorer({ value: { model: 'Orders', table: 'orders', metrics: ['Revenue'], dimensions: [] }, onExecute });
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
