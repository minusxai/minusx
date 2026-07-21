/**
 * SemanticModelsEditor — M5b minimal-contract form editor + catalog for
 * authored semantic models (SemanticModelV2 on ContextVersion.semanticModels).
 *
 * Unit tests: mount the component directly with props (no full-app flow).
 * All queries via aria-label ONLY (repo rule).
 */
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import SemanticModelsEditor from '@/components/context/SemanticModelsEditor';
import type { SemanticModelV2, DatabaseWithSchema, ViewDef } from '@/lib/types';

const DATABASES: DatabaseWithSchema[] = [
  {
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
  },
];

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
  references: [
    {
      source: { kind: 'table', schema: 'mxfood', table: 'customers' },
      alias: 'customer',
      relationship: 'many_to_one',
      on: [{ primaryColumn: 'customer_id', referencedColumn: 'id' }],
    },
  ],
  dimensions: [
    { name: 'Customer Name', source: 'customer', column: 'name' },
    { name: 'Order Date', source: 'primary', column: 'created_at', temporal: true },
  ],
  measures: [
    { name: 'Revenue', agg: 'SUM', column: 'total', description: 'Total order value' },
    { name: 'Order Count', agg: 'COUNT' },
  ],
  metrics: [
    { name: 'AOV', type: 'ratio', numerator: 'Revenue', denominator: 'Order Count' },
    { name: 'Net Revenue', type: 'sql', sql: 'SUM(primary.total) - 5', verified: false },
  ],
  timeDimension: { column: 'created_at', label: 'Order date' },
};

function renderEditor(overrides: Partial<React.ComponentProps<typeof SemanticModelsEditor>> = {}) {
  const onChange = vi.fn();
  function Harness() {
    const [models, setModels] = React.useState<SemanticModelV2[]>(
      (overrides.models as SemanticModelV2[]) ?? [ORDERS_MODEL],
    );
    return (
      <SemanticModelsEditor
        databases={DATABASES}
        views={[ZONE_VIEW]}
        inheritedModels={[]}
        editMode={true}
        {...overrides}
        models={models}
        onChange={(next) => { onChange(next); setModels(next); }}
      />
    );
  }
  renderWithProviders(<Harness />);
  return { onChange };
}

describe('SemanticModelsEditor — edit mode', () => {
  it('renders the model fields: name, description, connection, primary source', () => {
    renderEditor();
    expect((screen.getByLabelText('semantic-model-0-name') as HTMLInputElement).value).toBe('Orders');
    expect((screen.getByLabelText('semantic-model-0-description') as HTMLInputElement).value).toBe('Order-level facts');
    expect((screen.getByLabelText('semantic-model-0-connection') as HTMLSelectElement).value).toBe('warehouse');
    // primary source select: tables AND views of the chosen connection
    const primary = screen.getByLabelText('semantic-model-0-primary-source') as HTMLSelectElement;
    expect(primary.value).toBe('t|mxfood|orders');
    const optionValues = Array.from(primary.options).map((o) => o.value);
    expect(optionValues).toContain('v|zone_revenue');
  });

  it('adds a model and deletes a model by name', () => {
    const { onChange } = renderEditor({ models: [] });
    fireEvent.click(screen.getByLabelText('add-semantic-model'));
    expect(onChange).toHaveBeenCalledTimes(1);
    const added = onChange.mock.calls[0][0] as SemanticModelV2[];
    expect(added).toHaveLength(1);
    expect(added[0].connection).toBe('warehouse');

    fireEvent.click(screen.getByLabelText(`delete-semantic-model-${added[0].name}`));
    const afterDelete = onChange.mock.calls[1][0] as SemanticModelV2[];
    expect(afterDelete).toHaveLength(0);
  });

  it('adds a dimension via the pickers and emits the updated semanticModels array', () => {
    const { onChange } = renderEditor();
    fireEvent.click(screen.getByLabelText('semantic-model-0-add-dimension'));
    let models = onChange.mock.calls.at(-1)![0] as SemanticModelV2[];
    expect(models[0].dimensions).toHaveLength(3);

    const idx = 2;
    fireEvent.change(screen.getByLabelText(`semantic-model-0-dimension-${idx}-name`), { target: { value: 'Zone' } });
    // source select offers 'primary' + declared aliases
    const source = screen.getByLabelText(`semantic-model-0-dimension-${idx}-source`) as HTMLSelectElement;
    expect(Array.from(source.options).map((o) => o.value)).toEqual(expect.arrayContaining(['primary', 'customer']));
    fireEvent.change(source, { target: { value: 'customer' } });
    // column select scoped to the chosen source's columns
    const column = screen.getByLabelText(`semantic-model-0-dimension-${idx}-column`) as HTMLSelectElement;
    expect(Array.from(column.options).map((o) => o.value)).toEqual(expect.arrayContaining(['id', 'name']));
    fireEvent.change(column, { target: { value: 'name' } });

    models = onChange.mock.calls.at(-1)![0] as SemanticModelV2[];
    expect(models[0].dimensions[idx]).toMatchObject({ name: 'Zone', source: 'customer', column: 'name' });
  });

  it('shows the primaryKey select once a reference is many_to_many', () => {
    const { onChange } = renderEditor();
    expect(screen.queryByLabelText('semantic-model-0-primary-key')).toBeNull();

    fireEvent.change(screen.getByLabelText('semantic-model-0-reference-0-relationship'), {
      target: { value: 'many_to_many' },
    });
    const models = onChange.mock.calls.at(-1)![0] as SemanticModelV2[];
    expect(models[0].references![0].relationship).toBe('many_to_many');

    // primaryKey select appears (single primary column), plus the m2m bridge pickers
    expect(screen.getByLabelText('semantic-model-0-primary-key')).toBeTruthy();
    expect(screen.getByLabelText('semantic-model-0-reference-0-bridge-source')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('semantic-model-0-primary-key'), { target: { value: 'id' } });
    const next = onChange.mock.calls.at(-1)![0] as SemanticModelV2[];
    expect(next[0].primaryKey).toEqual(['id']);
  });

  it('edits measures and metrics; sql metric shows unverified badge when verified === false', () => {
    renderEditor();
    expect((screen.getByLabelText('semantic-model-0-measure-0-agg') as HTMLSelectElement).value).toBe('SUM');
    // COUNT measure allows an empty column
    expect((screen.getByLabelText('semantic-model-0-measure-1-column') as HTMLSelectElement).value).toBe('');
    // ratio metric numerator/denominator draw from declared measures
    const numerator = screen.getByLabelText('semantic-model-0-metric-0-numerator') as HTMLSelectElement;
    expect(Array.from(numerator.options).map((o) => o.value)).toEqual(expect.arrayContaining(['Revenue', 'Order Count']));
    // sql metric textarea + unverified badge
    expect((screen.getByLabelText('semantic-model-0-metric-1-sql') as HTMLTextAreaElement).value).toContain('primary.total');
    expect(screen.getByLabelText('semantic-model-0-metric-1-unverified')).toBeTruthy();
  });

  it('catalog toggle shows dimensions/measures/metrics only — no source pickers or SQL', () => {
    renderEditor();
    fireEvent.click(screen.getByLabelText('semantic-model-catalog-toggle'));
    // business names visible, grouped under the connection
    const catalog = screen.getByLabelText('semantic-model-catalog-warehouse');
    expect(catalog.textContent).toContain('Orders');
    expect(catalog.textContent).toContain('Customer Name');
    expect(catalog.textContent).toContain('Revenue');
    expect(catalog.textContent).toContain('AOV');
    expect(catalog.textContent).toContain('Net Revenue');
    // no editing surfaces in catalog mode
    expect(screen.queryByLabelText('semantic-model-0-primary-source')).toBeNull();
    expect(screen.queryByLabelText('semantic-model-0-metric-1-sql')).toBeNull();
    expect(catalog.textContent).not.toContain('SUM(primary.total)');
  });
});

describe('SemanticModelsEditor — view mode', () => {
  it('renders the catalog when not in edit mode (no form controls)', () => {
    renderEditor({ editMode: false });
    expect(screen.getByLabelText('semantic-model-catalog-warehouse')).toBeTruthy();
    expect(screen.queryByLabelText('add-semantic-model')).toBeNull();
    expect(screen.queryByLabelText('semantic-model-0-name')).toBeNull();
  });

  it('prefill: derives draft dimensions/measures from the primary table schema', async () => {
    const { onChange } = renderEditor({ models: [{
      name: 'Orders', connection: 'warehouse',
      primary: { kind: 'table', schema: 'mxfood', table: 'orders' },
      dimensions: [], measures: [], metrics: [],
    }] });
    const btn = await screen.findByLabelText('semantic-model-0-prefill');
    fireEvent.click(btn);
    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls[0][0][0];
    // Derived from the orders columns fixture: a dimension and SUM/AVG measures.
    expect(next.dimensions.length).toBeGreaterThan(0);
    expect(next.measures.some((ms: { agg: string }) => ms.agg === 'SUM')).toBe(true);
  });


  it('renaming a reference alias cascades to dimensions that use it', () => {
    const { onChange } = renderEditor();
    fireEvent.change(screen.getByLabelText('semantic-model-0-reference-0-alias'), { target: { value: 'buyer' } });
    const next = onChange.mock.calls[0][0][0];
    expect(next.references[0].alias).toBe('buyer');
    // 'Customer Name' pointed at the old alias 'customer' — it must follow,
    // or the save gate rejects the model with a dangling-source error.
    expect(next.dimensions.find((d: { name: string }) => d.name === 'Customer Name').source).toBe('buyer');
  });

});
