/**
 * E2E Autocomplete Tests — single source of truth
 *
 * All tests call CompletionsAPI.getSqlCompletions() which routes:
 *   browser → Next.js /api/autocomplete → Python /api/sql-autocomplete
 *
 * Schema is loaded from the seeded tutorial database (atlas_documents.db)
 * rather than hardcoded, so it stays in sync automatically.
 */

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
  setupTestDb(getTestDbPath('autocomplete_e2e'), {
    customInit: async () => {
      // Load schema from the committed fixture (exported from mxfood.duckdb).
      // Update with: python3 -c "import json,sqlite3; ..." > test/fixtures/mxfood-connection.json
      const fixture = await import('@/test/fixtures/mxfood-connection.json');
      mxfoodSchema = [{
        databaseName: fixture.name,
        schemas: fixture.schema?.schemas ?? [],
        updated_at: fixture.schema?.updated_at,
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
  // Clause / operator completion sweep
  //
  // One parametric test walks every meaningful cursor position through a single
  // full query: SELECT → WHERE → WHERE col → LIKE → GROUP BY → GROUP BY col →
  // ORDER BY → ORDER BY col.  For each position we assert:
  //   - mustContain: columns / aliases that MUST appear (wrong if absent)
  //   - mustNotContain: columns from unrelated tables (wrong if present)
  //   - mustBeNonEmpty: suggestions array must not be empty
  //
  // Regressions covered:
  //   "WHERE col "    → was returning []  (pattern only handled one token after WHERE)
  //   "WHERE col LIKE " → was returning []  (no LIKE pattern)
  //   "GROUP BY col " → was returning []  (same multi-token issue)
  //   "ORDER BY col " → was returning []  (same)
  //   fallback context → was returning keywords, now returns []
  // -------------------------------------------------------------------------

  describe('Clause completion sweep', () => {
    // Full query that exercises every clause type in one shot.
    const query = [
      'SELECT',
      '  platform,',
      '  status,',
      '  COUNT(*) AS total_orders,',
      '  SUM(total) AS revenue',
      'FROM orders',
      "WHERE status LIKE 'A%'",
      'GROUP BY platform, status ',
      'ORDER BY total_orders DESC',
    ].join('\n');

    // Columns that must appear at every column-context position (in scope = orders table)
    const ordersColumns = ['status', 'platform', 'total', 'order_id', 'created_at'];
    // Aliases defined in SELECT
    const aliases = ['total_orders', 'revenue'];
    // Columns from tables NOT referenced — must never appear
    const outsideColumns = ['event_id', 'first_name', 'zone_name', 'vehicle_type'];

    // Locate cursor by finding exactly where a substring ends in the query
    const after = (marker: string) => {
      const idx = query.indexOf(marker);
      if (idx === -1) throw new Error(`Marker not found in query: "${marker}"`);
      return idx + marker.length;
    };

    const cases: Array<{ desc: string; cursor: number; mustContain: string[]; mustNotContain: string[] }> = [
      {
        desc: 'SELECT + trailing space',
        cursor: after('SELECT\n  '),
        mustContain: ordersColumns,
        mustNotContain: outsideColumns,
      },
      {
        desc: 'WHERE + trailing space',
        cursor: after('WHERE '),
        mustContain: ordersColumns,
        mustNotContain: outsideColumns,
      },
      {
        desc: 'WHERE col + trailing space — regression: was returning []',
        cursor: after('WHERE status '),
        mustContain: ordersColumns,
        mustNotContain: outsideColumns,
      },
      {
        desc: 'WHERE col LIKE + trailing space — regression: was returning []',
        cursor: after("WHERE status LIKE "),
        mustContain: ordersColumns,
        mustNotContain: outsideColumns,
      },
      {
        desc: 'GROUP BY + no trailing space',
        cursor: after('GROUP BY'),
        mustContain: [...ordersColumns, ...aliases],
        mustNotContain: outsideColumns,
      },
      {
        desc: 'GROUP BY + trailing space',
        cursor: after('GROUP BY '),
        mustContain: [...ordersColumns, ...aliases],
        mustNotContain: outsideColumns,
      },
      {
        desc: 'GROUP BY first col, + trailing space (comma)',
        cursor: after('GROUP BY platform, '),
        mustContain: [...ordersColumns, ...aliases],
        mustNotContain: outsideColumns,
      },
      {
        desc: 'GROUP BY last col + trailing space — regression: was returning []',
        cursor: after('GROUP BY platform, status '),
        mustContain: [...ordersColumns, ...aliases],
        mustNotContain: outsideColumns,
      },
      {
        desc: 'ORDER BY + no trailing space',
        cursor: after('ORDER BY'),
        mustContain: [...ordersColumns, ...aliases],
        mustNotContain: outsideColumns,
      },
      {
        desc: 'ORDER BY + trailing space',
        cursor: after('ORDER BY '),
        mustContain: [...ordersColumns, ...aliases],
        mustNotContain: outsideColumns,
      },
      {
        desc: 'ORDER BY col + trailing space — regression: was returning []',
        cursor: after('ORDER BY total_orders '),
        mustContain: [...ordersColumns, ...aliases],
        mustNotContain: outsideColumns,
      },
      {
        desc: 'aliases rank before base columns in ORDER BY',
        cursor: after('ORDER BY '),
        mustContain: ['total_orders', 'revenue'],    // aliases first by sort_text
        mustNotContain: outsideColumns,
        // validated separately below via sort order check
      },
    ];

    test.each(cases)('$desc', async ({ cursor, mustContain, mustNotContain }) => {
      const result = await CompletionsAPI.getSqlCompletions({
        query,
        cursorOffset: cursor,
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

      for (const col of mustContain) {
        expect(labels).toContain(col);
      }
      for (const col of mustNotContain) {
        expect(labels).not.toContain(col);
      }
    });

    test('aliases sort before base columns', async () => {
      const result = await CompletionsAPI.getSqlCompletions({
        query,
        cursorOffset: after('ORDER BY '),
        context: {
          type: 'sql_editor' as const,
          schemaData: mxfoodSchema,
          resolvedReferences: [],
          databaseName: 'mxfood',
          connectionType: 'duckdb',
        },
      });

      const aliasIdx  = result.suggestions.findIndex((s: any) => s.label === 'total_orders');
      const columnIdx = result.suggestions.findIndex((s: any) => s.label === 'order_id');
      expect(aliasIdx).toBeGreaterThan(-1);
      expect(columnIdx).toBeGreaterThan(-1);
      expect(aliasIdx).toBeLessThan(columnIdx);
    });

    test('insert_text has ", " prefix after typed col + trailing space to prevent missing comma', async () => {
      // "ORDER BY total_orders " — cursor after a word + space: next item must be ", col"
      const result = await CompletionsAPI.getSqlCompletions({
        query,
        cursorOffset: after('ORDER BY total_orders '),
        context: {
          type: 'sql_editor' as const,
          schemaData: mxfoodSchema,
          resolvedReferences: [],
          databaseName: 'mxfood',
          connectionType: 'duckdb',
        },
      });

      expect(result.suggestions.length).toBeGreaterThan(0);
      // Every insert_text must start with ', ' so Monaco can delete the trailing space
      // and produce "…total_orders, revenue" instead of "…total_orders revenue".
      for (const s of result.suggestions) {
        expect((s as any).insert_text).toMatch(/^, /);
      }
    });

    test('insert_text has NO ", " prefix when cursor is right after keyword (first item in list)', async () => {
      // "ORDER BY " — cursor right after keyword + space: first item, no comma needed
      const result = await CompletionsAPI.getSqlCompletions({
        query,
        cursorOffset: after('ORDER BY '),
        context: {
          type: 'sql_editor' as const,
          schemaData: mxfoodSchema,
          resolvedReferences: [],
          databaseName: 'mxfood',
          connectionType: 'duckdb',
        },
      });

      expect(result.suggestions.length).toBeGreaterThan(0);
      for (const s of result.suggestions) {
        expect((s as any).insert_text).not.toMatch(/^, /);
      }
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

  // -------------------------------------------------------------------------
  // Backward truncation sweep
  //
  // Strategy: one complete mxfood query; each test case truncates it right
  // after a clause keyword/column/operator so the cursor is always at the END
  // of the shorter string — exactly what the editor sends when the user pauses
  // mid-clause.
  //
  // Regressions covered:
  //   "ORDER BY col ASC, "   → was returning []
  //   "GROUP BY col, col "   → was returning [] (multi-token fix)
  //   "WHERE col "           → was returning []
  //   "WHERE col LIKE "      → was returning []
  //   "WHERE … OR "          → was returning [] (OR pattern added)
  // -------------------------------------------------------------------------

  describe('Backward truncation sweep', () => {
    const fullQuery = [
      'SELECT',
      '  platform,',
      '  status,',
      '  COUNT(*) AS total_orders,',
      '  SUM(total) AS revenue',
      'FROM orders',
      "WHERE status LIKE 'A%' OR platform = 'web'",
      'GROUP BY platform, status',
      'ORDER BY total_orders DESC, revenue ASC',
    ].join('\n');

    // Truncate fullQuery right AFTER `marker` (plus optional `append`).
    // Cursor is always at the very end of the resulting string.
    const truncateAfter = (marker: string, append = ''): { query: string; cursor: number } => {
      const idx = fullQuery.indexOf(marker);
      if (idx === -1) throw new Error(`Marker not found in fullQuery: "${marker}"`);
      const q = fullQuery.substring(0, idx + marker.length) + append;
      return { query: q, cursor: q.length };
    };

    const baseCols  = ['status', 'platform', 'total', 'order_id', 'created_at'];
    const aliases   = ['total_orders', 'revenue'];

    const cases: Array<{ desc: string; query: string; cursor: number; mustContain: string[] }> = [
      // --- ORDER BY (walk backward through columns) ---
      { desc: 'ORDER BY + trailing space',
        ...truncateAfter('ORDER BY '),
        mustContain: [...baseCols, ...aliases] },
      { desc: 'ORDER BY first col + trailing space',
        ...truncateAfter('ORDER BY total_orders '),
        mustContain: [...baseCols, ...aliases] },
      { desc: 'ORDER BY first col DESC, + trailing space — regression',
        ...truncateAfter('ORDER BY total_orders DESC, '),
        mustContain: [...baseCols, ...aliases] },

      // --- GROUP BY ---
      { desc: 'GROUP BY + trailing space',
        ...truncateAfter('GROUP BY '),
        mustContain: [...baseCols, ...aliases] },
      { desc: 'GROUP BY first col, + trailing space',
        ...truncateAfter('GROUP BY platform, '),
        mustContain: [...baseCols, ...aliases] },
      { desc: 'GROUP BY last col + trailing space — regression',
        ...truncateAfter('GROUP BY platform, status', ' '),
        mustContain: [...baseCols, ...aliases] },

      // --- WHERE ---
      { desc: 'WHERE + trailing space',
        ...truncateAfter('WHERE '),
        mustContain: baseCols },
      { desc: 'WHERE col + trailing space — regression',
        ...truncateAfter('WHERE status '),
        mustContain: baseCols },
      { desc: 'WHERE col LIKE + trailing space — regression',
        ...truncateAfter("WHERE status LIKE "),
        mustContain: baseCols },
      { desc: "WHERE col LIKE 'val' OR + trailing space — regression",
        ...truncateAfter("WHERE status LIKE 'A%' OR "),
        mustContain: baseCols },
    ];

    test.each(cases)('$desc', async ({ query, cursor, mustContain }) => {
      const result = await CompletionsAPI.getSqlCompletions({
        query,
        cursorOffset: cursor,
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
      for (const col of mustContain) {
        expect(labels).toContain(col);
      }
    });
  });
});
