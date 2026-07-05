/**
 * getQueryResult — the "Run query" / retry contract.
 *
 * forceLoad bypasses the CLIENT cache AND must instruct the server to bypass its
 * cache: the request body carries forceRefresh:true so /api/query re-executes and
 * refreshes the durable cache. A normal (cached) load must NOT set forceRefresh,
 * so ordinary renders keep being served from cache.
 */

import { configureStore } from '@reduxjs/toolkit';
import queryResultsReducer from '@/store/queryResultsSlice';
import configsReducer from '@/store/configsSlice';

const testStore = configureStore({
  reducer: { queryResults: queryResultsReducer, configs: configsReducer },
  preloadedState: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    configs: { config: {} as any, loadedAt: null, disableAppStateImages: false, maxConcurrentQueries: 10, queryTimeoutMs: 120000, creditsEnabled: false },
  },
});
vi.mock('@/store/store', () => ({
  get store() { return testStore; },
  getStore: () => testStore,
}));

import { getQueryResult } from '@/lib/api/file-state';

function emptyJsonlResponse(): Response {
  const text = JSON.stringify({ columns: [], types: [], finalQuery: '', rowCount: 0 }) + '\n';
  return { ok: true, status: 200, headers: new Headers({ 'X-Cached-At': '0' }), text: async () => text, json: async () => JSON.parse(text) } as unknown as Response;
}

function bodyOf(call: unknown[]): Record<string, unknown> {
  return JSON.parse((call[1] as RequestInit).body as string);
}

describe('getQueryResult — forceRefresh contract', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('forceLoad sends forceRefresh:true; a normal load does not', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      String(url).includes('/api/query') ? emptyJsonlResponse() : ({ ok: true, status: 200, json: async () => ({}) } as Response));
    vi.stubGlobal('fetch', fetchMock);

    // "Run query" / retry → must force a fresh server execution.
    await getQueryResult({ query: 'SELECT 1', params: {}, database: 'wh' }, { forceLoad: true });
    const forcedBody = bodyOf(fetchMock.mock.calls.find((c) => String(c[0]).includes('/api/query'))!);
    expect(forcedBody.forceRefresh).toBe(true);

    // A different query loaded normally (distinct key so no dedup/cache short-circuit)
    // must NOT force — ordinary renders stay cache-served.
    fetchMock.mockClear();
    await getQueryResult({ query: 'SELECT 2', params: {}, database: 'wh' });
    const normalBody = bodyOf(fetchMock.mock.calls.find((c) => String(c[0]).includes('/api/query'))!);
    expect(normalBody.forceRefresh).toBeUndefined();
  });
});

describe('getQueryResult — cachePolicy plumbing', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends cachePolicy in the request body when provided, omits it otherwise', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      String(url).includes('/api/query') ? emptyJsonlResponse() : ({ ok: true, status: 200, json: async () => ({}) } as Response));
    vi.stubGlobal('fetch', fetchMock);

    await getQueryResult({ query: 'SELECT 10', params: {}, database: 'wh', cachePolicy: { revalidateMs: 5000, expiryMs: 60000 } });
    const withPolicy = bodyOf(fetchMock.mock.calls.find((c) => String(c[0]).includes('/api/query'))!);
    expect(withPolicy.cachePolicy).toEqual({ revalidateMs: 5000, expiryMs: 60000 });

    fetchMock.mockClear();
    await getQueryResult({ query: 'SELECT 11', params: {}, database: 'wh' });
    const noPolicy = bodyOf(fetchMock.mock.calls.find((c) => String(c[0]).includes('/api/query'))!);
    expect(noPolicy.cachePolicy).toBeUndefined();
  });
});
