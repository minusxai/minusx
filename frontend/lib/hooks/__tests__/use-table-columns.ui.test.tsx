/**
 * useTableColumns — lazily resolved columns for one table. Local columns (from
 * the caller's bounded schema) are the fast path; when empty, columns are
 * fetched on demand via CompletionsAPI.getColumnSuggestions and cached per
 * table for the session.
 */

import { renderHook, waitFor } from '@testing-library/react';
import { useTableColumns, clearTableColumnsCache } from '@/lib/hooks/use-table-columns';
import { CompletionsAPI } from '@/lib/data/completions/completions';

vi.mock('@/lib/data/completions/completions', () => ({
  CompletionsAPI: { getColumnSuggestions: vi.fn() },
}));

const getColumnSuggestions = vi.mocked(CompletionsAPI.getColumnSuggestions);

const LOCAL_COLUMNS = [
  { name: 'id', type: 'integer' },
  { name: 'total', type: 'double' },
];

beforeEach(() => {
  clearTableColumnsCache();
  getColumnSuggestions.mockReset();
});

describe('useTableColumns', () => {
  it('returns local columns synchronously without fetching', () => {
    const { result } = renderHook(() =>
      useTableColumns({ name: 'orders', schema: 'main', connection: 'mxfood' }, LOCAL_COLUMNS),
    );
    expect(result.current).toEqual(LOCAL_COLUMNS);
    expect(getColumnSuggestions).not.toHaveBeenCalled();
  });

  it('returns [] and does not fetch when there is no table', () => {
    const { result } = renderHook(() => useTableColumns(null, []));
    expect(result.current).toEqual([]);
    expect(getColumnSuggestions).not.toHaveBeenCalled();
  });

  it('fetches on demand when local columns are empty', async () => {
    getColumnSuggestions.mockResolvedValue({
      success: true,
      columns: [
        { name: 'id', type: 'integer', displayName: 'id' },
        { name: 'customer', type: 'varchar', displayName: 'customer' },
      ],
    });

    const { result } = renderHook(() =>
      useTableColumns({ name: 'orders', schema: 'main', connection: 'mxfood' }, []),
    );

    await waitFor(() =>
      expect(result.current).toEqual([
        { name: 'id', type: 'integer' },
        { name: 'customer', type: 'varchar' },
      ]),
    );
    expect(getColumnSuggestions).toHaveBeenCalledWith({
      databaseName: 'mxfood',
      table: 'orders',
      schema: 'main',
    });
  });

  it('caches fetched columns per table for the session (one fetch across remounts)', async () => {
    getColumnSuggestions.mockResolvedValue({
      success: true,
      columns: [{ name: 'id', type: 'integer', displayName: 'id' }],
    });

    const first = renderHook(() =>
      useTableColumns({ name: 'orders', schema: 'main', connection: 'mxfood' }, []),
    );
    await waitFor(() => expect(first.result.current).toHaveLength(1));
    first.unmount();

    const second = renderHook(() =>
      useTableColumns({ name: 'orders', schema: 'main', connection: 'mxfood' }, []),
    );
    // Cached: available synchronously, no second request.
    expect(second.result.current).toEqual([{ name: 'id', type: 'integer' }]);
    expect(getColumnSuggestions).toHaveBeenCalledTimes(1);
  });

  it('falls back to the databaseName argument when the table has no connection', async () => {
    getColumnSuggestions.mockResolvedValue({
      success: true,
      columns: [{ name: 'id', type: 'integer', displayName: 'id' }],
    });

    const { result } = renderHook(() =>
      useTableColumns({ name: 'orders', schema: 'main' }, [], 'fallback_db'),
    );

    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(getColumnSuggestions).toHaveBeenCalledWith({
      databaseName: 'fallback_db',
      table: 'orders',
      schema: 'main',
    });
  });

  it('returns [] on fetch failure without throwing (and does not cache the failure)', async () => {
    getColumnSuggestions.mockRejectedValueOnce(new Error('boom'));

    const { result, unmount } = renderHook(() =>
      useTableColumns({ name: 'orders', schema: 'main', connection: 'mxfood' }, []),
    );
    await waitFor(() => expect(getColumnSuggestions).toHaveBeenCalledTimes(1));
    expect(result.current).toEqual([]);
    unmount();

    // A later mount retries instead of serving a cached failure.
    getColumnSuggestions.mockResolvedValue({
      success: true,
      columns: [{ name: 'id', type: 'integer', displayName: 'id' }],
    });
    const retry = renderHook(() =>
      useTableColumns({ name: 'orders', schema: 'main', connection: 'mxfood' }, []),
    );
    await waitFor(() => expect(retry.result.current).toEqual([{ name: 'id', type: 'integer' }]));
  });
});
