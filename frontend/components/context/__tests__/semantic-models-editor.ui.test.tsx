/**
 * SemanticModelsSection — per-connection semantic-model editor (rendered inside
 * the Databases tab above Data Models; the connection is implied, never picked).
 *
 * One layout for BOTH modes: read mode renders the same cards with definitions
 * as text; edit mode swaps them for inputs. Join columns are INFERRED on source
 * pick (lib/semantic/infer-join) — the author corrects, never assembles.
 *
 * Unit tests: mount the component directly with props (no full-app flow).
 * All queries via aria-label ONLY (repo rule).
 */
import React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import SemanticModelsSection, { parseSemanticModelIssues } from '@/components/context/SemanticModelsEditor';
import { testSemanticModel } from '@/lib/semantic/models-client';
import type { SemanticModelV2, DatabaseWithSchema, ViewDef } from '@/lib/types';

vi.mock('@/lib/semantic/models-client', () => ({
  testSemanticModel: vi.fn(async () => ({ issues: [], verified: {} })),
}));
const mockTest = vi.mocked(testSemanticModel);

const DATABASE: DatabaseWithSchema = {
  databaseName: 'warehouse',
  schemas: [
    {
      schema: 'mxfood',
      tables: [
        {
          table: 'orders',
          columns: [
            { name: 'id', type: 'BIGINT' },
            { name: 'customer_id', type: 'BIGINT' },
            { name: 'total', type: 'DOUBLE' },
            { name: 'created_at', type: 'TIMESTAMP' },
          ],
        },
        {
          table: 'customers',
          columns: [
            { name: 'id', type: 'BIGINT' },
            { name: 'name', type: 'VARCHAR' },
          ],
        },
        {
          table: 'order_tags',
          columns: [
            { name: 'order_id', type: 'BIGINT' },
            { name: 'tag_id', type: 'BIGINT' },
          ],
        },
        {
          table: 'tags',
          columns: [
            { name: 'id', type: 'BIGINT' },
            { name: 'label', type: 'VARCHAR' },
          ],
        },
      ],
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

describe('one layout for both modes', () => {
  it('read mode shows full definitions as text: metric formulas, dimension mappings, joins', () => {
    renderSection({ editMode: false });
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
    const time = screen.getByLabelText('semantic-model-0-time-dimensions');
    const dims = screen.getByLabelText('semantic-model-0-plain-dimensions');
    expect(time.textContent).toContain('Order Date');
    expect(dims.textContent).toContain('Customer Name');
    expect(dims.textContent).not.toContain('Order Date');
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

  it('picking a primary on an empty model auto-prefills vocabulary (temporal dims first, Count metric)', () => {
    const empty: SemanticModelV2 = {
      name: 'new_model', connection: 'warehouse',
      primary: { kind: 'table', table: '' }, dimensions: [], metrics: [],
    };
    const { onChange } = renderSection({ models: [empty] });
    fireEvent.change(screen.getByLabelText('semantic-model-0-primary-source'), {
      target: { value: 't|mxfood|orders' },
    });
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

describe('references — inferred joins, no bridge jargon', () => {
  it('picking a to-one source infers alias AND join columns by name', () => {
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
    fireEvent.change(screen.getByLabelText('semantic-model-0-reference-0-source'), {
      target: { value: 't|mxfood|customers' },
    });
    const next = (onChange.mock.calls[0][0] as SemanticModelV2[])[0];
    const ref = next.references![0];
    expect(ref.alias).toBe('customer');
    expect((ref as { on: unknown }).on).toEqual([{ primaryColumn: 'customer_id', referencedColumn: 'id' }]);
  });

  it('the join line spells REAL table.column equalities (edit mode too)', () => {
    renderSection();
    expect(screen.getByLabelText('semantic-model-0-reference-0-join').textContent)
      .toContain('orders.customer_id = customers.id');
  });

  it('switching to many-to-many + picking a via table infers the whole through mapping and the grain', () => {
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
    fireEvent.change(screen.getByLabelText('semantic-model-0-reference-0-relationship'), {
      target: { value: 'many_to_many' },
    });
    let next = (onChange.mock.calls[0][0] as SemanticModelV2[])[0];
    expect(next.references![0].relationship).toBe('many_to_many');

    const { onChange: onChange2 } = renderSection({ models: [next] });
    fireEvent.change(screen.getByLabelText('semantic-model-0-reference-0-via-source'), {
      target: { value: 't|mxfood|order_tags' },
    });
    next = (onChange2.mock.calls[0][0] as SemanticModelV2[])[0];
    const ref = next.references![0] as { through: { primaryOn: unknown; referencedOn: unknown } };
    expect(ref.through.primaryOn).toEqual([{ primaryColumn: 'id', bridgeColumn: 'order_id' }]);
    expect(ref.through.referencedOn).toEqual([{ bridgeColumn: 'tag_id', referencedColumn: 'id' }]);
    expect(next.primaryKey).toEqual(['id']); // grain inferred alongside
  });

  it('renaming a reference alias cascades to dimensions that use it', () => {
    const { onChange } = renderSection();
    fireEvent.change(screen.getByLabelText('semantic-model-0-reference-0-alias'), { target: { value: 'buyer' } });
    const next = (onChange.mock.calls[0][0] as SemanticModelV2[])[0];
    expect(next.references![0].alias).toBe('buyer');
    expect(next.dimensions.find((d) => d.name === 'Customer Name')!.source).toBe('buyer');
  });
});

describe('metrics — one list, three types', () => {
  it('add-metric appends an aggregation metric (COUNT default)', () => {
    const { onChange } = renderSection();
    fireEvent.click(screen.getByLabelText('semantic-model-0-add-metric'));
    const next = (onChange.mock.calls[0][0] as SemanticModelV2[])[0];
    const added = next.metrics[next.metrics.length - 1];
    expect(added).toMatchObject({ type: 'aggregation', agg: 'COUNT' });
  });

  it('ratio numerator/denominator options are AGGREGATION metrics only', () => {
    renderSection();
    const numerator = screen.getByLabelText('semantic-model-0-metric-2-numerator') as HTMLSelectElement;
    const options = Array.from(numerator.options).map((o) => o.value).filter(Boolean);
    expect(options).toEqual(['Revenue', 'Order Count']); // AOV / Net Revenue excluded
  });

  it('switching a metric type converts it in place (name preserved)', () => {
    const { onChange } = renderSection();
    fireEvent.change(screen.getByLabelText('semantic-model-0-metric-1-type'), { target: { value: 'sql' } });
    const next = (onChange.mock.calls[0][0] as SemanticModelV2[])[0];
    expect(next.metrics[1]).toMatchObject({ type: 'sql', name: 'Order Count' });
  });
});

describe('names auto-fill from the picked column', () => {
  it('picking a dimension column fills an empty name (humanized)', () => {
    const m: SemanticModelV2 = {
      ...ORDERS_MODEL,
      dimensions: [...ORDERS_MODEL.dimensions, { name: '', source: 'primary', column: '' }],
    };
    const { onChange } = renderSection({ models: [m] });
    fireEvent.change(screen.getByLabelText('semantic-model-0-dimension-2-field'), {
      target: { value: 'primary|customer_id' },
    });
    const next = (onChange.mock.calls[0][0] as SemanticModelV2[])[0];
    expect(next.dimensions[2]).toMatchObject({ column: 'customer_id', name: 'Customer Id' });
  });

  it('a hand-typed name is NEVER clobbered by a later column change', () => {
    const m: SemanticModelV2 = {
      ...ORDERS_MODEL,
      dimensions: [...ORDERS_MODEL.dimensions, { name: 'My Field', source: 'primary', column: 'total' }],
    };
    const { onChange } = renderSection({ models: [m] });
    fireEvent.change(screen.getByLabelText('semantic-model-0-dimension-2-field'), {
      target: { value: 'primary|customer_id' },
    });
    const next = (onChange.mock.calls[0][0] as SemanticModelV2[])[0];
    expect(next.dimensions[2].name).toBe('My Field');
  });

  it('an auto-filled name FOLLOWS a column change (still auto)', () => {
    const m: SemanticModelV2 = {
      ...ORDERS_MODEL,
      dimensions: [...ORDERS_MODEL.dimensions, { name: 'Total', source: 'primary', column: 'total' }],
    };
    const { onChange } = renderSection({ models: [m] });
    fireEvent.change(screen.getByLabelText('semantic-model-0-dimension-2-field'), {
      target: { value: 'primary|customer_id' },
    });
    const next = (onChange.mock.calls[0][0] as SemanticModelV2[])[0];
    expect(next.dimensions[2].name).toBe('Customer Id');
  });

  it('picking an aggregation-metric column fills an empty name from the agg (SUM → Total X)', () => {
    const m: SemanticModelV2 = {
      ...ORDERS_MODEL,
      metrics: [...ORDERS_MODEL.metrics, { name: '', type: 'aggregation', agg: 'SUM' }],
    };
    const { onChange } = renderSection({ models: [m] });
    fireEvent.change(screen.getByLabelText('semantic-model-0-metric-4-column'), {
      target: { value: 'total' },
    });
    const next = (onChange.mock.calls[0][0] as SemanticModelV2[])[0];
    expect(next.metrics[4]).toMatchObject({ column: 'total', name: 'Total Total' });
  });
});

describe('live tier-1 validation (no save needed)', () => {
  it('a duplicate name surfaces inline immediately', () => {
    const m: SemanticModelV2 = {
      ...ORDERS_MODEL,
      dimensions: [...ORDERS_MODEL.dimensions, { name: 'Customer Name', source: 'primary', column: 'total' }],
    };
    renderSection({ models: [m] });
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
    expect(screen.queryByLabelText('semantic-model-0-issues')).toBeNull();
  });

  it('read mode never runs live validation', () => {
    const m: SemanticModelV2 = {
      ...ORDERS_MODEL,
      dimensions: [...ORDERS_MODEL.dimensions, { name: 'Customer Name', source: 'primary', column: 'total' }],
    };
    renderSection({ models: [m], editMode: false });
    expect(screen.queryByLabelText('semantic-model-0-issues')).toBeNull();
  });
});

describe('time dimensions', () => {
  it('add-time-dimension appends a temporal primary dimension', () => {
    const { onChange } = renderSection();
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
  it('renders each issue under the model / metric row it names', () => {
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
    fireEvent.change(screen.getByLabelText('semantic-model-0-description'), { target: { value: 'edited' } });
    expect(screen.queryByLabelText('semantic-model-0-test-ok')).toBeNull();
  });

  it('read mode has no Test button', () => {
    renderSection({ editMode: false });
    expect(screen.queryByLabelText('semantic-model-0-test')).toBeNull();
  });
});
