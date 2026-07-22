/**
 * SchemaTreeView column display — expanding a table shows its columns. When
 * the (memory-bounded) schema arrives names-only, the columns are fetched on
 * demand via the column-suggestions API; when the schema still carries
 * columns, they render without any fetch.
 *
 * Queries use aria-labels only, per repo convention.
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import SchemaTreeView from '@/components/schema-browser/SchemaTreeView';
import { clearTableColumnsCache } from '@/lib/hooks/use-table-columns';
import { CompletionsAPI } from '@/lib/data/completions/completions';

vi.mock('@/lib/data/completions/completions', () => ({
  CompletionsAPI: { getColumnSuggestions: vi.fn() },
}));

const getColumnSuggestions = vi.mocked(CompletionsAPI.getColumnSuggestions);

const NAMES_ONLY_SCHEMAS = [
  { schema: 'main', tables: [{ table: 'orders', columns: [] }] },
];

const SCHEMAS_WITH_COLUMNS = [
  { schema: 'main', tables: [{ table: 'orders', columns: [{ name: 'status', type: 'varchar' }] }] },
];

beforeEach(() => {
  clearTableColumnsCache();
  getColumnSuggestions.mockReset();
});

async function expandTable() {
  await userEvent.click(await screen.findByLabelText('Toggle table main.orders'));
}

describe('SchemaTreeView expanded-table columns', () => {
  it('fetches and shows columns on demand when the bounded schema has none', async () => {
    getColumnSuggestions.mockResolvedValue({
      success: true,
      columns: [
        { name: 'id', type: 'integer', displayName: 'id' },
        { name: 'customer', type: 'varchar', displayName: 'customer' },
      ],
    });

    renderWithProviders(
      <SchemaTreeView
        schemas={NAMES_ONLY_SCHEMAS}
        showColumns
        connectionName="mxbi"
        defaultExpandedSchemas
      />,
    );

    await expandTable();

    expect(await screen.findByLabelText('Column main.orders.id')).toBeInTheDocument();
    expect(await screen.findByLabelText('Column main.orders.customer')).toBeInTheDocument();
    expect(getColumnSuggestions).toHaveBeenCalledWith({
      databaseName: 'mxbi',
      table: 'orders',
      schema: 'main',
    });
  });

  it('renders local columns without fetching when the schema still has them', async () => {
    renderWithProviders(
      <SchemaTreeView
        schemas={SCHEMAS_WITH_COLUMNS}
        showColumns
        connectionName="mxbi"
        defaultExpandedSchemas
      />,
    );

    await expandTable();

    expect(await screen.findByLabelText('Column main.orders.status')).toBeInTheDocument();
    await waitFor(() => expect(getColumnSuggestions).not.toHaveBeenCalled());
  });
});
