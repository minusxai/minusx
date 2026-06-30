/**
 * POST /api/query — durable cache hit/miss at the HTTP layer.
 *
 * Proves the in-process maps are gone: a second identical request is served from
 * the persisted cache (X-Cache: hit) WITHOUT re-running the connector.
 */
vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

const { querySpy } = vi.hoisted(() => ({
  querySpy: vi.fn(async () => ({ columns: ['x'], types: ['number'], rows: [{ x: 1 }], finalQuery: 'SELECT 1 AS x' })),
}));

vi.mock('@/lib/connections', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/connections')>();
  return { ...actual, getNodeConnector: () => ({
    getSchema: vi.fn(async () => []),
    query: querySpy,
    queryStream: async (...a: unknown[]) => {
      const r = await (querySpy as (...x: unknown[]) => Promise<{ columns: string[]; types: string[]; rows: Record<string, unknown>[]; finalQuery: string }>)(...a);
      return { columns: r.columns, types: r.types, finalQuery: r.finalQuery, rows: (async function* () { for (const x of r.rows) yield x; })() };
    },
    testConnection: vi.fn(),
  }) };
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/query/route';
import { decodeJsonl } from '@/lib/query-cache/jsonl';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { NextRequest } from 'next/server';

const CONNECTION = 'wh';

async function seedConnection(): Promise<void> {
  const { getModules } = await import('@/lib/modules/registry');
  const db = getModules().db;
  const now = new Date().toISOString();
  const { rows: [{ next_id }] } = await db.exec<{ next_id: number }>('SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM files', []);
  await db.exec(
    `INSERT INTO files (id, name, path, type, content, file_references, version, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [next_id, CONNECTION, `/org/database/${CONNECTION}`, 'connection',
     JSON.stringify({ id: CONNECTION, name: CONNECTION, type: 'duckdb', config: { file_path: 'test.duckdb' } }),
     '[]', 1, now, now],
  );
}

function post(body: object): Promise<Response> {
  return POST(new NextRequest('http://localhost/api/query', { method: 'POST', body: JSON.stringify(body), headers: { 'x-user-id': '1' } }));
}

describe('POST /api/query — durable cache', () => {
  setupTestDb(getTestDbPath('query_cache_route'), { customInit: seedConnection });
  beforeEach(() => querySpy.mockClear());

  it('serves the second identical request from cache without re-executing', async () => {
    const body = { connection_name: CONNECTION, query: 'SELECT 1 AS x', parameters: {} };

    const r1 = await post(body);
    expect(r1.status).toBe(200);
    expect(r1.headers.get('X-Cache')).toBe('miss');
    expect(decodeJsonl(await r1.text()).rows).toEqual([{ x: 1 }]);
    expect(querySpy).toHaveBeenCalledTimes(1);

    const r2 = await post(body);
    expect(r2.status).toBe(200);
    expect(r2.headers.get('X-Cache')).toBe('hit');
    expect(decodeJsonl(await r2.text()).rows).toEqual([{ x: 1 }]);
    expect(querySpy).toHaveBeenCalledTimes(1); // NOT re-executed — served from the blob
  });

  it('different params miss separately (distinct cache keys)', async () => {
    await post({ connection_name: CONNECTION, query: 'SELECT :p AS x', parameters: { p: 1 } });
    await post({ connection_name: CONNECTION, query: 'SELECT :p AS x', parameters: { p: 2 } });
    expect(querySpy).toHaveBeenCalledTimes(2);
  });
});
