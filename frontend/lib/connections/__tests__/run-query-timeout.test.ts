/**
 * runQuery wall-clock bound. The server had NO timeout on query execution: a stuck warehouse
 * query hung /api/query requests, server tools (ExecuteQuery), and headless ReadFiles
 * indefinitely (the client's 120s guard only protects browser callers). runQuery is the single
 * materializing seam, so bounding it covers them all.
 */

const { mockGetRawByName, mockConnector } = vi.hoisted(() => ({
  mockGetRawByName: vi.fn(),
  mockConnector: { query: vi.fn() },
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

import { runQuery } from '@/lib/connections/run-query';
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
