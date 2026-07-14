/**
 * TableRelationshipsEditor — per-table FK relationship editing inside the
 * schema-tree table row (the whitelist UI). Relationships are the only
 * authored semantic input; everything else derives from the schema.
 */
import React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import TableRelationshipsEditor from '@/components/context/TableRelationshipsEditor';
import type { TableRelationship } from '@/lib/types';

const TABLES = [
  { schema: 'public', table: 'orders', columns: [{ name: 'id', type: 'INTEGER' }, { name: 'user_id', type: 'INTEGER' }, { name: 'amount', type: 'DOUBLE' }] },
  { schema: 'public', table: 'users', columns: [{ name: 'id', type: 'INTEGER' }, { name: 'country', type: 'VARCHAR' }] },
];

const REL: TableRelationship = {
  connection: 'warehouse', schema: 'public', table: 'orders',
  column: 'user_id', targetSchema: 'public', targetTable: 'users', targetColumn: 'id',
  relationship: 'many_to_one',
};

/**
 * Stateful harness — the real parent (schema tree → context container) holds
 * the relationships array in state and re-renders on change, which is what
 * auto-opens a freshly added row.
 */
function renderEditor(overrides: Partial<React.ComponentProps<typeof TableRelationshipsEditor>> = {}) {
  const onRelationshipsChange = vi.fn();
  function Harness() {
    const [relationships, setRelationships] = React.useState<TableRelationship[]>(
      (overrides.relationships as TableRelationship[]) ?? []
    );
    return (
      <TableRelationshipsEditor
        connection="warehouse"
        schema="public"
        table="orders"
        columns={TABLES[0].columns}
        tables={TABLES}
        {...overrides}
        relationships={relationships}
        onRelationshipsChange={(next) => { onRelationshipsChange(next); setRelationships(next); }}
      />
    );
  }
  renderWithProviders(<Harness />);
  return { onRelationshipsChange };
}

describe('TableRelationshipsEditor', () => {
  it('shows existing and inherited relationships scoped to this table', () => {
    renderEditor({
      relationships: [REL, { ...REL, table: 'users', column: 'id' }], // second one is another table's
      inheritedRelationships: [{ ...REL, column: 'user_id', targetColumn: 'id' }],
    });
    const rows = screen.getAllByLabelText('Relationship user_id → users.id');
    expect(rows.length).toBe(2); // own + inherited
    expect(screen.queryByLabelText('Relationship id → users.id')).toBeNull();
  });

  it('adds a relationship via dropdowns and emits the full array tagged to this table', async () => {
    const { onRelationshipsChange } = renderEditor();
    fireEvent.click(screen.getByLabelText('Add relationship to public.orders'));

    const fk = await screen.findByLabelText('Foreign key column');
    fireEvent.change(fk, { target: { value: 'user_id' } });
    fireEvent.change(screen.getByLabelText('Target table'), { target: { value: 'public.users' } });
    fireEvent.change(screen.getByLabelText('Target column'), { target: { value: 'id' } });
    fireEvent.change(screen.getByLabelText('Cardinality'), { target: { value: 'one_to_one' } });
    fireEvent.click(screen.getByLabelText('Save relationship'));

    await waitFor(() => expect(onRelationshipsChange).toHaveBeenCalled());
    expect(onRelationshipsChange).toHaveBeenLastCalledWith([{
      connection: 'warehouse', schema: 'public', table: 'orders',
      column: 'user_id', targetSchema: 'public', targetTable: 'users', targetColumn: 'id',
      relationship: 'one_to_one',
    }]);
  });

  it('save stays disabled until the join is fully specified', async () => {
    renderEditor();
    fireEvent.click(screen.getByLabelText('Add relationship to public.orders'));
    const save = await screen.findByLabelText('Save relationship');
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Foreign key column'), { target: { value: 'user_id' } });
    expect(save).toBeDisabled(); // still no target
  });

  it('deletes a relationship', async () => {
    const { onRelationshipsChange } = renderEditor({ relationships: [REL] });
    fireEvent.click(screen.getByLabelText('Relationship user_id → users.id'));
    fireEvent.click(await screen.findByLabelText('Delete relationship'));
    await waitFor(() => expect(onRelationshipsChange).toHaveBeenLastCalledWith([]));
  });

  it('falls back to free-text inputs when columns are unknown (bounded schema)', async () => {
    renderEditor({ columns: [], tables: [{ schema: 'public', table: 'users', columns: [] }] });
    fireEvent.click(screen.getByLabelText('Add relationship to public.orders'));
    const fk = await screen.findByLabelText('Foreign key column');
    expect(fk.tagName).toBe('INPUT');
    fireEvent.change(fk, { target: { value: 'user_id' } });
    fireEvent.change(screen.getByLabelText('Target table'), { target: { value: 'public.users' } });
    const target = screen.getByLabelText('Target column');
    expect(target.tagName).toBe('INPUT');
  });

  it('Verify runs the live checks and reports the verdict', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { targetUnique: true, totalRows: 1000, matchedRows: 980 } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderEditor({ relationships: [REL] });
    fireEvent.click(screen.getByLabelText('Relationship user_id → users.id'));
    fireEvent.click(await screen.findByLabelText('Verify relationship'));
    await waitFor(() => expect(screen.getByLabelText('Verification result').textContent).toContain('98% match'));
    expect(fetchMock).toHaveBeenCalledWith('/api/relationships/verify', expect.objectContaining({ method: 'POST' }));
    vi.unstubAllGlobals();
  });

  it('Verify flags a non-unique target (fan-out warning)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { targetUnique: false, totalRows: 10, matchedRows: 10 } }),
    }));
    renderEditor({ relationships: [REL] });
    fireEvent.click(screen.getByLabelText('Relationship user_id → users.id'));
    fireEvent.click(await screen.findByLabelText('Verify relationship'));
    await waitFor(() => expect(screen.getByLabelText('Verification result').textContent).toMatch(/not unique/i));
    vi.unstubAllGlobals();
  });

  it('excludes the base table itself from the target list (self-joins unsupported)', async () => {
    renderEditor();
    fireEvent.click(screen.getByLabelText('Add relationship to public.orders'));
    const target = await screen.findByLabelText('Target table') as HTMLSelectElement;
    const options = [...target.options].map((o) => o.value);
    expect(options).toContain('public.users');
    expect(options).not.toContain('public.orders');
  });

  it('a relationship stored on ANOTHER table shows here as its one-to-many mirror', () => {
    // REL is stored on orders (orders.user_id → users.id). Render the USERS editor.
    const onRelationshipsChange = vi.fn();
    renderWithProviders(
      <TableRelationshipsEditor
        connection="warehouse" schema="public" table="users"
        columns={TABLES[1].columns} tables={TABLES}
        relationships={[REL]}
        onRelationshipsChange={onRelationshipsChange}
      />
    );
    const mirror = screen.getByLabelText('Relationship id → orders.user_id');
    expect(mirror.textContent).toContain('one-to-many');
    // deleting the mirror deletes the underlying stored record
    fireEvent.click(mirror);
    fireEvent.click(screen.getAllByLabelText('Delete relationship').at(-1)!);
    expect(onRelationshipsChange).toHaveBeenLastCalledWith([]);
  });

  it('creating with one-to-many normalizes storage to the safe many→one direction', async () => {
    // On USERS (the one side): users.id ← orders.user_id, declared one-to-many.
    const onRelationshipsChange = vi.fn();
    function Harness() {
      const [relationships, setRelationships] = React.useState<TableRelationship[]>([]);
      return (
        <TableRelationshipsEditor
          connection="warehouse" schema="public" table="users"
          columns={TABLES[1].columns} tables={TABLES}
          relationships={relationships}
          onRelationshipsChange={(next) => { onRelationshipsChange(next); setRelationships(next); }}
        />
      );
    }
    renderWithProviders(<Harness />);
    fireEvent.click(screen.getByLabelText('Add relationship to public.users'));
    fireEvent.change(await screen.findByLabelText('Foreign key column'), { target: { value: 'id' } });
    fireEvent.change(screen.getByLabelText('Target table'), { target: { value: 'public.orders' } });
    fireEvent.change(screen.getByLabelText('Target column'), { target: { value: 'user_id' } });
    fireEvent.change(screen.getByLabelText('Cardinality'), { target: { value: 'one_to_many' } });
    fireEvent.click(screen.getByLabelText('Save relationship'));

    await waitFor(() => expect(onRelationshipsChange).toHaveBeenCalled());
    // Stored NORMALIZED: orders is the many side.
    expect(onRelationshipsChange).toHaveBeenLastCalledWith([expect.objectContaining({
      table: 'orders', column: 'user_id',
      targetTable: 'users', targetColumn: 'id',
      relationship: 'many_to_one',
    })]);
  });

  it('renders read-only (no add button) without an onRelationshipsChange handler', () => {
    renderWithProviders(
      <TableRelationshipsEditor
        connection="warehouse" schema="public" table="orders"
        columns={TABLES[0].columns} tables={TABLES}
        relationships={[REL]}
      />
    );
    expect(screen.queryByLabelText('Add relationship to public.orders')).toBeNull();
    expect(screen.getByLabelText('Relationship user_id → users.id')).toBeTruthy();
  });
});
