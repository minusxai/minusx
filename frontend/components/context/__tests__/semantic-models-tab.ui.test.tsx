/**
 * SemanticModelsTabContent tests (jsdom) — the authoring UX contract:
 *  - VIEW mode is typography-only: no inputs/selects, definitions rendered
 *  - EDIT mode is progressive: table-first, then suggestion chips that
 *    one-click-add Title-Cased dimensions/measures, time as toggle chips
 *  - live validation issues render on incomplete models
 */
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { Tabs } from '@chakra-ui/react';
import { SemanticModelsTabContent } from '@/components/context/SemanticModelsTabContent';
import type { ContextContent, DatabaseWithSchema, SemanticModel } from '@/lib/types';

const DATABASES: DatabaseWithSchema[] = [{
  databaseName: 'warehouse',
  schemas: [{
    schema: 'mxfood',
    tables: [{
      table: 'orders',
      columns: [
        { name: 'order_status', type: 'VARCHAR' },
        { name: 'total', type: 'DOUBLE' },
        { name: 'created_at', type: 'TIMESTAMP' },
      ],
    }],
  }],
}];

const ORDERS_MODEL: SemanticModel = {
  name: 'Orders',
  connection: 'warehouse',
  schema: 'mxfood',
  table: 'orders',
  timeDimension: { column: 'created_at' },
  dimensions: [{ name: 'Status', column: 'order_status' }],
  measures: [{ name: 'Revenue', agg: 'SUM', column: 'total' }],
  metrics: [{ name: 'AOV', type: 'ratio', numerator: 'Revenue', denominator: 'Revenue' }],
};

const content = (models: SemanticModel[]): ContextContent =>
  ({ versions: [], published: { all: 1 }, semanticModels: models } as unknown as ContextContent);

const renderTab = (models: SemanticModel[], editMode: boolean, onChange = vi.fn()) => {
  renderWithProviders(
    <Tabs.Root value="semantic">
      <SemanticModelsTabContent
        content={content(models)}
        onChange={onChange}
        editMode={editMode}
        availableDatabases={DATABASES}
      />
    </Tabs.Root>
  );
  return onChange;
};

describe('SemanticModelsTabContent — view mode', () => {
  it('renders a typography-only spec card: no form controls at all', () => {
    renderTab([ORDERS_MODEL], false);
    expect(document.querySelectorAll('select, input').length).toBe(0);
    // Definitions rendered as text
    expect(screen.getByText('= SUM(total)')).toBeTruthy();
    expect(screen.getByText('= Revenue / Revenue')).toBeTruthy();
    expect(screen.getByText('order_status')).toBeTruthy();
  });
});

describe('SemanticModelsTabContent — edit mode', () => {
  it('is table-first: an empty model shows only the guided table prompt', () => {
    renderTab([{ name: '', connection: '', table: '', dimensions: [], measures: [] }], true);
    expect(screen.getByLabelText('Semantic model table')).toBeTruthy();
    // No sections yet
    expect(screen.queryByLabelText('Add dimension')).toBeNull();
    expect(screen.queryByLabelText('Add measure')).toBeNull();
  });

  it('offers time toggle chips for temporal columns and suggestion chips for the rest', () => {
    renderTab([ORDERS_MODEL], true);
    expect(screen.getByLabelText('Time column created_at').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByLabelText('Time column none').getAttribute('aria-pressed')).toBe('false');
    // total is numeric and unused as a dimension → not suggested as dimension;
    // order_status is used → not suggested; nothing categorical remains.
    expect(screen.queryByLabelText('Suggested dimension order_status')).toBeNull();
    // Count-of-rows suggestion shows (model has no COUNT measure)
    expect(screen.getByLabelText('Suggested measure count of rows')).toBeTruthy();
  });

  it('one-click adds a Title-Cased dimension from a suggestion chip', () => {
    const model: SemanticModel = { ...ORDERS_MODEL, dimensions: [] };
    const onChange = renderTab([model], true);
    fireEvent.click(screen.getByLabelText('Suggested dimension order_status'));
    const next = onChange.mock.calls.at(-1)![0].semanticModels[0] as SemanticModel;
    expect(next.dimensions).toEqual([{ name: 'Order Status', column: 'order_status' }]);
  });

  it('shows live validation issues on incomplete models', () => {
    renderTab([{ ...ORDERS_MODEL, measures: [{ name: 'Revenue', agg: 'SUM' }] }], true);
    expect(screen.getByText(/needs a column for SUM/)).toBeTruthy();
  });

  it('only offers metrics once two named measures exist', () => {
    renderTab([{ ...ORDERS_MODEL, metrics: [] }], true);
    expect(screen.queryByLabelText('Add ratio metric')).toBeNull();

    renderTab([{
      ...ORDERS_MODEL,
      metrics: [],
      measures: [...ORDERS_MODEL.measures, { name: 'Count', agg: 'COUNT' }],
    }], true);
    expect(screen.getByLabelText('Add ratio metric')).toBeTruthy();
  });
});
