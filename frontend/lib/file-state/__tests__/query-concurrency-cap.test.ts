/**
 * getQueryResult — caps concurrent /api/query calls.
 *
 * A dashboard fires N card queries in parallel; without a cap they all hit the
 * server at once (we saw 41-deep bursts in prod). getQueryResult funnels every
 * query through a semaphore sized by the runtime MAX_CONCURRENT_QUERIES env
 * (hydrated into configsSlice). This verifies that with the cap at N, no more
 * than N requests are ever in flight at once — while all queries still run.
 */

import { configureStore } from '@reduxjs/toolkit';
import queryResultsReducer from '@/store/queryResultsSlice';
import configsReducer from '@/store/configsSlice';

const CAP = 3;

// file-state.ts reads the cap from configsSlice via getStore(); preload it.
const testStore = configureStore({
  reducer: { queryResults: queryResultsReducer, configs: configsReducer },
  preloadedState: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    configs: { config: {} as any, loadedAt: null, disableAppStateImages: false, maxConcurrentQueries: CAP, queryTimeoutMs: 120000, creditsEnabled: false },
  },
});
vi.mock('@/store/store', () => ({
  get store() { return testStore; },
  getStore: () => testStore,
}));

import { getQueryResult } from '@/lib/file-state/file-state';

describe('getQueryResult — concurrency cap', () => {
  afterEach(() => vi.unstubAllGlobals());

  it(`never has more than ${CAP} /api/query calls in flight, but runs them all`, async () => {
    let inFlight = 0;
    let peak = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/api/query')) {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5)); // hold the slot so overlap is real
        inFlight -= 1;
        // /api/query streams JSONL — client reads .text(). Header line + no rows.
        const text = JSON.stringify({ columns: [], types: [], finalQuery: '', rowCount: 0 }) + '\n';
        return { ok: true, status: 200, headers: new Headers({ 'X-Cached-At': '0' }), text: async () => text, json: async () => JSON.parse(text) } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const N = 9; // > CAP, all distinct so dedup doesn't collapse them
    await Promise.all(
      Array.from({ length: N }, (_, i) => getQueryResult({ query: `SELECT ${i}`, params: {}, database: 'wh' })),
    );

    const queryCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/query')).length;
    expect(queryCalls).toBe(N);  // every query executed
    expect(peak).toBe(CAP);      // but never more than CAP concurrently
  });
});
