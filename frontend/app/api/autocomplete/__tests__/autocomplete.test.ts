/**
 * E2E Tests for Autocomplete API (Phase 2)
 * Tests Next.js backend integration with Python API via client module
 */

import { withPythonBackend } from '@/test/harness/python-backend';
import { setupMockFetch } from '@/test/harness/mock-fetch';
import { setupTestDb } from '@/test/harness/test-db';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { POST as autocompleteHandler } from '../route';
import { CompletionsAPI } from '@/lib/data/completions/completions';
import { DatabaseWithSchema } from '@/lib/types';

describe('Autocomplete API - Phase 2 E2E Tests', () => {
  const { getPythonPort } = withPythonBackend();
  setupTestDb(getTestDbPath('autocomplete_e2e'));

  // Mock user for autocomplete handler
  const mockUser = {
    companyId: 1,
    companyName: 'test',
    userId: 1,
    email: 'test@test.com',
    role: 'admin' as const,
    homeFolder: '/org',
    mode: 'org' as const
  };

  // Add interceptor for /api/autocomplete
  const mockFetch = setupMockFetch({
    getPythonPort,
    interceptors: [
      {
        includesUrl: ['localhost:3000/api/autocomplete'],
        startsWithUrl: ['/api/autocomplete'],
        handler: async (request) => autocompleteHandler(request, mockUser)
      }
    ]
  });

  beforeEach(() => {
    mockFetch.mockClear();
    CompletionsAPI.clearCache();
  });

  // Sample schema data for tests
  const testSchemaData: DatabaseWithSchema[] = [
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
                { name: 'user_id', type: 'int' },
                { name: 'amount', type: 'decimal' },
                { name: 'created_at', type: 'timestamp' }
              ]
            },
            {
              table: 'users',
              columns: [
                { name: 'user_id', type: 'int' },
                { name: 'username', type: 'varchar' },
                { name: 'email', type: 'varchar' }
              ]
            }
          ]
        }
      ],
      updated_at: new Date().toISOString()
    }
  ];

  describe('Part A: CTE Joining + Python API Integration', () => {
    test('Test 1: Should convert @references to CTEs before calling Python API', async () => {

      // Use client module to call API
      const result = await CompletionsAPI.getSqlCompletions({
        query: 'SELECT * FROM @revenue WHERE total > 1000',
        cursorOffset: 7, // After "SELECT "
        context: {
          type: 'sql_editor' as const,
          schemaData: testSchemaData,
          resolvedReferences: [
            {
              id: 1,
              alias: 'revenue',
              query: 'SELECT user_id, SUM(amount) as total FROM orders GROUP BY user_id'
            }
          ],
          databaseName: 'test_db'
        }
      });

      // Should receive suggestions (columns from CTE)
      expect(Array.isArray(result.suggestions)).toBe(true);
      const columnNames = result.suggestions.map((s: any) => s.label);

      // Should include columns from the CTE (user_id, total)
      expect(columnNames).toContain('user_id');
      expect(columnNames).toContain('total');

      // Should NOT include original orders columns
      expect(columnNames).not.toContain('amount');
      expect(columnNames).not.toContain('order_id');
    });

    test('Test 2: Should handle nested references (question references another question)', async () => {

      // Q3 references Q2, Q2 references Q1 (nested chain)
      const result = await CompletionsAPI.getSqlCompletions({
        query: 'SELECT * FROM @final_report',
        cursorOffset: 7, // After "SELECT "
        context: {
          type: 'sql_editor' as const,
          schemaData: testSchemaData,
          resolvedReferences: [
            {
              id: 3,
              alias: 'final_report',
              query: 'SELECT user_id, revenue, username FROM @enriched'
            },
            {
              id: 2,
              alias: 'enriched',
              query: 'SELECT r.user_id, r.revenue, u.username FROM @revenue r JOIN users u ON r.user_id = u.user_id'
            },
            {
              id: 1,
              alias: 'revenue',
              query: 'SELECT user_id, SUM(amount) as revenue FROM orders GROUP BY user_id'
            }
          ],
          databaseName: 'test_db'
        }
      });

      const columnNames = result.suggestions.map((s: any) => s.label);

      // Should have columns from the final CTE
      expect(columnNames).toContain('user_id');
      expect(columnNames).toContain('revenue');
      expect(columnNames).toContain('username');

      // Should NOT have intermediate columns
      expect(columnNames).not.toContain('amount');
    });

    test('Test 3: Should handle multiple references in single query', async () => {

      // Query references 3 different CTEs
      const result = await CompletionsAPI.getSqlCompletions({
        query: 'SELECT * FROM @revenue JOIN @costs ON @revenue.user_id = @costs.user_id',
        cursorOffset: 7, // After "SELECT "
        context: {
          type: 'sql_editor' as const,
          schemaData: testSchemaData,
          resolvedReferences: [
            {
              id: 1,
              alias: 'revenue',
              query: 'SELECT user_id, SUM(amount) as total_revenue FROM orders WHERE amount > 0 GROUP BY user_id'
            },
            {
              id: 2,
              alias: 'costs',
              query: 'SELECT user_id, SUM(amount) as total_costs FROM orders WHERE amount < 0 GROUP BY user_id'
            }
          ],
          databaseName: 'test_db'
        }
      });

      const columnNames = result.suggestions.map((s: any) => s.label);

      // Should have columns from both CTEs
      expect(columnNames).toContain('user_id');
      expect(columnNames).toContain('total_revenue');
      expect(columnNames).toContain('total_costs');
    });
  });

  describe('Part B: Error Handling & Edge Cases', () => {
    test('Test 4: Should handle empty resolved references gracefully', async () => {

      const result = await CompletionsAPI.getSqlCompletions({
        query: 'SELECT * FROM users',
        cursorOffset: 7, // After "SELECT "
        context: {
          type: 'sql_editor' as const,
          schemaData: testSchemaData,
          resolvedReferences: [], // No references
          databaseName: 'test_db'
        }
      });

      const columnNames = result.suggestions.map((s: any) => s.label);

      // Should show columns from users table
      expect(columnNames).toContain('user_id');
      expect(columnNames).toContain('username');
      expect(columnNames).toContain('email');
    });

    test('Test 5: Should handle invalid SQL gracefully', async () => {

      const result = await CompletionsAPI.getSqlCompletions({
        query: 'SELECT * FRON users', // Typo: FRON instead of FROM
        cursorOffset: 7,
        context: {
          type: 'sql_editor' as const,
          schemaData: testSchemaData,
          resolvedReferences: [],
          databaseName: 'test_db'
        }
      });

      // Should return keyword suggestions or empty array (graceful degradation)
      expect(Array.isArray(result.suggestions)).toBe(true);
    });

    test('Test 6: Should handle missing schema data', async () => {

      const result = await CompletionsAPI.getSqlCompletions({
        query: 'SELECT * FROM users',
        cursorOffset: 7,
        context: {
          type: 'sql_editor' as const,
          schemaData: [], // No schema data
          resolvedReferences: [],
          databaseName: 'test_db'
        }
      });

      // Should return empty suggestions or keywords (no crash)
      expect(Array.isArray(result.suggestions)).toBe(true);
    });
  });
});
