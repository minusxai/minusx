/**
 * Contract tests for useGuiCompat (jsdom).
 *
 * The hook proactively asks the completions API whether a SQL string can be
 * parsed into the query-builder IR, so callers can dim the GUI tab when it
 * can't. Both outcomes (parseable → enabled, unparseable → disabled+reason)
 * and the empty-SQL short-circuit are pinned here.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { useGuiCompat } from '@/lib/hooks/use-gui-compat';
import { CompletionsAPI } from '@/lib/data/completions/completions';

vi.mock('@/lib/data/completions/completions', () => ({
  CompletionsAPI: { sqlToIR: vi.fn() },
}));

const sqlToIR = CompletionsAPI.sqlToIR as unknown as ReturnType<typeof vi.fn>;

describe('useGuiCompat', () => {
  beforeEach(() => sqlToIR.mockReset());

  it('reports GUI-able when sqlToIR resolves with a parsed IR', async () => {
    sqlToIR.mockResolvedValue({ success: true, ir: { type: 'simple' } });
    const { result } = renderHook(() => useGuiCompat('SELECT * FROM t', 'duckdb'));
    await waitFor(() => expect(result.current.canUseGUI).toBe(true));
    expect(result.current.guiError).toBeNull();
  });

  // sqlToIR resolves (never rejects) on parse failure, flagging it via success:false.
  it('reports NOT GUI-able with the error when sqlToIR resolves success:false', async () => {
    sqlToIR.mockResolvedValue({ success: false, error: 'No FROM clause found' });
    const { result } = renderHook(() => useGuiCompat('SELECT 1', 'duckdb'));
    await waitFor(() => expect(result.current.canUseGUI).toBe(false));
    expect(result.current.guiError).toBe('No FROM clause found');
  });

  it('treats empty SQL as GUI-able without calling the API', async () => {
    const { result } = renderHook(() => useGuiCompat('   ', 'duckdb'));
    await waitFor(() => expect(result.current.canUseGUI).toBe(true));
    expect(sqlToIR).not.toHaveBeenCalled();
  });

  // --- Simple-tier gating (same single sqlToIR round-trip) ------------------

  it('reports Simple-able when the parsed IR fits the Simple tier', async () => {
    sqlToIR.mockResolvedValue({
      success: true,
      ir: {
        type: 'simple', version: 1, from: { table: 'orders' },
        select: [
          { type: 'column', column: 'status' },
          { type: 'aggregate', aggregate: 'COUNT', column: null, alias: 'n' },
        ],
        group_by: { columns: [{ column: 'status' }] },
      },
    });
    const { result } = renderHook(() => useGuiCompat('SELECT ...', 'duckdb'));
    await waitFor(() => expect(result.current.canUseSimple).toBe(true));
    expect(result.current.simpleError).toBeNull();
    expect(result.current.canUseGUI).toBe(true);
  });

  it('reports NOT Simple-able (with reasons) when the IR is GUI-able but complex', async () => {
    sqlToIR.mockResolvedValue({
      success: true,
      ir: {
        type: 'simple', version: 1, from: { table: 'orders' },
        select: [{ type: 'column', column: '*' }],
        joins: [{ type: 'LEFT', table: { table: 'users' }, on: [{ left_table: 'orders', left_column: 'user_id', right_table: 'users', right_column: 'id' }] }],
      },
    });
    const { result } = renderHook(() => useGuiCompat('SELECT ...', 'duckdb'));
    // Wait on the async-resolved field (canUseGUI starts optimistically true).
    await waitFor(() => expect(result.current.canUseSimple).toBe(false));
    expect(result.current.canUseGUI).toBe(true);
    expect(result.current.simpleError).toMatch(/join/i);
  });

  it('reports NOT Simple-able when the SQL is not even GUI-able', async () => {
    sqlToIR.mockResolvedValue({ success: false, error: 'No FROM clause found' });
    const { result } = renderHook(() => useGuiCompat('SELECT 1', 'duckdb'));
    await waitFor(() => expect(result.current.canUseGUI).toBe(false));
    expect(result.current.canUseSimple).toBe(false);
    expect(result.current.simpleError).toBe('No FROM clause found');
  });

  it('treats empty SQL as Simple-able', async () => {
    const { result } = renderHook(() => useGuiCompat('', 'duckdb'));
    await waitFor(() => expect(result.current.canUseSimple).toBe(true));
    expect(result.current.simpleError).toBeNull();
  });
});
