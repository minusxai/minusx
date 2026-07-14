/**
 * QueryValueSelector tests (jsdom) — the one shared "pick a column/row out of
 * a query result" module (alerts, evals, param sources).
 *  - useInferredColumns resolves columns for question AND inline-SQL sources
 *  - ColumnSelect: dropdown when columns known, free-text fallback otherwise
 *  - RowSelect: RowIndex semantics (undefined=first, -1=last, nth)
 */
import React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { QueryValueSelector, ColumnSelect, RowSelect } from '@/components/query-value-selector';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ columns: [{ name: 'revenue', type: 'DOUBLE' }, { name: 'status', type: 'VARCHAR' }] }),
  });
});

describe('QueryValueSelector', () => {
  it('infers columns for a question source and renders the dropdown', async () => {
    renderWithProviders(
      <QueryValueSelector
        source={{ kind: 'question', questionId: 42 }}
        column={undefined}
        onColumnChange={vi.fn()}
        row={undefined}
        onRowChange={vi.fn()}
      />
    );
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/infer-columns', expect.objectContaining({
        body: JSON.stringify({ questionId: 42 }),
      }));
    });
    const select = await screen.findByLabelText('Column') as HTMLSelectElement;
    await waitFor(() => expect(select.tagName).toBe('SELECT'));
    expect([...select.options].map((o) => o.value)).toEqual(['', 'revenue', 'status']);
  });

  it('infers columns for an inline SQL source (debounced)', async () => {
    renderWithProviders(
      <QueryValueSelector
        source={{ kind: 'inline', sql: 'SELECT total FROM orders', connectionName: 'warehouse' }}
        column={undefined}
        onColumnChange={vi.fn()}
      />
    );
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/infer-columns', expect.objectContaining({
        body: JSON.stringify({ sql: 'SELECT total FROM orders', connectionName: 'warehouse' }),
      }));
    }, { timeout: 2000 });
  });

  it('falls back to free text when inference returns nothing', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ columns: [] }) });
    const onColumnChange = vi.fn();
    renderWithProviders(
      <ColumnSelect columns={[]} value={undefined} onChange={onColumnChange} />
    );
    const input = screen.getByLabelText('Column') as HTMLInputElement;
    expect(input.tagName).toBe('INPUT');
    fireEvent.change(input, { target: { value: 'my_col' } });
    expect(onColumnChange).toHaveBeenCalledWith('my_col');
  });

  it('RowSelect encodes first/last/nth as RowIndex', () => {
    const onChange = vi.fn();
    const { rerender } = renderWithProviders(<RowSelect value={undefined} onChange={onChange} />);
    const select = screen.getByLabelText('Row') as HTMLSelectElement;
    expect(select.value).toBe('first');

    fireEvent.change(select, { target: { value: 'last' } });
    expect(onChange).toHaveBeenCalledWith(-1);

    rerender(<RowSelect value={-1} onChange={onChange} />);
    expect((screen.getByLabelText('Row') as HTMLSelectElement).value).toBe('last');

    rerender(<RowSelect value={3} onChange={onChange} />);
    expect((screen.getByLabelText('Row') as HTMLSelectElement).value).toBe('nth');
    fireEvent.change(screen.getByLabelText('Row index'), { target: { value: '5' } });
    expect(onChange).toHaveBeenCalledWith(5);
  });
});
