/**
 * getQueryResult — user-initiated cancellation. The Run button flips to Stop
 * while a query executes; Stop aborts the IN-FLIGHT fetch by execution key,
 * regardless of which path started it (explicit Run, auto-execute, an embed
 * joining the deduped promise). The abort surfaces as the existing normalized
 * "Query cancelled" error, which the cache treats as fresh (no retry loop).
 */
import { configureStore } from '@reduxjs/toolkit';
import queryResultsReducer, { selectQueryResult } from '@/store/queryResultsSlice';
import configsReducer from '@/store/configsSlice';

const testStore = configureStore({
  reducer: { queryResults: queryResultsReducer, configs: configsReducer },
  preloadedState: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    configs: { config: {} as any, loadedAt: null, disableAppStateImages: false, maxConcurrentQueries: 10, queryTimeoutMs: 120000, creditsEnabled: false, egressIps: [] },
  },
});
vi.mock('@/store/store', () => ({
  get store() { return testStore; },
  getStore: () => testStore,
}));

import { getQueryResult, cancelQueryExecution } from '@/lib/file-state/file-state';

const EXECUTION = { query: 'SELECT * FROM slow', params: {}, database: 'test' };

describe('getQueryResult — cancellation', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('cancelQueryExecution aborts the in-flight fetch and lands "Query cancelled"', async () => {
    // A fetch that hangs until aborted — the shape of a long-running query.
    const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const pending = getQueryResult(EXECUTION).catch((e: Error) => e);
    // Let the fetch start before cancelling.
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    expect(cancelQueryExecution(EXECUTION)).toBe(true);

    const error = await pending;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/cancelled/i);

    // The test store only mounts the two slices the query path touches.
    const cached = selectQueryResult(testStore.getState() as never, EXECUTION.query, EXECUTION.params, EXECUTION.database);
    expect(cached?.error).toMatch(/cancelled/i);
    expect(cached?.loading).toBe(false);
  });

  it('returns false when nothing matching is in flight', () => {
    expect(cancelQueryExecution({ query: 'SELECT 1', params: {}, database: 'nope' })).toBe(false);
  });
});
