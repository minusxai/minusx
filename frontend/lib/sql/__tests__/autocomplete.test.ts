/**
 * Tests for getCompletionsLocal (polyglot WASM).
 * Ported from app/api/autocomplete/__tests__/autocomplete.test.ts E2E tests.
 * Tests the core completion logic directly — no HTTP, no reference resolution.
 */
import { getCompletionsLocal, type CompletionItem } from '../autocomplete';
import type { DatabaseWithSchema } from '@/lib/types';

// ---------------------------------------------------------------------------
// Schema fixture (loaded from mxfood-connection.json)
// ---------------------------------------------------------------------------

let mxfoodSchema: DatabaseWithSchema[];

beforeAll(async () => {
  const fixture = await import('@/test/fixtures/mxfood-connection.json');
  mxfoodSchema = [{
    databaseName: fixture.name,
    schemas: fixture.schema?.schemas ?? [],
  }];
});

// Helper: get suggestion labels
const labels = (items: CompletionItem[]) => items.map(s => s.label);

// ---------------------------------------------------------------------------
// Context detection — column, table, dot
// ---------------------------------------------------------------------------

describe('Column context completion', () => {
  it('SELECT + trailing space → columns from in-scope tables', async () => {
    const result = await getCompletionsLocal(
      'SELECT * FROM orders\nWHERE ',
      'SELECT * FROM orders\nWHERE '.length,
      mxfoodSchema,
      'duckdb',
    );
    const l = labels(result);
    expect(l).toContain('status');
    expect(l).toContain('total');
    expect(l).toContain('created_at');
    expect(l).not.toContain('first_name');    // users
    expect(l).not.toContain('zone_name');     // zones
  });

  it('ORDER BY → includes aliases and base columns', async () => {
    const query = [
      'SELECT',
      "  DATE_TRUNC('week', created_at) as week,",
      '  COUNT(*) as orders,',
      '  SUM(total) as revenue',
      'FROM orders',
      "GROUP BY DATE_TRUNC('week', created_at)",
      'ORDER BY ',
    ].join('\n');

    const result = await getCompletionsLocal(query, query.length, mxfoodSchema, 'duckdb');
    const l = labels(result);
    expect(l).toContain('week');
    expect(l).toContain('orders');
    expect(l).toContain('revenue');
    expect(l).toContain('status');
    expect(l).toContain('total');
    expect(l).not.toContain('first_name');
  });

  it('GROUP BY → includes aliases and base columns, excludes out-of-scope', async () => {
    const query = [
      'SELECT',
      '  DATE(event_timestamp) as date,',
      '  platform,',
      '  COUNT(DISTINCT session_id) as total_sessions',
      'FROM events',
      "WHERE event_timestamp >= '2025-12-01'",
      'GROUP BY ',
    ].join('\n');

    const result = await getCompletionsLocal(query, query.length, mxfoodSchema, 'duckdb');
    const l = labels(result);
    expect(l).toContain('event_id');
    expect(l).toContain('session_id');
    expect(l).toContain('date');
    expect(l).toContain('total_sessions');
    expect(l).not.toContain('first_name');
    expect(l).not.toContain('status');
  });

  it('WHERE on 5-table JOIN — all joined tables visible', async () => {
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

    const result = await getCompletionsLocal(query, query.length, mxfoodSchema, 'duckdb');
    const l = labels(result);
    expect(l).toContain('status');           // orders
    expect(l).toContain('unit_price');       // order_items
    expect(l).toContain('price');            // products
    expect(l).toContain('subcategory_name'); // product_subcategories
    expect(l).toContain('category_name');    // product_categories
    expect(l).not.toContain('first_name');   // users
    expect(l).not.toContain('zone_name');    // zones
  });
});

describe('Table context completion', () => {
  it('FROM → suggests tables and schemas', async () => {
    const result = await getCompletionsLocal(
      'SELECT * FROM ',
      'SELECT * FROM '.length,
      mxfoodSchema,
      'duckdb',
    );
    const l = labels(result);
    expect(l).toContain('orders');
    expect(l).toContain('users');
    expect(l).toContain('events');
    expect(l).toContain('main'); // schema name
  });

  it('JOIN → suggests tables', async () => {
    const result = await getCompletionsLocal(
      'SELECT * FROM orders JOIN ',
      'SELECT * FROM orders JOIN '.length,
      mxfoodSchema,
      'duckdb',
    );
    const l = labels(result);
    expect(l).toContain('users');
    expect(l).toContain('order_items');
  });
});

describe('Dot notation completion', () => {
  it('schema.table → tables in schema', async () => {
    const query = 'SELECT * FROM main.';
    const result = await getCompletionsLocal(query, query.length, mxfoodSchema, 'duckdb');
    const l = labels(result);
    expect(l).toContain('orders');
    expect(l).toContain('users');
  });

  it('alias.column → columns from aliased table', async () => {
    const query = 'SELECT o. FROM orders o';
    const cursor = 'SELECT o.'.length;
    const result = await getCompletionsLocal(query, cursor, mxfoodSchema, 'duckdb');
    const l = labels(result);
    expect(l).toContain('status');
    expect(l).toContain('total');
    expect(l).toContain('order_id');
    expect(l).not.toContain('first_name');
  });
});

// ---------------------------------------------------------------------------
// Aliases sort before base columns
// ---------------------------------------------------------------------------

describe('Alias sorting', () => {
  it('aliases sort before base columns in ORDER BY', async () => {
    const query = [
      'SELECT',
      '  platform,',
      '  status,',
      '  COUNT(*) AS total_orders,',
      '  SUM(total) AS revenue',
      'FROM orders',
      "WHERE status LIKE 'A%'",
      'GROUP BY platform, status ',
      'ORDER BY ',
    ].join('\n');

    const result = await getCompletionsLocal(query, query.length, mxfoodSchema, 'duckdb');
    const aliasIdx  = result.findIndex(s => s.label === 'total_orders');
    const columnIdx = result.findIndex(s => s.label === 'order_id');
    expect(aliasIdx).toBeGreaterThan(-1);
    expect(columnIdx).toBeGreaterThan(-1);
    expect(aliasIdx).toBeLessThan(columnIdx);
  });
});

// ---------------------------------------------------------------------------
// Comma prefix logic
// ---------------------------------------------------------------------------

describe('Comma prefix', () => {
  it('insert_text has ", " prefix after typed col + trailing space', async () => {
    const query = [
      'SELECT',
      '  platform,',
      '  status,',
      '  COUNT(*) AS total_orders,',
      '  SUM(total) AS revenue',
      'FROM orders',
      "WHERE status LIKE 'A%'",
      'GROUP BY platform, status ',
      'ORDER BY total_orders ',
    ].join('\n');

    const result = await getCompletionsLocal(query, query.length, mxfoodSchema, 'duckdb');
    expect(result.length).toBeGreaterThan(0);
    for (const s of result) {
      expect(s.insert_text).toMatch(/^, /);
    }
  });

  it('insert_text has NO ", " prefix right after keyword', async () => {
    const query = [
      'SELECT',
      '  platform,',
      '  status,',
      '  COUNT(*) AS total_orders,',
      '  SUM(total) AS revenue',
      'FROM orders',
      "WHERE status LIKE 'A%'",
      'GROUP BY platform, status ',
      'ORDER BY ',
    ].join('\n');

    const result = await getCompletionsLocal(query, query.length, mxfoodSchema, 'duckdb');
    expect(result.length).toBeGreaterThan(0);
    for (const s of result) {
      expect(s.insert_text).not.toMatch(/^, /);
    }
  });
});

// ---------------------------------------------------------------------------
// CTE completion
// ---------------------------------------------------------------------------

describe('CTE completion', () => {
  it('suggests CTE columns in column context', async () => {
    const query = [
      'WITH revenue AS (',
      '  SELECT user_id, SUM(total) AS total_revenue FROM orders GROUP BY user_id',
      ')',
      'SELECT ',
    ].join('\n');

    const result = await getCompletionsLocal(query, query.length, mxfoodSchema, 'duckdb');
    const l = labels(result);
    expect(l).toContain('user_id');
    expect(l).toContain('total_revenue');
  });

  it('suggests CTE names in table context', async () => {
    const query = [
      'WITH revenue AS (',
      '  SELECT user_id, SUM(total) AS total_revenue FROM orders GROUP BY user_id',
      ')',
      'SELECT * FROM ',
    ].join('\n');

    const result = await getCompletionsLocal(query, query.length, mxfoodSchema, 'duckdb');
    const l = labels(result);
    expect(l).toContain('revenue');
  });

  it('CTE dot notation → CTE columns', async () => {
    const query = [
      'WITH revenue AS (',
      '  SELECT user_id, SUM(total) AS total_revenue FROM orders GROUP BY user_id',
      ')',
      'SELECT revenue.',
    ].join('\n');

    const result = await getCompletionsLocal(query, query.length, mxfoodSchema, 'duckdb');
    const l = labels(result);
    expect(l).toContain('user_id');
    expect(l).toContain('total_revenue');
  });
});

// ---------------------------------------------------------------------------
// Error handling / edge cases
// ---------------------------------------------------------------------------

describe('Error handling', () => {
  it('handles empty schema data — no crash', async () => {
    const result = await getCompletionsLocal(
      'SELECT * FROM orders WHERE ',
      'SELECT * FROM orders WHERE '.length,
      [],
      'duckdb',
    );
    expect(Array.isArray(result)).toBe(true);
  });

  it('handles invalid SQL — no crash', async () => {
    const result = await getCompletionsLocal(
      'SELECT * FRON orders WHERE ',
      'SELECT * FRON orders WHERE '.length,
      mxfoodSchema,
      'duckdb',
    );
    expect(Array.isArray(result)).toBe(true);
  });

  it('returns empty for @ reference (frontend handles these)', async () => {
    const result = await getCompletionsLocal(
      'SELECT * FROM @',
      'SELECT * FROM @'.length,
      mxfoodSchema,
      'duckdb',
    );
    expect(result).toEqual([]);
  });

  it('empty query returns empty', async () => {
    const result = await getCompletionsLocal('', 0, mxfoodSchema, 'duckdb');
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Backward truncation sweep
// ---------------------------------------------------------------------------

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

  const truncateAfter = (marker: string, append = ''): { query: string; cursor: number } => {
    const idx = fullQuery.indexOf(marker);
    if (idx === -1) throw new Error(`Marker not found: "${marker}"`);
    const q = fullQuery.substring(0, idx + marker.length) + append;
    return { query: q, cursor: q.length };
  };

  const baseCols  = ['status', 'platform', 'total', 'order_id', 'created_at'];
  const aliases   = ['total_orders', 'revenue'];

  const cases: Array<{ desc: string; query: string; cursor: number; mustContain: string[] }> = [
    { desc: 'ORDER BY + trailing space',
      ...truncateAfter('ORDER BY '),
      mustContain: [...baseCols, ...aliases] },
    { desc: 'ORDER BY first col + trailing space',
      ...truncateAfter('ORDER BY total_orders '),
      mustContain: [...baseCols, ...aliases] },
    { desc: 'ORDER BY first col DESC, + trailing space',
      ...truncateAfter('ORDER BY total_orders DESC, '),
      mustContain: [...baseCols, ...aliases] },
    { desc: 'GROUP BY + trailing space',
      ...truncateAfter('GROUP BY '),
      mustContain: [...baseCols, ...aliases] },
    { desc: 'GROUP BY first col, + trailing space',
      ...truncateAfter('GROUP BY platform, '),
      mustContain: [...baseCols, ...aliases] },
    { desc: 'GROUP BY last col + trailing space',
      ...truncateAfter('GROUP BY platform, status', ' '),
      mustContain: [...baseCols, ...aliases] },
    { desc: 'WHERE + trailing space',
      ...truncateAfter('WHERE '),
      mustContain: baseCols },
    { desc: 'WHERE col + trailing space',
      ...truncateAfter('WHERE status '),
      mustContain: baseCols },
    { desc: 'WHERE col LIKE + trailing space',
      ...truncateAfter("WHERE status LIKE "),
      mustContain: baseCols },
    { desc: "WHERE col LIKE 'val' OR + trailing space",
      ...truncateAfter("WHERE status LIKE 'A%' OR "),
      mustContain: baseCols },
  ];

  test.each(cases)('$desc', async ({ query, cursor, mustContain }) => {
    const result = await getCompletionsLocal(query, cursor, mxfoodSchema, 'duckdb');
    expect(result.length).toBeGreaterThan(0);
    const l = labels(result);
    for (const col of mustContain) {
      expect(l).toContain(col);
    }
  });
});
