/**
 * E2E Tests for /api/infer-columns
 *
 * Part A — Python /api/infer-columns endpoint: static column inference via sqlglot
 * Part B — Next.js route: loads question from DB, calls Python, returns columns
 */

// Must be hoisted before any imports that touch the DB — path must match getTestDbPath('infer_columns_e2e')
jest.mock('@/lib/database/db-config', () => {
  const path = require('path');
  return {
    DB_PATH: path.join(process.cwd(), 'data', 'test_infer_columns_e2e.db'),
    DB_DIR: path.join(process.cwd(), 'data'),
    getDbType: () => 'sqlite' as const,
  };
});

import { NextRequest } from 'next/server';
import { withPythonBackend } from '@/test/harness/python-backend';
import { setupMockFetch } from '@/test/harness/mock-fetch';
import { setupTestDb } from '@/test/harness/test-db';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { POST as inferColumnsHandler } from '../route';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';

const mockUser = {
  companyId: 1,
  companyName: 'test',
  userId: 1,
  email: 'test@test.com',
  role: 'admin' as const,
  homeFolder: '/org',
  mode: 'org' as const,
};

// Insert a test question into the DB before each test (known ID = 9001)
const TEST_QUESTION_ID = 9001;
const TEST_QUESTION_QUERY =
  'SELECT region, SUM(sales) AS total_sales FROM sales_data GROUP BY region';

describe('Infer Columns - E2E Tests', () => {
  const { getPythonPort } = withPythonBackend();

  setupTestDb(getTestDbPath('infer_columns_e2e'), {
    customInit: async (dbPath) => {
      const { createAdapter } = await import('@/lib/database/adapter/factory');
      const db = await createAdapter({ type: 'sqlite', sqlitePath: dbPath });
      await db.query(
        `INSERT INTO files (id, name, path, type, content, company_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          TEST_QUESTION_ID,
          'Test Infer Question',
          '/org/test-infer-question',
          'question',
          JSON.stringify({
            query: TEST_QUESTION_QUERY,
            vizSettings: { type: 'table' },
            parameters: {},
            database_name: null,
            references: [],
          }),
          1,
          new Date().toISOString(),
          new Date().toISOString(),
        ]
      );
      await db.close();
    },
  });

  // Python backend calls pass through mock-fetch automatically (localhost:8001 → dynamic port)
  const mockFetch = setupMockFetch({ getPythonPort });

  // Override global mock to include mode:'org' and home_folder:'/org'
  // (global jest.setup.ts mock uses home_folder:'/test' with no mode field,
  //  which breaks permission checks for files under /org/*)
  beforeAll(() => {
    (getEffectiveUser as jest.Mock).mockResolvedValue({
      userId: 1,
      email: 'test@example.com',
      companyId: 1,
      role: 'admin',
      home_folder: '/org',
      mode: 'org',
    });
  });

  beforeEach(() => {
    mockFetch.mockClear();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Part A: Python endpoint — static column inference
  // ──────────────────────────────────────────────────────────────────────────

  describe('Part A: Python endpoint — static column inference', () => {
    async function callPython(query: string, schemaData: any[] = []) {
      const port = getPythonPort();
      const res = await fetch(`http://localhost:${port}/api/infer-columns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, schema_data: schemaData }),
      });
      expect(res.ok).toBe(true);
      return res.json() as Promise<{ columns: { name: string; type: string }[]; error?: string }>;
    }

    test('Test A1: infers column names from aggregate SELECT', async () => {
      const data = await callPython(
        'SELECT user_id, SUM(amount) AS total FROM orders GROUP BY user_id'
      );

      const names = data.columns.map((c) => c.name);
      expect(names).toContain('user_id');
      expect(names).toContain('total');
      expect(data.columns).toHaveLength(2);
    });

    test('Test A2: infers column names from aliased string/function expressions', async () => {
      const data = await callPython(
        "SELECT id, LOWER(name) AS lower_name, created_at FROM users"
      );

      const names = data.columns.map((c) => c.name);
      expect(names).toContain('id');
      expect(names).toContain('lower_name');
      expect(names).toContain('created_at');
    });

    test('Test A3: infers CAST type annotation', async () => {
      const data = await callPython(
        "SELECT CAST(price AS DECIMAL(10,2)) AS price_decimal FROM products"
      );

      const priceCol = data.columns.find((c) => c.name === 'price_decimal');
      expect(priceCol).toBeDefined();
      expect(priceCol!.type.toLowerCase()).toMatch(/decimal/);
    });

    test('Test A4: expands SELECT * columns from schema_data', async () => {
      const schemaData = [
        {
          databaseName: 'test_db',
          schemas: [
            {
              schema: 'public',
              tables: [
                {
                  table: 'orders',
                  columns: [
                    { name: 'order_id', type: 'int' },
                    { name: 'amount', type: 'decimal' },
                  ],
                },
              ],
            },
          ],
        },
      ];

      const data = await callPython('SELECT * FROM orders', schemaData);

      const names = data.columns.map((c) => c.name);
      expect(names).toContain('order_id');
      expect(names).toContain('amount');
    });

    test('Test A5: handles invalid SQL without throwing (graceful degradation)', async () => {
      const data = await callPython('NOT VALID SQL AT ALL !!!');

      // Should return a response with an empty columns array, not a 500
      expect(Array.isArray(data.columns)).toBe(true);
    });

    test('Test A6: looks up column type from schema_data for plain column references', async () => {
      const schemaData = [
        {
          databaseName: 'test_db',
          schemas: [
            {
              schema: 'public',
              tables: [
                {
                  table: 'users',
                  columns: [{ name: 'email', type: 'varchar' }],
                },
              ],
            },
          ],
        },
      ];

      const data = await callPython('SELECT email FROM users', schemaData);

      const emailCol = data.columns.find((c) => c.name === 'email');
      expect(emailCol).toBeDefined();
      expect(emailCol!.type).toBe('varchar');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Part B: Next.js route — question-based column inference
  // ──────────────────────────────────────────────────────────────────────────

  describe('Part B: Next.js route — question-based column inference', () => {
    function makeRequest(body: unknown) {
      return new NextRequest('http://localhost:3000/api/infer-columns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    }

    test('Test B1: returns inferred columns for a question by ID', async () => {
      const response = await inferColumnsHandler(makeRequest({ questionId: TEST_QUESTION_ID }), mockUser);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(Array.isArray(data.columns)).toBe(true);

      const names = data.columns.map((c: any) => c.name);
      expect(names).toContain('region');
      expect(names).toContain('total_sales');
    });

    test('Test B2: returns 400 when questionId is missing', async () => {
      const response = await inferColumnsHandler(makeRequest({}), mockUser);
      expect(response.status).toBe(400);
    });

    test('Test B3: returns 404 for a non-existent question ID', async () => {
      const response = await inferColumnsHandler(makeRequest({ questionId: 999999 }), mockUser);
      expect(response.status).toBe(404);
    });
  });
});
