/**
 * getQueryResult — network/infra failures are reported to the bug channel.
 *
 * A dashboard "Failed to fetch" means the /api/query request never returned a
 * clean response, so the server-side QUERY_EXECUTED-with-error event never
 * fires — the failure is otherwise invisible. getQueryResult must report these
 * network-class failures via captureError() (→ /api/capture-error → AppEvents.ERROR).
 *
 * Scope: report only network-level failures (fetch rejected) and 5xx server
 * errors. Ordinary 4xx SQL errors (user error, already logged server-side,
 * shown inline) must NOT be reported, to avoid spamming the bug channel.
 */

import { configureStore } from '@reduxjs/toolkit';
import queryResultsReducer from '@/store/queryResultsSlice';

// file-state.ts reads the store via getStore(); point it at a real test store.
const testStore = configureStore({ reducer: { queryResults: queryResultsReducer } });
vi.mock('@/store/store', () => ({
  get store() { return testStore; },
  getStore: () => testStore,
}));

import { getQueryResult } from '@/lib/file-state/file-state';

function captureErrorCalls(fetchMock: ReturnType<typeof vi.fn>): unknown[][] {
  return fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/capture-error'));
}

// Flush the fire-and-forget captureError() microtasks.
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('getQueryResult — network/infra failure reporting', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports a network-level "Failed to fetch" via captureError', async () => {
    fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/api/query')) {
        throw new TypeError('Failed to fetch');
      }
      return { ok: true, status: 200, json: async () => ({ success: true }) } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      getQueryResult({ query: 'SELECT net_fail', params: {}, database: 'wh', fileId: 7 }),
    ).rejects.toThrow();
    await flush();

    expect(captureErrorCalls(fetchMock).length).toBe(1);
  });

  it('reports a 5xx server error via captureError', async () => {
    fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/api/query')) {
        return { ok: false, status: 500, json: async () => ({ success: false, error: { message: 'boom' } }) } as Response;
      }
      return { ok: true, status: 200, json: async () => ({ success: true }) } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      getQueryResult({ query: 'SELECT five_hundred', params: {}, database: 'wh' }),
    ).rejects.toThrow();
    await flush();

    expect(captureErrorCalls(fetchMock).length).toBe(1);
  });

  it('does NOT report a 4xx SQL error (user error, logged server-side)', async () => {
    fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/api/query')) {
        return { ok: false, status: 400, json: async () => ({ success: false, error: { message: 'syntax error near FROM' } }) } as Response;
      }
      return { ok: true, status: 200, json: async () => ({ success: true }) } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      getQueryResult({ query: 'SELECT bad_sql', params: {}, database: 'wh' }),
    ).rejects.toThrow();
    await flush();

    expect(captureErrorCalls(fetchMock).length).toBe(0);
  });
});
