/**
 * E2E tests for parameterized query execution through POST /api/query.
 *
 * Covers date, number, and text filters for both Postgres (falls through to
 * Python backend) and DuckDB (handled by the Node.js connector).
 *
 * The Postgres date-filter bug: enforce_query_limit() in the Python backend
 * uses sqlglot to inject a LIMIT clause. During the parse→serialize round-trip
 * sqlglot corrupts the :paramName SQLAlchemy placeholder, producing a KeyError
 * at execution time. The backend tests in test_limit_enforcer.py expose that
 * specific bug; these frontend tests verify the parameter-forwarding pipeline
 * from the API route through to what is handed off to each connector.
 */

// ---- Jest module mocks (hoisted before imports) ----------------------------

jest.mock('@/lib/database/db-config', () => {
  const path = require('path');
  const dbPath = path.join(process.cwd(), 'data', 'test_query_filters_e2e.db');
  return {
    DB_PATH: dbPath,
    DB_DIR: path.join(process.cwd(), 'data'),
    getDbType: () => 'sqlite',
  };
});

let testStore: any;
jest.mock('@/store/store', () => ({
  get store() {
    return testStore;
  },
  getStore: () => testStore,
}));

// pythonBackendFetch spy — lets us assert what params reach Python
jest.mock('@/lib/api/python-backend-client', () => ({
  pythonBackendFetch: jest.fn(),
}));

// getNodeConnector spy — lets us control Node.js connector routing per test
jest.mock('@/lib/connections', () => ({
  getNodeConnector: jest.fn(),
}));

// ---------------------------------------------------------------------------

import { POST as queryPostHandler } from '@/app/api/query/route';
import { NextRequest } from 'next/server';
import { getTestDbPath, initTestDatabase, cleanupTestDatabase } from './test-utils';
import { pythonBackendFetch } from '@/lib/api/python-backend-client';
import { getNodeConnector } from '@/lib/connections';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const dbPath = getTestDbPath('query_filters_e2e');
const PG_CONN = 'pg_conn';    // postgresql type — falls through to Python
const DUCK_CONN = 'duck_conn'; // duckdb type — handled by Node.js connector

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueryRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/query', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'x-company-id': '1', 'x-user-id': '1' },
  });
}

/** Returns a resolved mock for pythonBackendFetch('/api/execute-query', ...). */
function mockPythonSuccess(rows: Record<string, unknown>[] = [{ result: 42 }]) {
  return {
    ok: true,
    json: async () => ({
      columns: Object.keys(rows[0] ?? { result: 0 }),
      types: ['INTEGER'],
      rows,
    }),
  };
}

/** Extracts the /api/execute-query call(s) from the pythonBackendFetch spy. */
function getExecuteCalls() {
  return (pythonBackendFetch as jest.Mock).mock.calls.filter(
    ([url]: [string]) => url.includes('/api/execute-query')
  );
}

// ---------------------------------------------------------------------------
// Suite setup
// ---------------------------------------------------------------------------

describe('Parameterized Query Execution E2E', () => {
  beforeAll(async () => {
    const { resetAdapter } = await import('@/lib/database/adapter/factory');
    await resetAdapter();

    await initTestDatabase(dbPath);

    // Insert both test connections once — they persist for the full suite.
    const { createAdapter } = await import('@/lib/database/adapter/factory');
    const db = await createAdapter({ type: 'sqlite', sqlitePath: dbPath });
    const now = new Date().toISOString();

    const maxIdResult = await db.query<{ next_id: number }>(
      `SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM files WHERE company_id = $1`,
      [1]
    );
    const nextId = maxIdResult.rows[0].next_id;

    // Postgres connection — getNodeConnector returns null for 'postgresql', so
    // runQuery falls through to pythonBackendFetch.
    await db.query(
      `INSERT INTO files (company_id, id, name, path, type, content, file_references, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        1, nextId, PG_CONN, `/org/database/${PG_CONN}`, 'connection',
        JSON.stringify({
          id: PG_CONN, name: PG_CONN, type: 'postgresql',
          config: { host: 'localhost', port: 5432, database: 'testdb' },
        }),
        '[]', now, now,
      ]
    );

    // DuckDB connection — getNodeConnector is mocked to return a connector in
    // individual tests, keeping Python out of the loop.
    await db.query(
      `INSERT INTO files (company_id, id, name, path, type, content, file_references, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        1, nextId + 1, DUCK_CONN, `/org/database/${DUCK_CONN}`, 'connection',
        JSON.stringify({
          id: DUCK_CONN, name: DUCK_CONN, type: 'duckdb',
          config: { file_path: '/tmp/test_query_filters.duckdb' },
        }),
        '[]', now, now,
      ]
    );

    await db.close();
  });

  afterAll(async () => {
    await cleanupTestDatabase(dbPath);
  });

  beforeEach(async () => {
    const { resetAdapter } = await import('@/lib/database/adapter/factory');
    await resetAdapter();
    jest.clearAllMocks();

    // Default: no Node.js connector — all connections fall through to Python.
    (getNodeConnector as jest.Mock).mockReturnValue(null);

    // Default Python response.
    // IR endpoints return failure so applyNoneParams uses NULL substitution.
    (pythonBackendFetch as jest.Mock).mockImplementation(async (url: string) => {
      if (url.includes('/api/sql-to-ir') || url.includes('/api/ir-to-sql')) {
        return { ok: false, json: async () => ({}) };
      }
      return mockPythonSuccess();
    });
  });

  // =========================================================================
  // Postgres — date filter (the reported bug)
  // =========================================================================

  it('postgres: date filter with a valid value forwards :param to Python intact', async () => {
    const request = makeQueryRequest({
      database_name: PG_CONN,
      query: 'SELECT COUNT(DISTINCT id) AS total_users FROM stores_a WHERE created_at > :date_min',
      parameters: { date_min: '2024-01-01' },
    });

    const response = await queryPostHandler(request);
    expect(response.status).toBe(200);

    const calls = getExecuteCalls();
    expect(calls).toHaveLength(1);

    const body = JSON.parse(calls[0][1].body);
    // The :date_min placeholder must still be in the query text sent to Python —
    // if enforce_query_limit corrupts it this assertion fails.
    expect(body.query).toContain(':date_min');
    expect(body.parameters).toEqual({ date_min: '2024-01-01' });
  });

  it('postgres: date filter with null value strips :param from query and params', async () => {
    const request = makeQueryRequest({
      database_name: PG_CONN,
      query: 'SELECT COUNT(DISTINCT id) AS total_users FROM stores_b WHERE created_at > :date_min',
      parameters: { date_min: null },
    });

    const response = await queryPostHandler(request);
    expect(response.status).toBe(200);

    const calls = getExecuteCalls();
    expect(calls).toHaveLength(1);

    const body = JSON.parse(calls[0][1].body);
    // applyNoneParams should have substituted NULL for the placeholder
    expect(body.query).not.toContain(':date_min');
    expect(body.parameters).not.toHaveProperty('date_min');
  });

  it('postgres: date filter with empty string is treated the same as null', async () => {
    const request = makeQueryRequest({
      database_name: PG_CONN,
      query: 'SELECT COUNT(DISTINCT id) AS total_users FROM stores_c WHERE created_at > :date_min',
      parameters: { date_min: '' },
    });

    const response = await queryPostHandler(request);
    expect(response.status).toBe(200);

    const calls = getExecuteCalls();
    expect(calls).toHaveLength(1);

    const body = JSON.parse(calls[0][1].body);
    // Empty string is in the noneSet; the placeholder must be removed from the query
    expect(body.query).not.toContain(':date_min');
  });

  // =========================================================================
  // Postgres — number filter
  // =========================================================================

  it('postgres: number filter forwards :param and numeric value to Python', async () => {
    const request = makeQueryRequest({
      database_name: PG_CONN,
      query: 'SELECT * FROM orders_a WHERE amount > :min_amount',
      parameters: { min_amount: 100 },
    });

    const response = await queryPostHandler(request);
    expect(response.status).toBe(200);

    const body = JSON.parse(getExecuteCalls()[0][1].body);
    expect(body.query).toContain(':min_amount');
    expect(body.parameters).toEqual({ min_amount: 100 });
  });

  // =========================================================================
  // Postgres — text filter
  // =========================================================================

  it('postgres: text filter forwards :param and string value to Python', async () => {
    const request = makeQueryRequest({
      database_name: PG_CONN,
      query: 'SELECT * FROM users_a WHERE name = :name_val',
      parameters: { name_val: 'Alice' },
    });

    const response = await queryPostHandler(request);
    expect(response.status).toBe(200);

    const body = JSON.parse(getExecuteCalls()[0][1].body);
    expect(body.query).toContain(':name_val');
    expect(body.parameters).toEqual({ name_val: 'Alice' });
  });

  // =========================================================================
  // Postgres — date range (multiple params)
  // =========================================================================

  it('postgres: date range with both params forwards both :params to Python', async () => {
    const request = makeQueryRequest({
      database_name: PG_CONN,
      query: 'SELECT * FROM events_a WHERE ts > :date_min AND ts < :date_max',
      parameters: { date_min: '2024-01-01', date_max: '2024-12-31' },
    });

    const response = await queryPostHandler(request);
    expect(response.status).toBe(200);

    const body = JSON.parse(getExecuteCalls()[0][1].body);
    expect(body.query).toContain(':date_min');
    expect(body.query).toContain(':date_max');
    expect(body.parameters).toEqual({ date_min: '2024-01-01', date_max: '2024-12-31' });
  });

  it('postgres: date range with one null param strips only that :param', async () => {
    const request = makeQueryRequest({
      database_name: PG_CONN,
      query: 'SELECT * FROM events_b WHERE ts > :date_min AND ts < :date_max',
      parameters: { date_min: '2024-01-01', date_max: null },
    });

    const response = await queryPostHandler(request);
    expect(response.status).toBe(200);

    const body = JSON.parse(getExecuteCalls()[0][1].body);
    expect(body.parameters).toHaveProperty('date_min', '2024-01-01');
    expect(body.parameters).not.toHaveProperty('date_max');
    expect(body.query).not.toContain(':date_max');
  });

  // =========================================================================
  // DuckDB — Node.js connector routing
  // =========================================================================

  it('duckdb: query with param uses Node.js connector; Python is not called', async () => {
    const mockConnector = {
      query: jest.fn().mockResolvedValue({
        columns: ['cnt'],
        types: ['INTEGER'],
        rows: [{ cnt: 7 }],
      }),
    };
    (getNodeConnector as jest.Mock).mockReturnValue(mockConnector);

    const request = makeQueryRequest({
      database_name: DUCK_CONN,
      query: 'SELECT COUNT(*) AS cnt FROM orders_b WHERE amount > :min_amount',
      parameters: { min_amount: 50 },
    });

    const response = await queryPostHandler(request);
    expect(response.status).toBe(200);

    // Node.js connector receives the raw query with :param placeholder and the
    // params dict — the connector itself does the $1 conversion (duckdb-connector.ts)
    expect(mockConnector.query).toHaveBeenCalledWith(
      expect.stringContaining(':min_amount'),
      { min_amount: 50 }
    );

    // Python backend must NOT be called for query execution
    expect(getExecuteCalls()).toHaveLength(0);
  });

  it('duckdb: date filter with valid value is passed to Node.js connector', async () => {
    const mockConnector = {
      query: jest.fn().mockResolvedValue({
        columns: ['total'],
        types: ['INTEGER'],
        rows: [{ total: 3 }],
      }),
    };
    (getNodeConnector as jest.Mock).mockReturnValue(mockConnector);

    const request = makeQueryRequest({
      database_name: DUCK_CONN,
      query: 'SELECT COUNT(*) AS total FROM stores_d WHERE created_at > :date_min',
      parameters: { date_min: '2024-06-01' },
    });

    const response = await queryPostHandler(request);
    expect(response.status).toBe(200);

    expect(mockConnector.query).toHaveBeenCalledWith(
      expect.stringContaining(':date_min'),
      { date_min: '2024-06-01' }
    );
    expect(getExecuteCalls()).toHaveLength(0);
  });
});
