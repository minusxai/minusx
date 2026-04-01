/**
 * E2E Autocomplete Tests — single source of truth
 *
 * All tests call CompletionsAPI.getSqlCompletions() which routes:
 *   browser → Next.js /api/autocomplete → Python /api/sql-autocomplete
 *
 * Schema is loaded from the seeded tutorial database (atlas_documents.db)
 * rather than hardcoded, so it stays in sync automatically.
 */

import { withPythonBackend } from '@/test/harness/python-backend';
import { setupMockFetch } from '@/test/harness/mock-fetch';
import { setupTestDb } from '@/test/harness/test-db';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { POST as autocompleteHandler } from '../route';
import { CompletionsAPI } from '@/lib/data/completions/completions';
import { DatabaseWithSchema } from '@/lib/types';

// ---------------------------------------------------------------------------
// Harness setup
// ---------------------------------------------------------------------------

// Schema is populated in customInit from the mxfood connection document.
let mxfoodSchema: DatabaseWithSchema[] = [];

describe('Autocomplete API — E2E', () => {
  const { getPythonPort } = withPythonBackend();
  setupTestDb(getTestDbPath('autocomplete_e2e'), {
    withTutorialFiles: true,
    customInit: async (dbPath) => {
      const { createAdapter } = await import('@/lib/database/adapter/factory');
      const db = await createAdapter({ type: 'sqlite', sqlitePath: dbPath });
      const result = await db.query<{ name: string; content: string }>(
        `SELECT name, content FROM files WHERE type = 'connection' AND name = 'mxfood' AND company_id = 1 LIMIT 1`,
        []
      );
      await db.close();

      if (result.rows.length === 0) throw new Error('mxfood connection not found in tutorial database');
      const content = JSON.parse(result.rows[0].content);
      mxfoodSchema = [{
        databaseName: result.rows[0].name,
        schemas: content?.schema?.schemas ?? [],
        updated_at: content?.schema?.updated_at,
      }];
    },
  });

  const mockUser = {
    companyId: 1,
    companyName: 'test',
    userId: 1,
    email: 'test@test.com',
    role: 'admin' as const,
    homeFolder: '/org',
    mode: 'org' as const,
  };

  const mockFetch = setupMockFetch({
    getPythonPort,
    interceptors: [
      {
        includesUrl: ['localhost:3000/api/autocomplete'],
        startsWithUrl: ['/api/autocomplete'],
        handler: async (request) => autocompleteHandler(request, mockUser),
      },
    ],
  });

  beforeEach(() => {
    mockFetch.mockClear();
    CompletionsAPI.clearCache();
  });

  // -------------------------------------------------------------------------
  // @reference / CTE resolution
  // -------------------------------------------------------------------------

  describe('@reference / CTE resolution', () => {
    test('converts @reference to CTE before calling Python', async () => {
      const result = await CompletionsAPI.getSqlCompletions({
        query: 'SELECT * FROM @revenue WHERE subtotal > 100',
        cursorOffset: 7, // after "SELECT "
        context: {
          type: 'sql_editor' as const,
          schemaData: mxfoodSchema,
          resolvedReferences: [
            {
              id: 1,
              alias: 'revenue',
              query: 'SELECT user_id, SUM(total) as revenue FROM orders GROUP BY user_id',
            },
          ],
          databaseName: 'mxfood',
          connectionType: 'duckdb',
        },
      });

      expect(Array.isArray(result.suggestions)).toBe(true);
      const labels = result.suggestions.map((s: any) => s.label);

      expect(labels).toContain('user_id');
      expect(labels).toContain('revenue');
      // Original orders columns not projected into CTE should be absent
      expect(labels).not.toContain('subtotal');
      expect(labels).not.toContain('order_id');
    });

    test('handles nested @reference chain', async () => {
      const result = await CompletionsAPI.getSqlCompletions({
        query: 'SELECT * FROM @final_report',
        cursorOffset: 7,
        context: {
          type: 'sql_editor' as const,
          schemaData: mxfoodSchema,
          resolvedReferences: [
            {
              id: 3,
              alias: 'final_report',
              query: 'SELECT user_id, revenue, first_name FROM @enriched',
            },
            {
              id: 2,
              alias: 'enriched',
              query: 'SELECT r.user_id, r.revenue, u.first_name FROM @revenue r JOIN users u ON r.user_id = u.user_id',
            },
            {
              id: 1,
              alias: 'revenue',
              query: 'SELECT user_id, SUM(total) as revenue FROM orders GROUP BY user_id',
            },
          ],
          databaseName: 'mxfood',
          connectionType: 'duckdb',
        },
      });

      const labels = result.suggestions.map((s: any) => s.label);

      expect(labels).toContain('user_id');
      expect(labels).toContain('revenue');
      expect(labels).toContain('first_name');
      expect(labels).not.toContain('subtotal');
    });

    test('handles multiple @references in single query', async () => {
      const result = await CompletionsAPI.getSqlCompletions({
        query: 'SELECT * FROM @revenue JOIN @costs ON @revenue.user_id = @costs.user_id',
        cursorOffset: 7,
        context: {
          type: 'sql_editor' as const,
          schemaData: mxfoodSchema,
          resolvedReferences: [
            {
              id: 1,
              alias: 'revenue',
              query: 'SELECT user_id, SUM(total) as total_revenue FROM orders WHERE total > 0 GROUP BY user_id',
            },
            {
              id: 2,
              alias: 'costs',
              query: 'SELECT user_id, SUM(discount_amount) as total_costs FROM orders GROUP BY user_id',
            },
          ],
          databaseName: 'mxfood',
          connectionType: 'duckdb',
        },
      });

      const labels = result.suggestions.map((s: any) => s.label);

      expect(labels).toContain('user_id');
      expect(labels).toContain('total_revenue');
      expect(labels).toContain('total_costs');
    });

    test('suggests inferred columns after @reference alias dot-notation', async () => {
      const result = await CompletionsAPI.getSqlCompletions({
        query: 'SELECT a. FROM @revenue_1 a',
        cursorOffset: 9, // after "SELECT a."
        context: {
          type: 'sql_editor' as const,
          schemaData: mxfoodSchema,
          resolvedReferences: [
            {
              id: 1,
              alias: 'revenue_1',
              query: 'SELECT user_id, SUM(total) AS revenue FROM orders GROUP BY user_id',
            },
          ],
          databaseName: 'mxfood',
          connectionType: 'duckdb',
        },
      });

      expect(Array.isArray(result.suggestions)).toBe(true);
      const labels = result.suggestions.map((s: any) => s.label);

      expect(labels).toContain('user_id');
      expect(labels).toContain('revenue');
      expect(labels).not.toContain('subtotal');
      expect(labels).not.toContain('created_at');
    });

    test('merges inferred columns from multiple @references into schema', async () => {
      const result = await CompletionsAPI.getSqlCompletions({
        query: 'SELECT r. FROM @rev_1 r JOIN @costs_2 c ON r.user_id = c.user_id',
        cursorOffset: 9, // after "SELECT r."
        context: {
          type: 'sql_editor' as const,
          schemaData: mxfoodSchema,
          resolvedReferences: [
            {
              id: 1,
              alias: 'rev_1',
              query: 'SELECT user_id, SUM(total) AS revenue FROM orders GROUP BY user_id',
            },
            {
              id: 2,
              alias: 'costs_2',
              query: 'SELECT user_id, SUM(discount_amount) AS costs FROM orders GROUP BY user_id',
            },
          ],
          databaseName: 'mxfood',
          connectionType: 'duckdb',
        },
      });

      expect(Array.isArray(result.suggestions)).toBe(true);
      const labels = result.suggestions.map((s: any) => s.label);
      expect(labels).toContain('user_id');
    });

    test('skips infer-columns call when inferredColumns already provided', async () => {
      const result = await CompletionsAPI.getSqlCompletions({
        query: 'SELECT a. FROM @cached_ref_3 a',
        cursorOffset: 9,
        context: {
          type: 'sql_editor' as const,
          schemaData: mxfoodSchema,
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
          databaseName: 'mxfood',
          connectionType: 'duckdb',
        },
      });

      expect(Array.isArray(result.suggestions)).toBe(true);
      const labels = result.suggestions.map((s: any) => s.label);
      expect(labels).toContain('month');
      expect(labels).toContain('total');
    });
  });

  // -------------------------------------------------------------------------
  // Error handling / edge cases
  // -------------------------------------------------------------------------

  describe('Error handling', () => {
    test('handles empty resolved references gracefully', async () => {
      const result = await CompletionsAPI.getSqlCompletions({
        query: 'SELECT * FROM users',
        cursorOffset: 7,
        context: {
          type: 'sql_editor' as const,
          schemaData: mxfoodSchema,
          resolvedReferences: [],
          databaseName: 'mxfood',
          connectionType: 'duckdb',
        },
      });

      const labels = result.suggestions.map((s: any) => s.label);

      expect(labels).toContain('user_id');
      expect(labels).toContain('first_name');
      expect(labels).toContain('email');
    });

    test('handles invalid SQL gracefully — no crash', async () => {
      const result = await CompletionsAPI.getSqlCompletions({
        query: 'SELECT * FRON users',
        cursorOffset: 7,
        context: {
          type: 'sql_editor' as const,
          schemaData: mxfoodSchema,
          resolvedReferences: [],
          databaseName: 'mxfood',
          connectionType: 'duckdb',
        },
      });

      expect(Array.isArray(result.suggestions)).toBe(true);
    });

    test('handles missing schema data — no crash', async () => {
      const result = await CompletionsAPI.getSqlCompletions({
        query: 'SELECT * FROM orders',
        cursorOffset: 7,
        context: {
          type: 'sql_editor' as const,
          schemaData: [],
          resolvedReferences: [],
          databaseName: 'mxfood',
          connectionType: 'duckdb',
        },
      });

      expect(Array.isArray(result.suggestions)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // ORDER BY / GROUP BY regressions
  //
  // Each test exercises a specific cursor-position variant to guard against
  // the needs_column_completion() regex regressions:
  //   - "ORDER BY"  (no trailing space)      → must return columns
  //   - "ORDER BY " (trailing space)         → must return columns
  //   - "GROUP BY"  (no trailing space)      → must return columns
  //   - "GROUP BY col " (col + trailing sp.) → must return columns [was bugged]
  //   - complex aggregation ORDER BY aliases → must include SELECT aliases
  // -------------------------------------------------------------------------

  describe('ORDER BY / GROUP BY regressions', () => {
    // Shared query: weekly orders summary
    const weeklyQuery = [
      'SELECT',
      "  DATE_TRUNC('week', created_at) AS week,",
      '  COUNT(*) AS orders,',
      '  SUM(total) AS revenue',
      'FROM orders',
      "GROUP BY DATE_TRUNC('week', created_at)",
    ].join('\n');

    // Shared query: daily sessions (events)
    const dailySessionsQuery = [
      'SELECT',
      '  DATE(event_timestamp) AS date,',
      '  platform,',
      '  COUNT(DISTINCT session_id) AS total_sessions',
      'FROM events',
      "WHERE event_timestamp >= '2025-12-01'",
    ].join('\n');

    test('ORDER BY (no trailing space) returns columns, not keywords', async () => {
      const query = weeklyQuery + '\nORDER BY';
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

      expect(result.suggestions.length).toBeGreaterThan(0);
      const labels = result.suggestions.map((s: any) => s.label);
      const kinds  = Object.fromEntries(result.suggestions.map((s: any) => [s.label, s.kind]));

      expect(labels).toContain('week');      // SELECT alias
      expect(labels).toContain('orders');    // SELECT alias
      expect(labels).toContain('revenue');   // SELECT alias
      expect(labels).toContain('status');    // base column
      expect(kinds['status']).not.toBe('keyword');
    });

    test('ORDER BY (trailing space) returns columns, not keywords', async () => {
      const query = weeklyQuery + '\nORDER BY ';
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

      expect(result.suggestions.length).toBeGreaterThan(0);
      const labels = result.suggestions.map((s: any) => s.label);

      expect(labels).toContain('week');
      expect(labels).toContain('orders');
      expect(labels).toContain('revenue');
      expect(labels).toContain('status');
    });

    test('GROUP BY (no trailing space) returns columns, not keywords', async () => {
      const query = dailySessionsQuery + '\nGROUP BY';
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

      expect(result.suggestions.length).toBeGreaterThan(0);
      const labels = result.suggestions.map((s: any) => s.label);

      expect(labels).toContain('date');           // SELECT alias
      expect(labels).toContain('total_sessions'); // SELECT alias
      expect(labels).toContain('platform');       // base column + SELECT alias
      expect(labels).toContain('event_id');       // base column
    });

    test('GROUP BY col (trailing space) returns columns — regression: was returning keywords', async () => {
      // Bug: needs_column_completion() matched only up to one token after GROUP BY.
      // "GROUP BY platform " (word + trailing space) fell through to keyword completions.
      const query = dailySessionsQuery + '\nGROUP BY platform ';
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

      expect(result.suggestions.length).toBeGreaterThan(0);
      const labels = result.suggestions.map((s: any) => s.label);
      const kinds  = Object.fromEntries(result.suggestions.map((s: any) => [s.label, s.kind]));

      // Must return column/alias suggestions, not only SQL keywords
      const nonKeyword = labels.filter((l: string) => kinds[l] !== 'keyword');
      expect(nonKeyword.length).toBeGreaterThan(0);

      expect(labels).toContain('date');
      expect(labels).toContain('total_sessions');
      expect(labels).toContain('event_id');
    });

    test('complex aggregation ORDER BY — SELECT aliases rank before base columns', async () => {
      // question 25 "Daily Sessions" extended with ORDER BY
      const query = dailySessionsQuery + '\nGROUP BY date, platform\nORDER BY d';
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

      expect(result.suggestions.length).toBeGreaterThan(0);
      const labels = result.suggestions.map((s: any) => s.label);
      const kinds  = Object.fromEntries(result.suggestions.map((s: any) => [s.label, s.kind]));

      // SELECT aliases must appear
      expect(labels).toContain('date');
      expect(labels).toContain('platform');
      expect(labels).toContain('total_sessions');

      // Base events columns must appear
      expect(labels).toContain('event_id');
      expect(labels).toContain('event_timestamp');

      // Aliases should sort before base columns (lower sort_text index)
      const aliasIdx   = result.suggestions.findIndex((s: any) => s.label === 'date');
      const columnIdx  = result.suggestions.findIndex((s: any) => s.label === 'event_id');
      expect(aliasIdx).toBeLessThan(columnIdx);
    });
  });

  // -------------------------------------------------------------------------
  // Scope filtering — real mxfood queries
  // -------------------------------------------------------------------------

  describe('Scope filtering — real mxfood queries', () => {
    test('WHERE on FROM orders — only orders columns returned (question 17)', async () => {
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

      expect(labels).toContain('status');
      expect(labels).toContain('total');
      expect(labels).toContain('created_at');
      expect(labels).toContain('order_id');
      expect(labels).toContain('subtotal');

      expect(labels).not.toContain('first_name');    // users
      expect(labels).not.toContain('zone_name');     // zones
      expect(labels).not.toContain('session_id');    // events
      expect(labels).not.toContain('vehicle_type');  // drivers
    });

    test('ORDER BY on FROM orders — base columns and SELECT aliases returned (question 14)', async () => {
      const query = [
        'SELECT',
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

      expect(labels).toContain('status');
      expect(labels).toContain('total');
      expect(labels).toContain('created_at');
      expect(labels).toContain('week');
      expect(labels).toContain('orders');
      expect(labels).toContain('revenue');

      expect(labels).not.toContain('first_name');
      expect(labels).not.toContain('zone_name');
      expect(labels).not.toContain('session_id');
      expect(labels).not.toContain('vehicle_type');
    });

    test('WHERE on 5-table JOIN — all joined tables visible, others excluded (question 15)', async () => {
      const query = [
        'SELECT',
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

      expect(labels).toContain('status');           // orders
      expect(labels).toContain('total');            // orders
      expect(labels).toContain('unit_price');       // order_items
      expect(labels).toContain('quantity');         // order_items
      expect(labels).toContain('total_price');      // order_items
      expect(labels).toContain('price');            // products
      expect(labels).toContain('is_available');     // products
      expect(labels).toContain('subcategory_name'); // product_subcategories
      expect(labels).toContain('category_name');    // product_categories

      expect(labels).not.toContain('first_name');    // users
      expect(labels).not.toContain('zone_name');     // zones
      expect(labels).not.toContain('session_id');    // events
      expect(labels).not.toContain('vehicle_type');  // drivers
    });

    test('GROUP BY on FROM events — events columns and SELECT aliases returned (question 25)', async () => {
      const query = [
        'SELECT',
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

      expect(labels).toContain('event_id');
      expect(labels).toContain('session_id');
      expect(labels).toContain('event_name');
      expect(labels).toContain('event_timestamp');
      expect(labels).toContain('screen_name');
      expect(labels).toContain('properties');
      expect(labels).toContain('date');
      expect(labels).toContain('total_sessions');

      expect(labels).not.toContain('first_name');
      expect(labels).not.toContain('status');
      expect(labels).not.toContain('zone_name');
      expect(labels).not.toContain('vehicle_type');
    });
  });
});
