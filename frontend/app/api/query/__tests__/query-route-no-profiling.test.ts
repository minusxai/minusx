/**
 * POST /api/query — must NOT trigger schema profiling on the query hot path.
 *
 * Regression test for the dashboard "Query Error — Failed to fetch" storm:
 * when a dashboard fires N question queries in parallel and all cache-miss,
 * the route used to call FilesAPI.loadFile(connection) just to read the SQL
 * dialect. On a connection with a stale/missing cached schema, loadFile runs
 * the connectionLoader, which calls connector.getSchema() + profileDatabase()
 * — an expensive refresh. N parallel refreshes serialize/exhaust the DB and
 * the request times out at the gateway → browser "Failed to fetch".
 *
 * The fix derives the dialect via ConnectionsAPI.getRawByName (a single
 * getByPath, no loader). This test asserts the query path never calls
 * connector.getSchema(), while the query itself still executes and returns
 * results.
 */

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

// Spies must be defined via vi.hoisted because vi.mock factories are hoisted
// above all imports.
const { getSchemaSpy, querySpy } = vi.hoisted(() => ({
  getSchemaSpy: vi.fn(async () => [
    { schema: 'public', tables: [{ name: 't', schema: 'public', columns: [] }] },
  ]),
  querySpy: vi.fn(async () => ({
    columns: ['x'],
    types: ['number'],
    rows: [{ x: 1 }],
    finalQuery: 'SELECT 1 AS x',
  })),
}));

// Replace getNodeConnector everywhere (run-query AND connection-loader) with a
// fake connector. getSchema is the "schema refresh / profiling" signal; query
// is the actual execution.
vi.mock('@/lib/connections', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/connections')>();
  return {
    ...actual,
    getNodeConnector: () => ({
      getSchema: getSchemaSpy,
      query: querySpy,
      testConnection: vi.fn(),
    }),
  };
});

import { POST } from '@/app/api/query/route';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { NextRequest } from 'next/server';

const TEST_DB_PATH = getTestDbPath('query_route_no_profiling');
const CONNECTION_NAME = 'test_warehouse';

// Seed a connection whose cached schema is MISSING → connectionLoader would
// treat it as needing a refresh (the worst case the storm hits in production).
async function seedConnection(_dbPath: string): Promise<void> {
  const { getModules } = await import('@/lib/modules/registry');
  const db = getModules().db;
  const now = new Date().toISOString();

  const { rows: [{ next_id }] } = await db.exec<{ next_id: number }>(
    'SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM files',
    [],
  );

  await db.exec(
    `INSERT INTO files (id, name, path, type, content, file_references, version, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      next_id,
      CONNECTION_NAME,
      `/org/database/${CONNECTION_NAME}`,
      'connection',
      // No `schema` → connectionLoader.needsRefresh === true
      JSON.stringify({ id: CONNECTION_NAME, name: CONNECTION_NAME, type: 'duckdb', config: { file_path: 'test.duckdb' } }),
      '[]',
      1,
      now,
      now,
    ],
  );
}

function callPost(body: object): Promise<Response> {
  return POST(
    new NextRequest('http://localhost/api/query', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  );
}

describe('POST /api/query — no schema profiling on the query path', () => {
  setupTestDb(TEST_DB_PATH, { customInit: seedConnection });

  it('executes the query without triggering a schema refresh', async () => {
    const res = await callPost({
      connection_name: CONNECTION_NAME,
      query: 'SELECT 1 AS x',
      parameters: {},
    });

    const body = await res.json();

    // Query still executes and returns the connector's rows.
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.rows).toEqual([{ x: 1 }]);
    expect(querySpy).toHaveBeenCalled();

    // The hot path must NOT trigger schema profiling/refresh.
    expect(getSchemaSpy).not.toHaveBeenCalled();
  });
});
