/**
 * SimpleQueryBuilder component tests (jsdom).
 *
 * The builder round-trips SQL through the completions API (mocked here): it
 * parses SQL → IR → SimpleQuerySpec on mount, renders measure/group-by/time/
 * filter chips, and regenerates SQL (irToSql) when the spec is edited. These
 * tests pin the mount render, the add-group-by flow (including the seeded
 * COUNT(*) measure), and the time-dimension flow emitting a DATE_TRUNC IR.
 */
import React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { SimpleQueryBuilder } from '@/components/query-builder';
import { CompletionsAPI } from '@/lib/data/completions/completions';
import type { QueryIR } from '@/lib/sql/ir-types';

vi.mock('@/lib/data/completions/completions', () => ({
  CompletionsAPI: {
    sqlToIR: vi.fn(),
    irToSql: vi.fn(),
    getColumnSuggestions: vi.fn(),
    getTableSuggestions: vi.fn(),
  },
}));

const api = CompletionsAPI as unknown as Record<string, ReturnType<typeof vi.fn>>;

const AGG_IR: QueryIR = {
  type: 'simple',
  version: 1,
  from: { table: 'orders' },
  select: [
    { type: 'column', column: 'status' },
    { type: 'aggregate', aggregate: 'SUM', column: 'amount', alias: 'revenue' },
  ],
  group_by: { columns: [{ column: 'status' }] },
  limit: 1000,
};

const COLUMNS = [
  { name: 'status', type: 'varchar', displayName: 'status' },
  { name: 'amount', type: 'double', displayName: 'amount' },
  { name: 'created_at', type: 'timestamp', displayName: 'created_at' },
];

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.sqlToIR.mockResolvedValue({ success: true, ir: AGG_IR });
  api.irToSql.mockResolvedValue({ success: true, sql: 'SELECT generated' });
  api.getColumnSuggestions.mockResolvedValue({ success: true, columns: COLUMNS });
  api.getTableSuggestions.mockResolvedValue({ success: true, tables: [{ name: 'orders', displayName: 'orders' }] });
});

const renderBuilder = (props: Partial<React.ComponentProps<typeof SimpleQueryBuilder>> = {}) =>
  renderWithProviders(
    <SimpleQueryBuilder
      databaseName="warehouse"
      dialect="duckdb"
      sql="SELECT status, SUM(amount) AS revenue FROM orders GROUP BY status LIMIT 1000"
      onSqlChange={vi.fn()}
      {...props}
    />
  );

describe('SimpleQueryBuilder', () => {
  it('renders measure and group-by chips from parsed SQL', async () => {
    renderBuilder();
    expect(await screen.findByText('SUM(amount)')).toBeTruthy();
    expect(screen.getAllByText('status').length).toBeGreaterThan(0);
    expect((screen.getByLabelText('Row limit') as HTMLInputElement).value).toBe('1000');
  });

  it('adds a time dimension and regenerates SQL with a DATE_TRUNC IR', async () => {
    const onSqlChange = vi.fn();
    renderBuilder({ onSqlChange });
    await screen.findByText('SUM(amount)');

    // Open the time picker, choose the temporal column, then the grain.
    fireEvent.click(screen.getByLabelText('Add time dimension').querySelector('button')!);
    fireEvent.click(await screen.findByLabelText('Time column created_at'));
    fireEvent.click(await screen.findByLabelText('Time grain MONTH'));

    await waitFor(() => expect(onSqlChange).toHaveBeenCalledWith('SELECT generated'));
    const lastIr = api.irToSql.mock.calls.at(-1)![0].ir as QueryIR;
    expect(lastIr.select).toContainEqual(
      { type: 'expression', function: 'DATE_TRUNC', unit: 'MONTH', column: 'created_at', alias: 'month' }
    );
    expect(lastIr.group_by!.columns).toContainEqual(
      { type: 'expression', function: 'DATE_TRUNC', unit: 'MONTH', column: 'created_at' }
    );
  });

  it('shows the fallback notice when the SQL does not fit Simple mode', async () => {
    api.sqlToIR.mockResolvedValue({
      success: true,
      ir: {
        ...AGG_IR,
        joins: [{ type: 'LEFT', table: { table: 'users' }, on: [{ left_table: 'orders', left_column: 'user_id', right_table: 'users', right_column: 'id' }] }],
      },
    });
    renderBuilder();
    expect(await screen.findByText(/Not available in Simple mode/)).toBeTruthy();
  });

  it('seeds a COUNT(*) measure when grouping raw rows', async () => {
    api.sqlToIR.mockResolvedValue({
      success: true,
      ir: { type: 'simple', version: 1, from: { table: 'orders' }, select: [{ type: 'column', column: '*' }], limit: 100 },
    });
    const onSqlChange = vi.fn();
    renderBuilder({ sql: 'SELECT * FROM orders LIMIT 100', onSqlChange });
    await screen.findByText(/showing raw rows/);

    fireEvent.click(screen.getByLabelText('Add group by').querySelector('button')!);
    fireEvent.click(await screen.findByLabelText('Add group by: status'));

    await waitFor(() => expect(api.irToSql).toHaveBeenCalled());
    const lastIr = api.irToSql.mock.calls.at(-1)![0].ir as QueryIR;
    expect(lastIr.select).toContainEqual({ type: 'aggregate', aggregate: 'COUNT', column: null, alias: 'count' });
    expect(lastIr.group_by).toEqual({ columns: [{ column: 'status' }] });
  });
});
