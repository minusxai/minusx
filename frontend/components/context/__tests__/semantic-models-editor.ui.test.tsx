/**
 * SemanticModelsSection — per-connection semantic-model editor (rendered inside
 * the Databases tab above Data Models; the connection is implied, never picked).
 *
 * Data-Models look & feel: an own bordered container with a header bar, one
 * COMPACT ROW per model (name · description · counts), and the full definition
 * expanding BELOW the row (`toggle-semantic-model-<name>`). Read mode renders
 * the expanded definitions as text; edit mode swaps them for inputs.
 *
 * Pickers are SchemaOptionPicker popovers (click trigger → click option row),
 * not native selects. Columns resolve on demand via the shared
 * use-table-columns cache when the bounded schema shipped names-only.
 * Text inputs are DRAFTS: they commit on blur/Enter, never per keystroke.
 *
 * Unit tests: mount the component directly with props (no full-app flow).
 * All queries via aria-label ONLY (repo rule).
 */
import React from 'react';
import { screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import SemanticModelsSection, { parseSemanticModelIssues } from '@/components/context/SemanticModelsEditor';
import { testSemanticModel } from '@/lib/semantic/models-client';
import { clearTableColumnsCache } from '@/lib/hooks/use-table-columns';
import { CompletionsAPI } from '@/lib/data/completions/completions';
import type { SemanticModelV2, DatabaseWithSchema, ViewDef } from '@/lib/types';

vi.mock('@/lib/semantic/models-client', () => ({
  testSemanticModel: vi.fn(async () => ({ issues: [], verified: {} })),
}));
vi.mock('@/lib/data/completions/completions', () => ({
  CompletionsAPI: { getColumnSuggestions: vi.fn(async () => ({ success: false })) },
}));
const mockTest = vi.mocked(testSemanticModel);
const mockColumns = vi.mocked(CompletionsAPI.getColumnSuggestions);

const TABLE_COLUMNS: Record<string, { name: string; type: string }[]> = {
  orders: [
    { name: 'id', type: 'BIGINT' },
    { name: 'customer_id', type: 'BIGINT' },
    { name: 'total', type: 'DOUBLE' },
    { name: 'created_at', type: 'TIMESTAMP' },
  ],
  customers: [
    { name: 'id', type: 'BIGINT' },
    { name: 'name', type: 'VARCHAR' },
  ],
  order_tags: [
    { name: 'order_id', type: 'BIGINT' },
    { name: 'tag_id', type: 'BIGINT' },
  ],
  tags: [
    { name: 'id', type: 'BIGINT' },
    { name: 'label', type: 'VARCHAR' },
  ],
};

const DATABASE: DatabaseWithSchema = {
  databaseName: 'warehouse',
  schemas: [
    {
      schema: 'mxfood',
      tables: Object.entries(TABLE_COLUMNS).map(([table, columns]) => ({ table, columns })),
    },
  ],
};

/** The memory-bounded (names-only) shape of the same schema — no columns. */
const DATABASE_BOUNDED: DatabaseWithSchema = {
  databaseName: 'warehouse',
  schemas: [
    {
      schema: 'mxfood',
      tables: Object.keys(TABLE_COLUMNS).map((table) => ({ table, columns: [] })),
    },
  ],
};

const ZONE_VIEW: ViewDef = {
  name: 'zone_revenue',
  connection: 'warehouse',
  sql: 'SELECT 1',
  columns: [{ name: 'zone_name', type: 'VARCHAR' }, { name: 'revenue', type: 'DOUBLE' }],
};

const ORDERS_MODEL: SemanticModelV2 = {
  name: 'Orders',
  description: 'Order-level facts',
  connection: 'warehouse',
  primary: { kind: 'table', schema: 'mxfood', table: 'orders' },
  primaryKey: ['id'],
  references: [
    {
      source: { kind: 'table', schema: 'mxfood', table: 'customers' },
      alias: 'customer',
      relationship: 'many_to_one',
      on: [{ primaryColumn: 'customer_id', referencedColumn: 'id' }],
    },
  ],
  dimensions: [
    { name: 'Order Date', source: 'primary', column: 'created_at', temporal: true },
    { name: 'Customer Name', source: 'customer', column: 'name' },
  ],
  metrics: [
    { name: 'Revenue', type: 'aggregation', agg: 'SUM', column: 'total' },
    { name: 'Order Count', type: 'aggregation', agg: 'COUNT' },
    { name: 'AOV', type: 'ratio', numerator: 'Revenue', denominator: 'Order Count' },
    { name: 'Net Revenue', type: 'sql', sql: 'SUM(primary.total) - 5', verified: false },
  ],
};

const renderSection = (over: Partial<React.ComponentProps<typeof SemanticModelsSection>> = {}) => {
  const onChange = vi.fn();
  renderWithProviders(
    <SemanticModelsSection
      connection="warehouse"
      database={DATABASE}
      views={[ZONE_VIEW]}
      models={[ORDERS_MODEL]}
      editMode={true}
      contextPath="/org/context"
      onChange={onChange}
      {...over}
    />,
  );
  return { onChange };
};

/** Expand the definition body below a model's row. */
const expand = (name: string) => fireEvent.click(screen.getByLabelText(`toggle-semantic-model-${name}`));

/** Pick an option in a SchemaOptionPicker: open the trigger, click the row. */
const pick = async (label: string, value: string) => {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.click(await screen.findByLabelText(`${label}-option-${value}`));
};

/** Commit a draft input: type, then blur. */
const commitInput = (label: string, value: string) => {
  const input = screen.getByLabelText(label);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
};

beforeEach(() => {
  clearTableColumnsCache();
  mockColumns.mockReset();
  mockColumns.mockImplementation(async ({ table }) => {
    const columns = TABLE_COLUMNS[table];
    if (!columns) return { success: false, error: 'not found' };
    return { success: true, columns: columns.map((c) => ({ ...c, displayName: c.name })) };
  });
});

describe('data-models look: compact rows, definitions expand below', () => {
  it('renders one row per model with name, description, and counts; body hidden until expanded', () => {
    renderSection();
    const row = screen.getByLabelText('semantic-model-row-Orders');
    expect(row.textContent).toContain('Orders');
    expect(row.textContent).toContain('Order-level facts');
    expect(row.textContent).toContain('2 dims');
    expect(row.textContent).toContain('4 metrics');
    // definition body is collapsed
    expect(screen.queryByLabelText('semantic-model-0-name')).toBeNull();
    expand('Orders');
    expect((screen.getByLabelText('semantic-model-0-name') as HTMLInputElement).value).toBe('Orders');
  });

  it('read mode with no models renders nothing (no empty container)', () => {
    renderSection({ editMode: false, models: [] });
    expect(screen.queryByLabelText('Semantic models for warehouse')).toBeNull();
  });

  it('edit mode with no models renders the container with a hint and the add button', () => {
    renderSection({ models: [] });
    expect(screen.getByLabelText('Semantic models for warehouse')).toBeTruthy();
    expect(screen.getByLabelText('add-semantic-model')).toBeTruthy();
  });

  it('inherited models render as read-only rows', () => {
    renderSection({ models: [], inheritedModels: [ORDERS_MODEL] });
    const row = screen.getByLabelText('semantic-model-row-inherited-Orders');
    expect(row.textContent).toContain('inherited');
    expand('Orders');
    // read-only: definitions as text, no inputs
    expect(screen.queryByLabelText('semantic-model-0-name')).toBeNull();
    expect(screen.getByLabelText('semantic-model-0-metric-0-definition').textContent).toContain('SUM(total)');
  });
});

describe('one layout for both modes', () => {
  it('read mode shows full definitions as text: metric formulas, dimension mappings, joins', () => {
    renderSection({ editMode: false });
    expand('Orders');
    expect(screen.getByLabelText('semantic-model-0-metric-0-definition').textContent).toContain('SUM(total)');
    expect(screen.getByLabelText('semantic-model-0-metric-2-definition').textContent).toContain('Revenue ÷ Order Count');
    expect(screen.getByLabelText('semantic-model-0-dimension-1-definition').textContent).toContain('customer.name');
    expect(screen.getByLabelText('semantic-model-0-reference-0-join').textContent)
      .toContain('orders.customer_id = customers.id');
    // No edit affordances in read mode.
    expect(screen.queryByLabelText('add-semantic-model')).toBeNull();
    expect(screen.queryByLabelText('semantic-model-0-name')).toBeNull();
  });

  it('edit mode renders the same sections with inputs, plus + buttons on each heading', () => {
    renderSection();
    expand('Orders');
    expect((screen.getByLabelText('semantic-model-0-name') as HTMLInputElement).value).toBe('Orders');
    for (const label of [
      'semantic-model-0-add-reference',
      'semantic-model-0-add-time-dimension',
      'semantic-model-0-add-dimension',
      'semantic-model-0-add-metric',
    ]) expect(screen.getByLabelText(label)).toBeTruthy();
    // the unverified stamp shows in both modes
    expect(screen.getByLabelText('semantic-model-0-metric-3-unverified')).toBeTruthy();
  });

  it('temporal dimensions render under Time Dimensions, others under Dimensions', () => {
    renderSection({ editMode: false });
    expand('Orders');
    const time = screen.getByLabelText('semantic-model-0-time-dimensions');
    const dims = screen.getByLabelText('semantic-model-0-plain-dimensions');
    expect(time.textContent).toContain('Order Date');
    expect(dims.textContent).toContain('Customer Name');
    expect(dims.textContent).not.toContain('Order Date');
  });
});

describe('draft inputs commit on blur, never per keystroke (perf contract)', () => {
  it('typing in the name field does not emit; blur commits exactly once', () => {
    const { onChange } = renderSection();
    expand('Orders');
    const input = screen.getByLabelText('semantic-model-0-name');
    fireEvent.change(input, { target: { value: 'O' } });
    fireEvent.change(input, { target: { value: 'Or' } });
    fireEvent.change(input, { target: { value: 'Orders v2' } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect((onChange.mock.calls[0][0] as SemanticModelV2[])[0].name).toBe('Orders v2');
  });

  it('an unchanged blur does not emit', () => {
    const { onChange } = renderSection();
    expand('Orders');
    fireEvent.blur(screen.getByLabelText('semantic-model-0-name'));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('creating a model', () => {
  it('add PREPENDS a new model for this connection at the top', () => {
    const { onChange } = renderSection();
    fireEvent.click(screen.getByLabelText('add-semantic-model'));
    const next = onChange.mock.calls[0][0] as SemanticModelV2[];
    expect(next).toHaveLength(2);
    expect(next[0].name).toBe('new_model');
    expect(next[0].connection).toBe('warehouse');
    expect(next[1].name).toBe('Orders');
  });

  it('picking a primary on an empty model auto-prefills vocabulary (temporal dims first, Count metric)', async () => {
    const empty: SemanticModelV2 = {
      name: 'new_model', connection: 'warehouse',
      primary: { kind: 'table', table: '' }, dimensions: [], metrics: [],
    };
    const { onChange } = renderSection({ models: [empty] });
    expand('new_model');
    await pick('semantic-model-0-primary-source', 't|mxfood|orders');
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const next = (onChange.mock.calls[0][0] as SemanticModelV2[])[0];
    expect(next.primary).toEqual({ kind: 'table', schema: 'mxfood', table: 'orders' });
    expect(next.metrics.some((m) => m.name === 'Count')).toBe(true);
    expect(next.dimensions[0]?.temporal).toBe(true);
    expect(next.name).not.toBe('new_model'); // named from the table
  });

  it('deletes a model by name', () => {
    const { onChange } = renderSection();
    fireEvent.click(screen.getByLabelText('delete-semantic-model-Orders'));
    expect(onChange.mock.calls[0][0]).toEqual([]);
  });
});

describe('on-demand columns — the bounded (names-only) schema still works', () => {
  it('column pickers populate from the completions API when the local schema has no columns', async () => {
    renderSection({ database: DATABASE_BOUNDED });
    expand('Orders');
    fireEvent.click(screen.getByLabelText('semantic-model-0-metric-0-column'));
    expect(await screen.findByLabelText('semantic-model-0-metric-0-column-option-total')).toBeTruthy();
    expect(mockColumns).toHaveBeenCalledWith(expect.objectContaining({
      databaseName: 'warehouse', table: 'orders', schema: 'mxfood',
    }));
  });

  it('primary prefill works from fetched columns too', async () => {
    const empty: SemanticModelV2 = {
      name: 'new_model', connection: 'warehouse',
      primary: { kind: 'table', table: '' }, dimensions: [], metrics: [],
    };
    const { onChange } = renderSection({ database: DATABASE_BOUNDED, models: [empty] });
    expand('new_model');
    await pick('semantic-model-0-primary-source', 't|mxfood|orders');
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const next = (onChange.mock.calls[0][0] as SemanticModelV2[])[0];
    expect(next.dimensions.length).toBeGreaterThan(0);
    expect(next.metrics.some((m) => m.name === 'Count')).toBe(true);
  });
});

describe('references — inferred joins, no bridge jargon', () => {
  it('picking a to-one source infers alias AND join columns by name', async () => {
    const bare: SemanticModelV2 = {
      ...ORDERS_MODEL,
      references: [{
        source: { kind: 'table', table: '' },
        alias: '',
        relationship: 'many_to_one',
        on: [{ primaryColumn: '', referencedColumn: '' }],
      }],
      dimensions: ORDERS_MODEL.dimensions.filter((d) => d.source === 'primary'),
    };
    const { onChange } = renderSection({ models: [bare] });
    expand('Orders');
    await pick('semantic-model-0-reference-0-source', 't|mxfood|customers');
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const next = (onChange.mock.calls[0][0] as SemanticModelV2[])[0];
    const ref = next.references![0];
    expect(ref.alias).toBe('customer');
    expect((ref as { on: unknown }).on).toEqual([{ primaryColumn: 'customer_id', referencedColumn: 'id' }]);
  });

  it('the join line spells REAL table.column equalities (edit mode too)', () => {
    renderSection();
    expand('Orders');
    expect(screen.getByLabelText('semantic-model-0-reference-0-join').textContent)
      .toContain('orders.customer_id = customers.id');
  });

  it('switching to many-to-many + picking a via table infers the whole through mapping and the grain', async () => {
    const withTagRef: SemanticModelV2 = {
      ...ORDERS_MODEL,
      primaryKey: undefined,
      references: [{
        source: { kind: 'table', schema: 'mxfood', table: 'tags' },
        alias: 'tag',
        relationship: 'many_to_one',
        on: [{ primaryColumn: '', referencedColumn: '' }],
      }],
      dimensions: [],
    };
    const { onChange } = renderSection({ models: [withTagRef] });
    expand('Orders');
    await pick('semantic-model-0-reference-0-relationship', 'many_to_many');
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    let next = (onChange.mock.calls[0][0] as SemanticModelV2[])[0];
    expect(next.references![0].relationship).toBe('many_to_many');

    cleanup(); // fresh mount for the second stage — labels must stay unique
    const { onChange: onChange2 } = renderSection({ models: [next] });
    expand('Orders');
    await pick('semantic-model-0-reference-0-via-source', 't|mxfood|order_tags');
    await waitFor(() => expect(onChange2).toHaveBeenCalled());
    next = (onChange2.mock.calls[0][0] as SemanticModelV2[])[0];
    const ref = next.references![0] as { through: { primaryOn: unknown; referencedOn: unknown } };
    expect(ref.through.primaryOn).toEqual([{ primaryColumn: 'id', bridgeColumn: 'order_id' }]);
    expect(ref.through.referencedOn).toEqual([{ bridgeColumn: 'tag_id', referencedColumn: 'id' }]);
    expect(next.primaryKey).toEqual(['id']); // grain inferred alongside
  });

  it('renaming a reference alias cascades to dimensions that use it', () => {
    const { onChange } = renderSection();
    expand('Orders');
    commitInput('semantic-model-0-reference-0-alias', 'buyer');
    const next = (onChange.mock.calls[0][0] as SemanticModelV2[])[0];
    expect(next.references![0].alias).toBe('buyer');
    expect(next.dimensions.find((d) => d.name === 'Customer Name')!.source).toBe('buyer');
  });
});

describe('metrics — one list, three types', () => {
  it('add-metric appends an aggregation metric (COUNT default)', () => {
    const { onChange } = renderSection();
    expand('Orders');
    fireEvent.click(screen.getByLabelText('semantic-model-0-add-metric'));
    const next = (onChange.mock.calls[0][0] as SemanticModelV2[])[0];
    const added = next.metrics[next.metrics.length - 1];
    expect(added).toMatchObject({ type: 'aggregation', agg: 'COUNT' });
  });

  it('ratio numerator/denominator options are AGGREGATION metrics only', async () => {
    renderSection();
    expand('Orders');
    fireEvent.click(screen.getByLabelText('semantic-model-0-metric-2-numerator'));
    expect(await screen.findByLabelText('semantic-model-0-metric-2-numerator-option-Revenue')).toBeTruthy();
    expect(screen.getByLabelText('semantic-model-0-metric-2-numerator-option-Order Count')).toBeTruthy();
    // AOV / Net Revenue excluded
    expect(screen.queryByLabelText('semantic-model-0-metric-2-numerator-option-AOV')).toBeNull();
    expect(screen.queryByLabelText('semantic-model-0-metric-2-numerator-option-Net Revenue')).toBeNull();
  });

  it('switching a metric type converts it in place (name preserved)', async () => {
    const { onChange } = renderSection();
    expand('Orders');
    await pick('semantic-model-0-metric-1-type', 'sql');
    const next = (onChange.mock.calls[0][0] as SemanticModelV2[])[0];
    expect(next.metrics[1]).toMatchObject({ type: 'sql', name: 'Order Count' });
  });
});

describe('names auto-fill from the picked column', () => {
  it('picking a dimension column fills an empty name (humanized)', async () => {
    const m: SemanticModelV2 = {
      ...ORDERS_MODEL,
      dimensions: [...ORDERS_MODEL.dimensions, { name: '', source: 'primary', column: '' }],
    };
    const { onChange } = renderSection({ models: [m] });
    expand('Orders');
    await pick('semantic-model-0-dimension-2-field', 'primary|customer_id');
    const next = (onChange.mock.calls[0][0] as SemanticModelV2[])[0];
    expect(next.dimensions[2]).toMatchObject({ column: 'customer_id', name: 'Customer Id' });
  });

  it('a hand-typed name is NEVER clobbered by a later column change', async () => {
    const m: SemanticModelV2 = {
      ...ORDERS_MODEL,
      dimensions: [...ORDERS_MODEL.dimensions, { name: 'My Field', source: 'primary', column: 'total' }],
    };
    const { onChange } = renderSection({ models: [m] });
    expand('Orders');
    await pick('semantic-model-0-dimension-2-field', 'primary|customer_id');
    const next = (onChange.mock.calls[0][0] as SemanticModelV2[])[0];
    expect(next.dimensions[2].name).toBe('My Field');
  });

  it('an auto-filled name FOLLOWS a column change (still auto)', async () => {
    const m: SemanticModelV2 = {
      ...ORDERS_MODEL,
      dimensions: [...ORDERS_MODEL.dimensions, { name: 'Total', source: 'primary', column: 'total' }],
    };
    const { onChange } = renderSection({ models: [m] });
    expand('Orders');
    await pick('semantic-model-0-dimension-2-field', 'primary|customer_id');
    const next = (onChange.mock.calls[0][0] as SemanticModelV2[])[0];
    expect(next.dimensions[2].name).toBe('Customer Id');
  });

  it('picking an aggregation-metric column fills an empty name from the agg (SUM → Total X)', async () => {
    const m: SemanticModelV2 = {
      ...ORDERS_MODEL,
      metrics: [...ORDERS_MODEL.metrics, { name: '', type: 'aggregation', agg: 'SUM' }],
    };
    const { onChange } = renderSection({ models: [m] });
    expand('Orders');
    await pick('semantic-model-0-metric-4-column', 'total');
    const next = (onChange.mock.calls[0][0] as SemanticModelV2[])[0];
    expect(next.metrics[4]).toMatchObject({ column: 'total', name: 'Total Total' });
  });
});

describe('live tier-1 validation (no save needed)', () => {
  it('a duplicate name surfaces inline immediately (and force-opens the row)', () => {
    const m: SemanticModelV2 = {
      ...ORDERS_MODEL,
      dimensions: [...ORDERS_MODEL.dimensions, { name: 'Customer Name', source: 'primary', column: 'total' }],
    };
    renderSection({ models: [m] });
    // no manual expand — a row with issues opens itself
    expect(screen.getByLabelText('semantic-model-0-issues').textContent)
      .toContain('declared more than once');
  });

  it('incomplete rows (empty names/columns) do NOT nag', () => {
    const m: SemanticModelV2 = {
      ...ORDERS_MODEL,
      dimensions: [...ORDERS_MODEL.dimensions, { name: '', source: 'primary', column: '' }],
      metrics: [...ORDERS_MODEL.metrics, { name: '', type: 'aggregation', agg: 'COUNT' }],
    };
    renderSection({ models: [m] });
    expand('Orders');
    expect(screen.queryByLabelText('semantic-model-0-issues')).toBeNull();
  });

  it('read mode never runs live validation', () => {
    const m: SemanticModelV2 = {
      ...ORDERS_MODEL,
      dimensions: [...ORDERS_MODEL.dimensions, { name: 'Customer Name', source: 'primary', column: 'total' }],
    };
    renderSection({ models: [m], editMode: false });
    expand('Orders');
    expect(screen.queryByLabelText('semantic-model-0-issues')).toBeNull();
  });
});

describe('time dimensions', () => {
  it('add-time-dimension appends a temporal primary dimension', () => {
    const { onChange } = renderSection();
    expand('Orders');
    fireEvent.click(screen.getByLabelText('semantic-model-0-add-time-dimension'));
    const next = (onChange.mock.calls[0][0] as SemanticModelV2[])[0];
    const added = next.dimensions[next.dimensions.length - 1];
    expect(added.temporal).toBe(true);
    expect(added.source).toBe('primary');
  });
});

// ---------------------------------------------------------------------------
// Save-gate issues (tiers 1–3) rendered INLINE at the row that caused them.
// ---------------------------------------------------------------------------

const ENGINE_ISSUE =
  'Semantic model "Orders": metric "Net Revenue" failed engine validation: Binder Error: Referenced column "totl" not found\n'
  + 'LINE 1: SELECT SUM(orders.totl) - 5';
const MODEL_ISSUE =
  'Semantic model "Orders": dimension "Customer Name" is not an exposed column of reference "customer"';
const UNKNOWN_MODEL_ISSUE =
  'Semantic model "Shipments": primary table mxfood.shipments is not exposed by this context';

describe('save-gate issues surface at the row that caused them', () => {
  it('renders each issue under the model / metric row it names (auto-opening the model)', () => {
    renderSection({ issues: [ENGINE_ISSUE, MODEL_ISSUE, UNKNOWN_MODEL_ISSUE] });

    // metric issue lands on the metric it names ('Net Revenue' is metric index 3)
    const metricIssue = screen.getByLabelText('semantic-model-0-metric-3-issue');
    expect(metricIssue.textContent).toContain('Binder Error');
    expect(metricIssue.textContent).toContain('SELECT SUM(orders.totl)');
    expect(screen.queryByLabelText('semantic-model-0-metric-0-issue')).toBeNull();

    const modelIssues = screen.getByLabelText('semantic-model-0-issues');
    expect(modelIssues.textContent).toContain('Customer Name');
    expect(modelIssues.textContent).not.toContain('Binder Error');

    const unattributed = screen.getByLabelText('semantic-model-unattributed-issues');
    expect(unattributed.textContent).toContain('Shipments');
  });

  it('renders no issue elements when the save gate reported nothing', () => {
    renderSection();
    expand('Orders');
    expect(screen.queryByLabelText('semantic-model-0-issues')).toBeNull();
    expect(screen.queryByLabelText('semantic-model-0-metric-3-issue')).toBeNull();
    expect(screen.queryByLabelText('semantic-model-unattributed-issues')).toBeNull();
  });

  it('parseSemanticModelIssues recovers the issue LIST from the save-error message', () => {
    const parsed = parseSemanticModelIssues([ENGINE_ISSUE, MODEL_ISSUE, UNKNOWN_MODEL_ISSUE].join('\n'));
    expect(parsed).toEqual([ENGINE_ISSUE, MODEL_ISSUE, UNKNOWN_MODEL_ISSUE]);
    expect(parseSemanticModelIssues('View "zone_revenue" reads a table outside the whitelist')).toEqual([]);
    expect(parseSemanticModelIssues('')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The Test button — save-gate tiers 1–3 for a STAGED model, no save needed.
// ---------------------------------------------------------------------------

describe('the Test button', () => {
  beforeEach(() => {
    mockTest.mockReset();
    mockTest.mockResolvedValue({ issues: [], verified: {} });
  });

  it('posts the STAGED model with the context path and shows the all-clear', async () => {
    renderSection();
    fireEvent.click(screen.getByLabelText('semantic-model-0-test'));
    await waitFor(() => expect(screen.getByLabelText('semantic-model-0-test-ok')).toBeTruthy());
    expect(mockTest).toHaveBeenCalledWith('/org/context', expect.objectContaining({ name: 'Orders' }));
  });

  it('engine failures land on the metric row they name — before any save', async () => {
    mockTest.mockResolvedValue({
      issues: ['Semantic model "Orders": metric "Net Revenue" failed engine validation: Parser Error: syntax error at or near "AS"'],
      verified: {},
    });
    renderSection();
    fireEvent.click(screen.getByLabelText('semantic-model-0-test'));
    await waitFor(() =>
      expect(screen.getByLabelText('semantic-model-0-metric-3-issue').textContent).toContain('Parser Error'));
    expect(screen.queryByLabelText('semantic-model-0-test-ok')).toBeNull();
  });

  it('editing the model clears a stale test verdict', async () => {
    renderSection();
    fireEvent.click(screen.getByLabelText('semantic-model-0-test'));
    await waitFor(() => expect(screen.getByLabelText('semantic-model-0-test-ok')).toBeTruthy());
    expand('Orders');
    commitInput('semantic-model-0-description', 'edited');
    expect(screen.queryByLabelText('semantic-model-0-test-ok')).toBeNull();
  });

  it('read mode has no Test button', () => {
    renderSection({ editMode: false });
    expect(screen.queryByLabelText('semantic-model-0-test')).toBeNull();
  });
});
