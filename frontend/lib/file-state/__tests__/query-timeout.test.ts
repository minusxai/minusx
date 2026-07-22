/**
 * getQueryResult — bounds a single /api/query call with a wall-clock timeout.
 *
 * Chat/tool-triggered queries (especially story embeds, which run several in a row)
 * used to `await fetch('/api/query')` with no timeout and no abort. A query that never
 * settled left the tool promise pending forever → the conversation sat EXECUTING
 * indefinitely and held a querySemaphore slot. getQueryResult now aborts the fetch after
 * the runtime QUERY_TIMEOUT_MS (hydrated into configsSlice), surfacing a "timed out" error
 * that the caller can handle, and composes an optional external signal (the Stop button).
 */

import { configureStore } from '@reduxjs/toolkit';
import queryResultsReducer from '@/store/queryResultsSlice';
import configsReducer from '@/store/configsSlice';

const TIMEOUT_MS = 5_000;

const testStore = configureStore({
  reducer: { queryResults: queryResultsReducer, configs: configsReducer },
  preloadedState: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    configs: { config: {} as any, loadedAt: null, disableAppStateImages: false, maxConcurrentQueries: 10, queryTimeoutMs: TIMEOUT_MS, creditsEnabled: false, showModelSettings: false },
  },
});
vi.mock('@/store/store', () => ({
  get store() { return testStore; },
  getStore: () => testStore,
}));

import { getQueryResult } from '@/lib/file-state/file-state';

/** A fetch mock that never resolves on its own — it only rejects when its signal aborts (like real fetch). */
function hangingFetch(): ReturnType<typeof vi.fn> {
  return vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
    const signal = init?.signal;
    if (signal) {
      if (signal.aborted) reject(new DOMException('Aborted', 'AbortError'));
      else signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }
  }));
}

describe('getQueryResult — wall-clock timeout', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('aborts a hung /api/query after QUERY_TIMEOUT_MS and rejects with a timeout error', async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal('fetch', fetchMock);

    const promise = getQueryResult({ query: 'SELECT slow', params: {}, database: 'wh' });
    const assertion = expect(promise).rejects.toThrow(/timed out/i);

    // Nothing has fired yet — before the timeout, the fetch is still pending.
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1);
    // Cross the timeout: the internal controller aborts the fetch.
    await vi.advanceTimersByTimeAsync(2);

    await assertion;
    // The fetch was invoked with an AbortSignal, and it ended up aborted.
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal!.aborted).toBe(true);
  });

  it('aborts immediately when the caller\'s external signal (Stop) fires — reported as cancelled, not timed out', async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal('fetch', fetchMock);

    const stop = new AbortController();
    const promise = getQueryResult(
      { query: 'SELECT stoppable', params: {}, database: 'wh' },
      { signal: stop.signal },
    );
    const assertion = expect(promise).rejects.toThrow(/cancelled/i);

    stop.abort();
    await vi.advanceTimersByTimeAsync(1);

    await assertion;
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal!.aborted).toBe(true);
  });
});
