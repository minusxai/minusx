/**
 * E2E tests for parameterised query execution through POST /api/query.
 *
 * Uses a real Python backend so the IR round-trip (applyNoneParams →
 * /api/sql-to-ir → removeNoneParamConditions → /api/ir-to-sql) is exercised
 * end-to-end.  A mocked DuckDB connector captures the final SQL/params to
 * assert on without needing a real database file.
 *
 * Architecture:
 *   Test → queryPostHandler → pythonBackendFetch('/api/sql-to-ir') → REAL PYTHON
 *                                      ↓ removeNoneParamConditions (frontend)
 *                            → pythonBackendFetch('/api/ir-to-sql') → REAL PYTHON
 *                                      ↓
 *                            → getNodeConnector (mocked) ← assert final SQL here
 */

// ---- Jest module mocks (hoisted before imports) ----------------------------

jest.mock('@/lib/database/db-config', () => {
  const path = require('path');
  const dbPath = path.join(process.cwd(), 'data', 'test_param_query_e2e.db');
  return {
    DB_PATH: dbPath,
    DB_DIR: path.join(process.cwd(), 'data'),
    getDbType: () => 'sqlite',
  };
});

let testStore: any;
jest.mock('@/store/store', () => ({
  get store() { return testStore; },
  getStore: () => testStore,
}));

// pythonBackendFetch is NOT mocked — it flows through setupMockFetch to real Python.
// getNodeConnector IS mocked so we can intercept and assert on the final SQL.
jest.mock('@/lib/connections', () => ({
  getNodeConnector: jest.fn(),
}));

// ---------------------------------------------------------------------------

import { withPythonBackend } from '@/test/harness/python-backend';
import { setupMockFetch } from '@/test/harness/mock-fetch';
import { getTestDbPath, initTestDatabase, cleanupTestDatabase } from './test-utils';
import { POST as queryPostHandler } from '@/app/api/query/route';
import { NextRequest } from 'next/server';
import { getNodeConnector } from '@/lib/connections';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const dbPath = getTestDbPath('param_query_e2e');
const DUCK_CONN = 'duck_conn';

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

/** SQL string the mocked connector received. */
function capturedSQL(): string {
  const connector = (getNodeConnector as jest.Mock).mock.results[0]?.value;
  return connector.query.mock.calls[0][0] as string;
}

/** Params dict the mocked connector received. */
function capturedParams(): Record<string, unknown> {
  const connector = (getNodeConnector as jest.Mock).mock.results[0]?.value;
  return connector.query.mock.calls[0][1] as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Suite setup
// ---------------------------------------------------------------------------

describe('Parameterised query execution E2E (real Python backend)', () => {
  const { getPythonPort } = withPythonBackend();

  // setupMockFetch intercepts global.fetch:
  //   • redirects localhost:8001 → dynamic Python port (BACKEND_URL constant fix)
  //   • lets all Python calls through to the real server unchanged
  setupMockFetch({ getPythonPort });

  beforeAll(async () => {
    const { resetAdapter } = await import('@/lib/database/adapter/factory');
    await resetAdapter();
    await initTestDatabase(dbPath);

    const { createAdapter } = await import('@/lib/database/adapter/factory');
    const db = await createAdapter({ type: 'sqlite', sqlitePath: dbPath });
    const now = new Date().toISOString();
    const { rows } = await db.query<{ next_id: number }>(
      `SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM files WHERE company_id = $1`,
      [1]
    );
    await db.query(
      `INSERT INTO files (company_id, id, name, path, type, content, file_references, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        1, rows[0].next_id, DUCK_CONN, `/org/database/${DUCK_CONN}`, 'connection',
        JSON.stringify({ id: DUCK_CONN, name: DUCK_CONN, type: 'duckdb', config: { file_path: 'test.duckdb' } }),
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

    (getNodeConnector as jest.Mock).mockReturnValue({
      query: jest.fn().mockResolvedValue({ columns: ['id'], types: ['INTEGER'], rows: [{ id: 1 }] }),
    });
  });

  // =========================================================================
  // Params with values — forwarded intact
  // =========================================================================

  it('date param with value: forwarded intact to connector', async () => {
    const response = await queryPostHandler(makeQueryRequest({
      database_name: DUCK_CONN,
      query: 'SELECT * FROM orders WHERE created_at > :date_min',
      parameters: { date_min: '2024-01-01' },
    }));
    expect(response.status).toBe(200);
    expect(capturedSQL()).toContain(':date_min');
    expect(capturedParams()).toEqual({ date_min: '2024-01-01' });
  });

  it('number param with value: forwarded intact to connector', async () => {
    const response = await queryPostHandler(makeQueryRequest({
      database_name: DUCK_CONN,
      query: 'SELECT * FROM orders WHERE amount > :min_amount',
      parameters: { min_amount: 100 },
    }));
    expect(response.status).toBe(200);
    expect(capturedSQL()).toContain(':min_amount');
    expect(capturedParams()).toEqual({ min_amount: 100 });
  });

  it('text param with value: forwarded intact to connector', async () => {
    const response = await queryPostHandler(makeQueryRequest({
      database_name: DUCK_CONN,
      query: 'SELECT * FROM users WHERE status = :status',
      parameters: { status: 'active' },
    }));
    expect(response.status).toBe(200);
    expect(capturedSQL()).toContain(':status');
    expect(capturedParams()).toEqual({ status: 'active' });
  });

  it('ILIKE param with value: forwarded intact to connector', async () => {
    const response = await queryPostHandler(makeQueryRequest({
      database_name: DUCK_CONN,
      query: 'SELECT * FROM users WHERE name ILIKE :search',
      parameters: { search: 'alice' },
    }));
    expect(response.status).toBe(200);
    expect(capturedSQL().toUpperCase()).toContain('ILIKE');
    expect(capturedSQL()).toContain(':search');
    expect(capturedParams()).toEqual({ search: 'alice' });
  });

  it('date range with both values: both params forwarded', async () => {
    const response = await queryPostHandler(makeQueryRequest({
      database_name: DUCK_CONN,
      query: 'SELECT * FROM events WHERE ts > :date_min AND ts < :date_max',
      parameters: { date_min: '2024-01-01', date_max: '2024-12-31' },
    }));
    expect(response.status).toBe(200);
    expect(capturedSQL()).toContain(':date_min');
    expect(capturedSQL()).toContain(':date_max');
    expect(capturedParams()).toEqual({ date_min: '2024-01-01', date_max: '2024-12-31' });
  });

  // =========================================================================
  // None params — filter condition removed via real Python IR
  // =========================================================================

  it('= null: IR removes condition entirely', async () => {
    const response = await queryPostHandler(makeQueryRequest({
      database_name: DUCK_CONN,
      query: 'SELECT * FROM users WHERE status = :status',
      parameters: { status: null },
    }));
    expect(response.status).toBe(200);
    expect(capturedSQL()).not.toContain(':status');
    expect(capturedSQL()).not.toContain('NULL');
    expect(capturedSQL()).not.toContain('WHERE');
    expect(capturedParams()).not.toHaveProperty('status');
  });

  it('> null: IR removes condition entirely', async () => {
    const response = await queryPostHandler(makeQueryRequest({
      database_name: DUCK_CONN,
      query: 'SELECT * FROM orders WHERE created_at > :date_min',
      parameters: { date_min: null },
    }));
    expect(response.status).toBe(200);
    expect(capturedSQL()).not.toContain(':date_min');
    expect(capturedSQL()).not.toContain('NULL');
    expect(capturedSQL()).not.toContain('WHERE');
  });

  it('empty string is a regular value — WHERE condition kept, param forwarded', async () => {
    const response = await queryPostHandler(makeQueryRequest({
      database_name: DUCK_CONN,
      query: 'SELECT * FROM orders WHERE status = :status',
      parameters: { status: '' },
    }));
    expect(response.status).toBe(200);
    expect(capturedSQL()).toContain('WHERE');
    expect(capturedSQL()).toContain(':status');
    expect(capturedParams()).toEqual({ status: '' });
  });

  it('ILIKE null: IR removes condition entirely (not NULL substitution)', async () => {
    const response = await queryPostHandler(makeQueryRequest({
      database_name: DUCK_CONN,
      query: 'SELECT * FROM users WHERE name ILIKE :search',
      parameters: { search: null },
    }));
    expect(response.status).toBe(200);
    expect(capturedSQL()).not.toContain(':search');
    expect(capturedSQL()).not.toContain('NULL');
    expect(capturedSQL()).not.toContain('WHERE');
    expect(capturedParams()).not.toHaveProperty('search');
  });

  it('date range one null: removes only the null condition', async () => {
    const response = await queryPostHandler(makeQueryRequest({
      database_name: DUCK_CONN,
      query: 'SELECT * FROM events WHERE ts > :date_min AND ts < :date_max',
      parameters: { date_min: '2024-01-01', date_max: null },
    }));
    expect(response.status).toBe(200);
    expect(capturedSQL()).toContain(':date_min');
    expect(capturedSQL()).not.toContain(':date_max');
    expect(capturedSQL()).not.toContain('NULL');
    expect(capturedParams()).toHaveProperty('date_min', '2024-01-01');
    expect(capturedParams()).not.toHaveProperty('date_max');
  });

  it('mixed: ILIKE null removed, = value preserved', async () => {
    const response = await queryPostHandler(makeQueryRequest({
      database_name: DUCK_CONN,
      query: 'SELECT * FROM users WHERE name ILIKE :search AND status = :status',
      parameters: { search: null, status: 'active' },
    }));
    expect(response.status).toBe(200);
    expect(capturedSQL()).not.toContain(':search');
    expect(capturedSQL()).not.toContain('ILIKE');
    expect(capturedSQL()).toContain(':status');
    expect(capturedParams()).toEqual({ status: 'active' });
  });

  it('all params null: WHERE removed entirely', async () => {
    const response = await queryPostHandler(makeQueryRequest({
      database_name: DUCK_CONN,
      query: 'SELECT * FROM users WHERE name ILIKE :search AND status = :status',
      parameters: { search: null, status: null },
    }));
    expect(response.status).toBe(200);
    expect(capturedSQL()).not.toContain('WHERE');
    expect(capturedSQL()).not.toContain('NULL');
    expect(Object.keys(capturedParams())).toHaveLength(0);
  });
});
