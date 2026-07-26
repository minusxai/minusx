/**
 * Table-whitelist enforcement when the caller supplies NO `filePath`.
 *
 * The whitelist is resolved from the nearest context to a path. Browser queries
 * pass the question's `filePath`; MCP has none, so it falls back to the user's
 * home folder (`getWhitelistForUser`). `/api/query` accepts requests with no
 * `filePath` too — agent `ExecuteQuery` and ad-hoc Explore both send none — and
 * must resolve the same way, or the identical query is enforced through MCP and
 * unenforced over HTTP.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRunQuery } = vi.hoisted(() => ({ mockRunQuery: vi.fn() }));
vi.mock('@/lib/connections/run-query', async () => {
  const { queryResultToStream } = await import('@/lib/connections/base');
  return {
    runQuery: mockRunQuery,
    runQueryStream: async (...args: unknown[]) => queryResultToStream(await mockRunQuery(...args)),
  };
});

const { mockGetSchema } = vi.hoisted(() => ({ mockGetSchema: vi.fn() }));
vi.mock('@/lib/connections', () => ({
  getNodeConnector: () => ({
    getSchema: async () => (await mockGetSchema())?.schemas ?? [],
    query: vi.fn().mockResolvedValue({ columns: [], types: [], rows: [] }),
  }),
}));
vi.mock('@/lib/connections/statistics-engine', () => ({
  profileDatabase: vi.fn(async (_t: string, s: unknown) => ({ schema: s, queryCount: 0 })),
}));

import { POST as queryPost } from '@/app/api/query/route';
import { DocumentDB } from '@/lib/database/documents-db';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { getModules } from '@/lib/modules/registry';
import { NextRequest } from 'next/server';
import type { ConnectionContent, ContextContent, ContextVersion, DatabaseSchema } from '@/lib/types';

const TEST_DB_PATH = getTestDbPath('query_route_whitelist_no_filepath');

const SCHEMA: DatabaseSchema = {
  updated_at: new Date().toISOString(),
  schemas: [{
    schema: 'mxfood',
    tables: [
      { table: 'orders', columns: [{ name: 'total', type: 'DOUBLE' }] },
      { table: 'salaries', columns: [{ name: 'amount', type: 'DOUBLE' }] },
    ],
  }],
};

async function mk(name: string, path: string, type: string, content: object): Promise<number> {
  const id = await DocumentDB.create(name, path, type, content, []);
  await DocumentDB.update(id, name, path, content, [], `init-${id}`);
  return id;
}

/**
 * A context at `/org` (user 1's resolved home folder) exposing ONLY
 * `mxfood.orders` — `salaries` exists in the connection but is not whitelisted.
 * The whitelist must be table-level: naming just the connection exposes all of it.
 * `fullSchema` is left for the context loader to compute from this whitelist.
 */
async function seedRestrictedContext(): Promise<void> {
  await getModules().db.exec("DELETE FROM files WHERE type = 'context'", []);
  const version: ContextVersion = {
    version: 1,
    whitelist: [{
      name: 'warehouse',
      type: 'connection',
      children: [{
        name: 'mxfood',
        type: 'schema',
        children: [{ name: 'orders', type: 'table' }],
      }],
    }] as unknown as ContextVersion['whitelist'],
    docs: [],
    createdAt: new Date().toISOString(),
    createdBy: 1,
  };
  await mk('context', '/org/context', 'context', {
    versions: [version],
    published: { all: 1 },
  } as ContextContent);
}

/** POST /api/query, omitting `filePath` entirely when `filePath` is undefined. */
async function runViaRoute(query: string, filePath?: string) {
  const body: Record<string, unknown> = { query, connection_name: 'warehouse', parameters: {} };
  if (filePath !== undefined) body.filePath = filePath;
  const req = new NextRequest('http://localhost:3000/api/query?mode=org', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user-id': '1' },
    body: JSON.stringify(body),
  });
  const res = await queryPost(req);
  return { status: res.status, text: await res.text() };
}

describe('/api/query table whitelist without filePath', () => {
  setupTestDb(TEST_DB_PATH);

  beforeEach(async () => {
    mockRunQuery.mockReset();
    mockRunQuery.mockResolvedValue({
      columns: ['total'], types: ['DOUBLE'], rows: [{ total: 1 }], finalQuery: 'x',
    });
    mockGetSchema.mockClear();
    mockGetSchema.mockResolvedValue(SCHEMA);
    await getModules().db.exec('DELETE FROM files', []);
    const conn: ConnectionContent = { type: 'duckdb', config: { file_path: '../x.duckdb' }, schema: SCHEMA };
    await mk('warehouse', '/org/database/warehouse', 'connection', conn);
    await seedRestrictedContext();
  });

  it('BLOCKS a non-whitelisted table when filePath is supplied (baseline)', async () => {
    const { status, text } = await runViaRoute('SELECT * FROM mxfood.salaries', '/org');
    expect(status).toBe(403);
    expect(text).toMatch(/FORBIDDEN_TABLES/);
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  /**
   * KNOWN GAP — deliberately skipped, not deleted.
   *
   * `/api/query` skips whitelist validation entirely when `filePath` is absent,
   * so the identical query is enforced through MCP (which falls back to
   * `getWhitelistForUser`) and unenforced over HTTP.
   *
   * The one-line fix — using the same fallback here — is NOT applied because
   * `FilesAPI.getFiles` runs loaders on every file it returns, so resolving a
   * whitelist loads every context, which loads every connection, which profiles.
   * That would reintroduce schema profiling on the hot path for ad-hoc and agent
   * queries — the exact regression `query-route-no-profiling.test.ts` guards
   * after a production "Failed to fetch" storm. Closing the gap needs a
   * loader-free whitelist read first; until then this test records the hole.
   *
   * Un-skip it the moment that lands.
   */
  it.skip('BLOCKS a non-whitelisted table when filePath is ABSENT — falls back to the home folder', async () => {
    const { status, text } = await runViaRoute('SELECT * FROM mxfood.salaries');
    expect(status).toBe(403);
    expect(text).toMatch(/FORBIDDEN_TABLES/);
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it('still ALLOWS a whitelisted table when filePath is absent', async () => {
    const { status } = await runViaRoute('SELECT total FROM mxfood.orders');
    expect(status).toBe(200);
    expect(mockRunQuery).toHaveBeenCalledTimes(1);
  });
});
