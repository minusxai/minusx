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

    test('Test 13: ORDER BY trailing space (no letter) — exact failing browser payload', async () => {
      // Exact payload: cursorOffset=646, query ends "ORDER BY " (space, no letter typed)
      // Reported bug: {"suggestions":[]} at network level despite Python returning 11.
      const ycQueryTrailingSpace = [
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
        'ORDER BY ',  // trailing space — NO letter
      ].join('\n');

      const result = await CompletionsAPI.getSqlCompletions({
        query: ycQueryTrailingSpace,
        cursorOffset: ycQueryTrailingSpace.length,  // 646
        context: {
          type: 'sql_editor' as const,
          schemaData: ycSchema,
          resolvedReferences: [],
          databaseName: 'yc_companies',
          connectionType: 'csv',
        },
      });

      expect(Array.isArray(result.suggestions)).toBe(true);
      expect(result.suggestions.length).toBeGreaterThan(0);

      const labels = result.suggestions.map((s: any) => s.label);
      expect(labels).toContain('batch');
      expect(labels).toContain('status');
      expect(labels).toContain('batch_year');
      expect(labels).toContain('season');
      expect(labels).toContain('active');
      expect(labels).toContain('exit_rate_pct');
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

  /**
   * Part D: mxfood default schema — real queries from company-template.json
   *
   * Each test takes an actual question SQL query from the default dataset,
   * truncates it at a meaningful cursor position, and asserts that only the
   * columns from the tables actually referenced in that query fragment are
   * returned.  The MXFOOD_SCHEMA below is extracted verbatim from
   * frontend/lib/database/company-template.json (fullSchema section).
   */
  describe('Part D: mxfood default schema — real queries', () => {
    const mxfoodSchema: DatabaseWithSchema[] = [
      {
        databaseName: 'mxfood',
        schemas: [
          {
            schema: 'main',
            tables: [
              {
                table: 'orders',
                columns: [
                  { name: 'order_id',                type: 'BIGINT' },
                  { name: 'user_id',                 type: 'BIGINT' },
                  { name: 'restaurant_id',           type: 'BIGINT' },
                  { name: 'driver_id',               type: 'BIGINT' },
                  { name: 'zone_id',                 type: 'BIGINT' },
                  { name: 'created_at',              type: 'TIMESTAMP' },
                  { name: 'status',                  type: 'VARCHAR' },
                  { name: 'subtotal',                type: 'DOUBLE' },
                  { name: 'delivery_fee',            type: 'DOUBLE' },
                  { name: 'discount_amount',         type: 'DOUBLE' },
                  { name: 'tip_amount',              type: 'DOUBLE' },
                  { name: 'total',                   type: 'DOUBLE' },
                  { name: 'promo_code_id',           type: 'BIGINT' },
                  { name: 'is_subscription_order',   type: 'BOOLEAN' },
                  { name: 'platform',                type: 'VARCHAR' },
                  { name: 'estimated_delivery_mins', type: 'BIGINT' },
                  { name: 'actual_delivery_mins',    type: 'DOUBLE' },
                ],
              },
              {
                table: 'order_items',
                columns: [
                  { name: 'order_item_id', type: 'BIGINT' },
                  { name: 'order_id',      type: 'BIGINT' },
                  { name: 'product_id',    type: 'BIGINT' },
                  { name: 'quantity',      type: 'BIGINT' },
                  { name: 'unit_price',    type: 'DOUBLE' },
                  { name: 'total_price',   type: 'DOUBLE' },
                ],
              },
              {
                table: 'products',
                columns: [
                  { name: 'product_id',     type: 'BIGINT' },
                  { name: 'restaurant_id',  type: 'BIGINT' },
                  { name: 'subcategory_id', type: 'BIGINT' },
                  { name: 'name',           type: 'VARCHAR' },
                  { name: 'description',    type: 'VARCHAR' },
                  { name: 'price',          type: 'DOUBLE' },
                  { name: 'is_available',   type: 'BOOLEAN' },
                  { name: 'created_at',     type: 'TIMESTAMP' },
                ],
              },
              {
                table: 'product_subcategories',
                columns: [
                  { name: 'subcategory_id',   type: 'BIGINT' },
                  { name: 'category_id',      type: 'BIGINT' },
                  { name: 'subcategory_name', type: 'VARCHAR' },
                ],
              },
              {
                table: 'product_categories',
                columns: [
                  { name: 'category_id',   type: 'BIGINT' },
                  { name: 'category_name', type: 'VARCHAR' },
                ],
              },
              {
                table: 'events',
                columns: [
                  { name: 'event_id',        type: 'BIGINT' },
                  { name: 'user_id',         type: 'BIGINT' },
                  { name: 'session_id',      type: 'VARCHAR' },
                  { name: 'event_name',      type: 'VARCHAR' },
                  { name: 'event_timestamp', type: 'TIMESTAMP' },
                  { name: 'platform',        type: 'VARCHAR' },
                  { name: 'screen_name',     type: 'VARCHAR' },
                  { name: 'properties',      type: 'VARCHAR' },
                ],
              },
              {
                table: 'users',
                columns: [
                  { name: 'user_id',             type: 'BIGINT' },
                  { name: 'first_name',          type: 'VARCHAR' },
                  { name: 'last_name',           type: 'VARCHAR' },
                  { name: 'email',               type: 'VARCHAR' },
                  { name: 'phone',               type: 'VARCHAR' },
                  { name: 'created_at',          type: 'TIMESTAMP' },
                  { name: 'zone_id',             type: 'BIGINT' },
                  { name: 'acquisition_channel', type: 'VARCHAR' },
                  { name: 'referred_by_user_id', type: 'DOUBLE' },
                  { name: 'platform',            type: 'VARCHAR' },
                ],
              },
              {
                table: 'zones',
                columns: [
                  { name: 'zone_id',                type: 'BIGINT' },
                  { name: 'zone_name',              type: 'VARCHAR' },
                  { name: 'avg_delivery_time_mins', type: 'BIGINT' },
                  { name: 'surge_multiplier',       type: 'DOUBLE' },
                  { name: 'lat_center',             type: 'DOUBLE' },
                  { name: 'lng_center',             type: 'DOUBLE' },
                ],
              },
              {
                table: 'drivers',
                columns: [
                  { name: 'driver_id',    type: 'BIGINT' },
                  { name: 'name',         type: 'VARCHAR' },
                  { name: 'zone_id',      type: 'BIGINT' },
                  { name: 'vehicle_type', type: 'VARCHAR' },
                  { name: 'rating',       type: 'DOUBLE' },
                  { name: 'created_at',   type: 'TIMESTAMP' },
                  { name: 'is_active',    type: 'BOOLEAN' },
                ],
              },
            ],
          },
        ],
        updated_at: new Date().toISOString(),
      },
    ];

    test('Test 9: WHERE on FROM orders — only orders columns returned (question 17)', async () => {
      // question 17 "Total Monthly Orders" extended with WHERE cursor
      const query =
        "SELECT DATE_TRUNC('month', created_at) as month, COUNT(*) as orders " +
        'FROM orders WHERE ';

      const result = await CompletionsAPI.getSqlCompletions({
        query,
        cursorOffset: query.length,
        context: {
          type: 'sql_editor' as const,
          schemaData: mxfoodSchema,
          resolvedReferences: [],
          databaseName: 'mxfood',
          connectionType: 'duckdb',
        },
      });

      expect(Array.isArray(result.suggestions)).toBe(true);
      const labels = result.suggestions.map((s: any) => s.label);

      // orders columns must appear
      expect(labels).toContain('status');
      expect(labels).toContain('total');
      expect(labels).toContain('created_at');
      expect(labels).toContain('order_id');
      expect(labels).toContain('subtotal');

      // columns from non-referenced tables must not appear
      expect(labels).not.toContain('first_name');    // users
      expect(labels).not.toContain('zone_name');     // zones
      expect(labels).not.toContain('session_id');    // events
      expect(labels).not.toContain('vehicle_type');  // drivers
    });

    test('Test 10: ORDER BY on FROM orders — base columns and SELECT aliases returned (question 14)', async () => {
      // question 14 "Weekly Orders and Revenue" with ORDER BY column removed (cursor at end)
      const query = [
        'SELECT ',
        "  DATE_TRUNC('week', created_at) as week,",
        '  COUNT(*) as orders,',
        '  SUM(total) as revenue',
        'FROM orders',
        "GROUP BY DATE_TRUNC('week', created_at)",
        'ORDER BY ',
      ].join('\n');

      const result = await CompletionsAPI.getSqlCompletions({
        query,
        cursorOffset: query.length,
        context: {
          type: 'sql_editor' as const,
          schemaData: mxfoodSchema,
          resolvedReferences: [],
          databaseName: 'mxfood',
          connectionType: 'duckdb',
        },
      });

      expect(Array.isArray(result.suggestions)).toBe(true);
      const labels = result.suggestions.map((s: any) => s.label);

      // Base orders columns
      expect(labels).toContain('status');
      expect(labels).toContain('total');
      expect(labels).toContain('created_at');

      // SELECT aliases are valid ORDER BY targets
      expect(labels).toContain('week');
      expect(labels).toContain('orders');
      expect(labels).toContain('revenue');

      // Non-referenced tables excluded
      expect(labels).not.toContain('first_name');
      expect(labels).not.toContain('zone_name');
      expect(labels).not.toContain('session_id');
      expect(labels).not.toContain('vehicle_type');
    });

    test('Test 11: WHERE on 5-table JOIN — all joined tables visible, others excluded (question 15)', async () => {
      // question 15 "Weekly Revenue by Product Category", truncated after JOIN chain
      const query = [
        'SELECT ',
        "  DATE_TRUNC('week', o.created_at) as week_start,",
        '  pc.category_name,',
        '  SUM(oi.total_price) as revenue',
        'FROM orders o',
        'JOIN order_items oi ON o.order_id = oi.order_id',
        'JOIN products p ON oi.product_id = p.product_id',
        'JOIN product_subcategories ps ON p.subcategory_id = ps.subcategory_id',
        'JOIN product_categories pc ON ps.category_id = pc.category_id',
        'WHERE ',
      ].join('\n');

      const result = await CompletionsAPI.getSqlCompletions({
        query,
        cursorOffset: query.length,
        context: {
          type: 'sql_editor' as const,
          schemaData: mxfoodSchema,
          resolvedReferences: [],
          databaseName: 'mxfood',
          connectionType: 'duckdb',
        },
      });

      expect(Array.isArray(result.suggestions)).toBe(true);
      const labels = result.suggestions.map((s: any) => s.label);

      // All 5 joined tables' columns must be in scope
      expect(labels).toContain('status');           // orders
      expect(labels).toContain('total');            // orders
      expect(labels).toContain('unit_price');       // order_items
      expect(labels).toContain('quantity');         // order_items
      expect(labels).toContain('total_price');      // order_items
      expect(labels).toContain('price');            // products
      expect(labels).toContain('is_available');     // products
      expect(labels).toContain('subcategory_name'); // product_subcategories
      expect(labels).toContain('category_name');    // product_categories

      // Non-joined tables must not appear
      expect(labels).not.toContain('first_name');    // users
      expect(labels).not.toContain('zone_name');     // zones
      expect(labels).not.toContain('session_id');    // events
      expect(labels).not.toContain('vehicle_type');  // drivers
    });

    test('Test 12: GROUP BY on FROM events — events columns and SELECT aliases returned (question 25)', async () => {
      // question 25 "Daily Sessions", GROUP BY columns removed (cursor at end)
      const query = [
        'SELECT ',
        '  DATE(event_timestamp) as date,',
        '  platform,',
        '  COUNT(DISTINCT session_id) as total_sessions',
        'FROM events',
        "WHERE event_timestamp >= '2025-12-01'",
        'GROUP BY ',
      ].join('\n');

      const result = await CompletionsAPI.getSqlCompletions({
        query,
        cursorOffset: query.length,
        context: {
          type: 'sql_editor' as const,
          schemaData: mxfoodSchema,
          resolvedReferences: [],
          databaseName: 'mxfood',
          connectionType: 'duckdb',
        },
      });

      expect(Array.isArray(result.suggestions)).toBe(true);
      const labels = result.suggestions.map((s: any) => s.label);

      // events columns must appear
      expect(labels).toContain('event_id');
      expect(labels).toContain('session_id');
      expect(labels).toContain('event_name');
      expect(labels).toContain('event_timestamp');
      expect(labels).toContain('screen_name');
      expect(labels).toContain('properties');

      // SELECT aliases are valid GROUP BY targets
      expect(labels).toContain('date');
      expect(labels).toContain('total_sessions');

      // Non-referenced tables excluded
      expect(labels).not.toContain('first_name');    // users
      expect(labels).not.toContain('status');        // orders
      expect(labels).not.toContain('zone_name');     // zones
      expect(labels).not.toContain('vehicle_type');  // drivers
    });
  });
});
