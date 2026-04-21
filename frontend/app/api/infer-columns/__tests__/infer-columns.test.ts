/**
 * E2E Tests for /api/infer-columns
 *
 * Part A — Python /api/infer-columns endpoint: static column inference via sqlglot
 * Part B — Next.js route: loads question from DB, calls Python, returns columns
 */

// Must be hoisted before any imports that touch the DB — path must match getTestDbPath('infer_columns_e2e')
jest.mock('@/lib/database/db-config', () => ({
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

import { NextRequest } from 'next/server';
import { setupTestDb } from '@/test/harness/test-db';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { POST as inferColumnsHandler } from '../route';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';

const mockUser = {
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
  setupTestDb(getTestDbPath('infer_columns_e2e'), {
    customInit: async (_dbPath) => {
      const { getAdapter } = await import('@/lib/database/adapter/factory');
      const db = await getAdapter();
      await db.query(
        `INSERT INTO files (id, name, path, type, content, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          TEST_QUESTION_ID,
          'Test Infer Question',
          '/org/test-infer-question',
          'question',
          JSON.stringify({
            query: TEST_QUESTION_QUERY,
            vizSettings: { type: 'table' },
            parameters: {},
            connection_name: null,
            references: [],
          }),
          new Date().toISOString(),
          new Date().toISOString(),
        ]
      );
    },
  });

  // No Python backend needed — infer-columns runs locally via WASM
  // Part A (Python endpoint tests) moved to lib/sql/__tests__/infer-columns.test.ts

  // Override global mock to include mode:'org' and home_folder:'/org'
  beforeAll(() => {
    (getEffectiveUser as jest.Mock).mockResolvedValue({
      userId: 1,
      email: 'test@example.com',
      role: 'admin',
      home_folder: '/org',
      mode: 'org',
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Next.js route — question-based column inference
  // ──────────────────────────────────────────────────────────────────────────

  describe('Next.js route — question-based column inference', () => {
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
