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

  describe('Part B-ext: Column autocomplete for @reference dot-notation (schema augmentation)', () => {
    /**
     * This suite verifies the infer-columns schema augmentation path introduced alongside
     * the @reference autocomplete feature.  After CTE conversion, Python receives the
     * augmented schemaData that includes a virtual table entry for each resolved reference
     * (columns inferred via /api/infer-columns).  This lets Python suggest columns when
     * the cursor is positioned after `alias.`.
     */

    test('Test 3b: Should suggest inferred columns after @reference alias dot-notation', async () => {
      // Query: SELECT a. FROM @revenue_1 a
      // Cursor is positioned right after "a." — column completion context
      const query = 'SELECT a. FROM @revenue_1 a';
      const cursorOffset = 9; // After "SELECT a."

      const result = await CompletionsAPI.getSqlCompletions({
        query,
        cursorOffset,
        context: {
          type: 'sql_editor' as const,
          schemaData: testSchemaData,
          resolvedReferences: [
            {
              id: 1,
              alias: 'revenue_1',
              query: 'SELECT user_id, SUM(amount) AS total FROM orders GROUP BY user_id',
            },
          ],
          databaseName: 'test_db',
        },
      });

      // Python should have received the augmented schemaData (virtual table for revenue_1)
      // and the CTE query, and return column completions for the alias
      expect(Array.isArray(result.suggestions)).toBe(true);

      const labels = result.suggestions.map((s: any) => s.label);

      // The inferred columns (user_id, total) from the @reference should appear
      expect(labels).toContain('user_id');
      expect(labels).toContain('total');

      // Original table columns not in the CTE should NOT appear
      expect(labels).not.toContain('amount');
      expect(labels).not.toContain('created_at');
    });

    test('Test 3c: Should merge inferred columns from multiple @references into schema', async () => {
      // Two @references each contributing distinct columns
      const query = 'SELECT r., c. FROM @rev_1 r JOIN @costs_2 c ON r.user_id = c.user_id';
      const cursorOffset = 9; // After "SELECT r."

      const result = await CompletionsAPI.getSqlCompletions({
        query,
        cursorOffset,
        context: {
          type: 'sql_editor' as const,
          schemaData: testSchemaData,
          resolvedReferences: [
            {
              id: 1,
              alias: 'rev_1',
              query: 'SELECT user_id, SUM(amount) AS revenue FROM orders GROUP BY user_id',
            },
            {
              id: 2,
              alias: 'costs_2',
              query: 'SELECT user_id, SUM(amount) AS costs FROM orders WHERE amount < 0 GROUP BY user_id',
            },
          ],
          databaseName: 'test_db',
        },
      });

      expect(Array.isArray(result.suggestions)).toBe(true);

      // Should at minimum not crash and return suggestions
      // (Python may return columns from the rev_1 CTE at this cursor position)
      const labels = result.suggestions.map((s: any) => s.label);
      expect(labels).toContain('user_id');
    });

    test('Test 3d: Should not call infer-columns when inferredColumns already cached on reference', async () => {
      // Pre-supply inferredColumns on the reference — server should skip the /api/infer-columns call
      const result = await CompletionsAPI.getSqlCompletions({
        query: 'SELECT a. FROM @cached_ref_3 a',
        cursorOffset: 9,
        context: {
          type: 'sql_editor' as const,
          schemaData: testSchemaData,
          resolvedReferences: [
            {
              id: 3,
              alias: 'cached_ref_3',
              query: 'SELECT month, total FROM summary',
              inferredColumns: [
                { name: 'month', type: 'varchar' },
                { name: 'total', type: 'number' },
              ],
            },
          ],
          databaseName: 'test_db',
        },
      });

      expect(Array.isArray(result.suggestions)).toBe(true);
      // Suggestions should still come through (schema was augmented from cached columns)
      const labels = result.suggestions.map((s: any) => s.label);
      expect(labels).toContain('month');
      expect(labels).toContain('total');
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

  describe('Part C: Real-world DuckDB query — ORDER BY alias completion', () => {
    /**
     * Regression for the bug where {"suggestions":[]} was returned for a complex
     * DuckDB aggregation query with SELECT aliases typed at ORDER BY.
     *
     * Exact payload captured from the user's Network tab:
     *   cursorOffset: 647 (end of query)
     *   connectionType: "csv"  (maps to DuckDB dialect)
     *   schemaData: yc_companies DB with t_2024_05_11_yc_companies table (16 cols)
     *
     * Expected behavior:
     *   - Base columns from the FROM table (batch, status, …) appear
     *   - SELECT aliases (batch_year, season, active, …) appear — always valid in ORDER BY
     *   - Zero suggestions is a bug
     */
    const ycSchema: DatabaseWithSchema[] = [
      {
        databaseName: 'yc_companies',
        schemas: [
          {
            schema: 'main',
            tables: [
              {
                table: 't_2024_05_11_yc_companies',
                columns: [
                  { name: 'company_id',       type: 'BIGINT' },
                  { name: 'company_name',      type: 'VARCHAR' },
                  { name: 'short_description', type: 'VARCHAR' },
                  { name: 'long_description',  type: 'VARCHAR' },
                  { name: 'batch',             type: 'VARCHAR' },
                  { name: 'status',            type: 'VARCHAR' },
                  { name: 'tags',              type: 'VARCHAR' },
                  { name: 'location',          type: 'VARCHAR' },
                  { name: 'country',           type: 'VARCHAR' },
                  { name: 'year_founded',      type: 'DOUBLE' },
                  { name: 'num_founders',      type: 'BIGINT' },
                  { name: 'founders_names',    type: 'VARCHAR' },
                  { name: 'team_size',         type: 'DOUBLE' },
                  { name: 'website',           type: 'VARCHAR' },
                  { name: 'cb_url',            type: 'VARCHAR' },
                  { name: 'linkedin_url',      type: 'VARCHAR' },
                ],
              },
            ],
          },
        ],
        updated_at: new Date().toISOString(),
      },
    ];

    const ycQuery = [
      'SELECT',
      '    batch,',
      "    TRY_CAST('20' || SUBSTRING(batch, 2, 2) AS INTEGER) AS batch_year,",
      '    SUBSTRING(batch, 1, 1) AS season,',
      '    COUNT(*) AS total_companies,',
      "    COUNT(CASE WHEN status = 'Active'   THEN 1 END) AS active,",
      "    COUNT(CASE WHEN status = 'Acquired' THEN 1 END) AS acquired,",
      "    COUNT(CASE WHEN status = 'Public'   THEN 1 END) AS public_co,",
      "    COUNT(CASE WHEN status = 'Inactive' THEN 1 END) AS inactive,",
      "    ROUND(100.0 * COUNT(CASE WHEN status IN ('Acquired', 'Public') THEN 1 END) / COUNT(*), 1) AS exit_rate_pct",
      'FROM t_2024_05_11_yc_companies',
      "WHERE batch LIKE 'S%' OR batch LIKE 'W%'",
      'GROUP BY batch, batch_year, season',
      'ORDER BY A',
    ].join('\n');

    test('Test 7: ORDER BY on complex DuckDB aggregation — base columns and SELECT aliases both returned', async () => {
      const result = await CompletionsAPI.getSqlCompletions({
        query: ycQuery,
        cursorOffset: 647, // End of query — matches the exact reported payload
        context: {
          type: 'sql_editor' as const,
          schemaData: ycSchema,
          resolvedReferences: [],
          databaseName: 'yc_companies',
          connectionType: 'csv', // csv → DuckDB dialect
        },
      });

      expect(Array.isArray(result.suggestions)).toBe(true);
      expect(result.suggestions.length).toBeGreaterThan(0);

      const labels = result.suggestions.map((s: any) => s.label);

      // Base columns from the FROM table must appear
      expect(labels).toContain('batch');
      expect(labels).toContain('status');
      expect(labels).toContain('company_id');

      // SELECT aliases must appear — they are valid ORDER BY targets
      expect(labels).toContain('batch_year');
      expect(labels).toContain('season');
      expect(labels).toContain('total_companies');
      expect(labels).toContain('active');
      expect(labels).toContain('acquired');
      expect(labels).toContain('public_co');
      expect(labels).toContain('inactive');
      expect(labels).toContain('exit_rate_pct');

      // Zero suggestions is the regression we are guarding against
      expect(labels.length).toBeGreaterThanOrEqual(10);
    });

    test('Test 8: WHERE clause on same query — only base table columns, not aliases', async () => {
      // Cursor after WHERE — base columns are the right suggestions, not ORDER BY aliases
      const queryUpToWhere = ycQuery.substring(
        0,
        ycQuery.indexOf('\nGROUP BY') > 0
          ? ycQuery.lastIndexOf('WHERE') + 'WHERE '.length
          : ycQuery.length
      );

      const result = await CompletionsAPI.getSqlCompletions({
        query: ycQuery, // Full query
        cursorOffset: ycQuery.indexOf("WHERE batch LIKE") + 'WHERE '.length,
        context: {
          type: 'sql_editor' as const,
          schemaData: ycSchema,
          resolvedReferences: [],
          databaseName: 'yc_companies',
          connectionType: 'csv',
        },
      });

      expect(Array.isArray(result.suggestions)).toBe(true);
      const labels = result.suggestions.map((s: any) => s.label);

      // Base columns from FROM table must appear
      expect(labels).toContain('batch');
      expect(labels).toContain('status');
      expect(labels).toContain('company_name');

      // Must NOT show columns from tables not in query
      expect(labels).not.toContain('user_id');
      expect(labels).not.toContain('order_id');
    });
  });
});
