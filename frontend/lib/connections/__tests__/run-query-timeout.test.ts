/**
 * runQuery wall-clock bound. The server had NO timeout on query execution: a stuck warehouse
 * query hung /api/query requests, server tools (ExecuteQuery), and headless ReadFiles
 * indefinitely (the client's 120s guard only protects browser callers). runQuery is the single
 * materializing seam, so bounding it covers them all.
 */

const { mockGetRawByName, mockConnector } = vi.hoisted(() => ({
  mockGetRawByName: vi.fn(),
  mockConnector: { query: vi.fn() } as { query: ReturnType<typeof vi.fn>; queryStream?: ReturnType<typeof vi.fn> },
}));

vi.mock('@/lib/data/connections.server', () => ({
  ConnectionsAPI: { getRawByName: mockGetRawByName },
}));
vi.mock('@/lib/secrets/connection-secrets.server', () => ({
  resolveConnectionSecrets: vi.fn(async (config: unknown) => config),
}));
vi.mock('@/lib/connections', () => ({
  getNodeConnector: vi.fn(() => mockConnector),
}));
vi.mock('@/lib/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/config')>()),
  QUERY_SERVER_TIMEOUT_MS: 5000,
}));

import { runQuery, runQueryStream } from '@/lib/connections/run-query';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

const USER = { userId: 1, email: 't@example.com', name: 'T', role: 'admin', home_folder: '/org', mode: 'org' } as EffectiveUser;

describe('runQuery — server-side wall-clock timeout', () => {
  beforeEach(() => {
    mockGetRawByName.mockResolvedValue({ type: 'postgres', config: {} });
    mockConnector.query.mockReset();
  });

  it('resolves normally when the connector answers within the bound', async () => {
    mockConnector.query.mockResolvedValue({ columns: ['n'], types: ['int'], rows: [{ n: 1 }] });
    const result = await runQuery('db', 'SELECT 1 AS n', {}, USER);
    expect(result.rows).toEqual([{ n: 1 }]);
  });

  it('rejects with a timeout error when the connector never answers', async () => {
    vi.useFakeTimers();
    try {
      mockConnector.query.mockReturnValue(new Promise(() => {})); // stuck warehouse query
      const p = runQuery('db', 'SELECT * FROM big', {}, USER);
      const assertion = expect(p).rejects.toThrow(/timed out/i);
      await vi.advanceTimersByTimeAsync(5001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('names the configured bound in the error so operators can tune it', async () => {
    vi.useFakeTimers();
    try {
      mockConnector.query.mockReturnValue(new Promise(() => {}));
      const p = runQuery('db', 'SELECT * FROM big', {}, USER).catch((e: Error) => e.message);
      await vi.advanceTimersByTimeAsync(5001);
      const message = await p;
      expect(message).toContain('5');
      expect(message).toContain('QUERY_SERVER_TIMEOUT_MS');
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * The bound above unblocks the CALLER. It does not stop the warehouse — the error
 * says so ("The query may still be running on the warehouse"), because
 * `runQueryStream` passed `undefined` where the connector's own timeout goes. The
 * engines that can cancel (DuckDB, ClickHouse, Mongo) were never told, so an
 * abandoned query kept burning a warehouse slot with nothing left to cancel it.
 */
describe('runQueryStream — the bound reaches the connector', () => {
  // Only this block exercises the streaming branch; the tests above deliberately
  // omit `queryStream` so they take the one-shot `query` fallback.
  beforeEach(() => {
    mockGetRawByName.mockResolvedValue({ type: 'duckdb', config: {} });
    mockConnector.queryStream = vi.fn().mockResolvedValue({
      columns: [], types: [], rows: (async function* () {})(),
    });
  });
  afterEach(() => { delete mockConnector.queryStream; });

  it('passes the configured wall-clock bound as the connector timeout', async () => {
    await runQueryStream('db', 'SELECT 1', {}, USER);
    // (sql, params, timeoutMs, paramTypes)
    expect(mockConnector.queryStream!.mock.calls[0][2]).toBe(5000);
  });

  it('still forwards declared param types alongside it', async () => {
    await runQueryStream('db', 'SELECT :a', { a: 1 }, USER, { a: 'number' });
    expect(mockConnector.queryStream!.mock.calls[0][3]).toEqual({ a: 'number' });
  });
});
