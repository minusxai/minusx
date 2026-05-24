import { getCompletionsLocal, type CompletionItem } from '../autocomplete';
import type { DatabaseWithSchema } from '@/lib/types';
import { inferColumnsLocal } from '../infer-columns';
import { parseSqlToIrLocal } from '../sql-to-ir';
import { irToSqlLocal } from '../ir-to-sql';
import { QueryIR, FilterCondition, type CompoundQueryIR } from '../ir-types';
import { removeNoneParamConditions } from '../ir-transforms';
import { enforceQueryLimit } from '../limit-enforcer';
import { getMentionCompletionsLocal, type AvailableQuestion } from '../mention-completions';
import { filterSchemaByWhitelist } from '../schema-filter';
import type { DatabaseSchema, WhitelistItem } from '../../types';
import { extractParametersFromSQL } from '../sql-params';
import { validateQueryTablesLocal, validateQueryTables, type WhitelistEntry } from '../validate-query-tables';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import { validateSqlLocal } from '../validate-sql';


// ─── autocomplete.test.ts ───


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

// ---------------------------------------------------------------------------
// Param dialect compat
// ---------------------------------------------------------------------------

describe('Param dialect compatibility', () => {
  const substituteParams = (query: string, params: Record<string, string>) => {
    let result = query;
    for (const [name, value] of Object.entries(params)) {
      result = result.replace(new RegExp(`:${name}\\b`, 'g'), value);
    }
    return result;
  };

  const TEXT_VALUE = "'active'";
  const DATE_VALUE = "'2024-01-01'";
  const NUMBER_VALUE = '100';

  const dialects = ['duckdb', 'postgres', 'bigquery'] as const;

  describe('full query with all param types', () => {
    const queries: Record<string, { sql: string; params: Record<string, string> }> = {
      duckdb: {
        sql: `SELECT DATE_TRUNC('month', created_at) AS month, status, COUNT(*) AS total_orders, SUM(amount) AS revenue
              FROM orders WHERE status = :status AND created_at >= :start_date AND amount > :min_amount
              GROUP BY 1, 2 ORDER BY month DESC LIMIT 500`,
        params: { status: TEXT_VALUE, start_date: DATE_VALUE, min_amount: NUMBER_VALUE },
      },
      postgres: {
        sql: `SELECT DATE_TRUNC('week', created_at) AS week, region, COUNT(DISTINCT user_id) AS unique_users, SUM(spend) AS total_spend
              FROM transactions WHERE region = :region AND created_at >= :start_date AND spend > :min_spend
              GROUP BY 1, 2 ORDER BY week DESC LIMIT 500`,
        params: { region: TEXT_VALUE, start_date: DATE_VALUE, min_spend: NUMBER_VALUE },
      },
      bigquery: {
        sql: `SELECT DATE_TRUNC(event_date, MONTH) AS month, country, COUNT(*) AS events, SUM(revenue) AS total_revenue
              FROM events WHERE country = :country AND event_date >= :start_date AND revenue > :min_revenue
              GROUP BY 1, 2 ORDER BY month DESC LIMIT 500`,
        params: { country: TEXT_VALUE, start_date: DATE_VALUE, min_revenue: NUMBER_VALUE },
      },
    };

    for (const dialect of dialects) {
      it(`parses cleanly for ${dialect}`, async () => {
        const { sql, params } = queries[dialect];
        const substituted = substituteParams(sql, params);
        // Just verify it parses without throwing
        const result = await parseSqlToIrLocal(substituted, dialect);
        expect(result).toBeTruthy();
      });
    }
  });

  describe('isolated param types × dialects', () => {
    const paramQueries: Array<{ name: string; sql: string; params: Record<string, string> }> = [
      { name: 'text', sql: "SELECT * FROM orders WHERE status = :status LIMIT 100", params: { status: TEXT_VALUE } },
      { name: 'date-iso-date', sql: "SELECT * FROM orders WHERE created_at >= :start_date LIMIT 100", params: { start_date: DATE_VALUE } },
      { name: 'date-iso-datetime', sql: "SELECT * FROM orders WHERE created_at >= :start_ts LIMIT 100", params: { start_ts: "'2024-01-01T00:00:00'" } },
      { name: 'number', sql: "SELECT * FROM orders WHERE amount > :min_amount LIMIT 100", params: { min_amount: NUMBER_VALUE } },
    ];

    for (const dialect of dialects) {
      for (const { name, sql, params } of paramQueries) {
        it(`${name} valid for ${dialect}`, async () => {
          const substituted = substituteParams(sql, params);
          const result = await parseSqlToIrLocal(substituted, dialect);
          expect(result).toBeTruthy();
        });
      }
    }
  });
});

// ─── infer-columns.test.ts ───


describe('inferColumnsLocal (polyglot WASM)', () => {
  it('infers column names from aggregate SELECT', async () => {
    const result = await inferColumnsLocal(
      'SELECT user_id, SUM(amount) AS total FROM orders GROUP BY user_id',
      [],
      'duckdb',
    );
    const names = result.columns.map((c) => c.name);
    expect(names).toContain('user_id');
    expect(names).toContain('total');
    expect(result.columns).toHaveLength(2);
  });

  it('infers column names from aliased string/function expressions', async () => {
    const result = await inferColumnsLocal(
      'SELECT id, LOWER(name) AS lower_name, created_at FROM users',
      [],
      'duckdb',
    );
    const names = result.columns.map((c) => c.name);
    expect(names).toContain('id');
    expect(names).toContain('lower_name');
    expect(names).toContain('created_at');
  });

  it('infers CAST type annotation', async () => {
    const result = await inferColumnsLocal(
      'SELECT CAST(price AS DECIMAL(10,2)) AS price_decimal FROM products',
      [],
      'duckdb',
    );
    const priceCol = result.columns.find((c) => c.name === 'price_decimal');
    expect(priceCol).toBeDefined();
    expect(priceCol!.type.toLowerCase()).toMatch(/decimal/);
  });

  it('expands SELECT * columns from schema_data', async () => {
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

    const result = await inferColumnsLocal('SELECT * FROM orders', schemaData, 'duckdb');
    const names = result.columns.map((c) => c.name);
    expect(names).toContain('order_id');
    expect(names).toContain('amount');
  });

  it('handles invalid SQL without throwing (graceful degradation)', async () => {
    const result = await inferColumnsLocal('NOT VALID SQL AT ALL !!!', [], 'duckdb');
    expect(Array.isArray(result.columns)).toBe(true);
  });

  it('looks up column type from schema_data for plain column references', async () => {
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

    const result = await inferColumnsLocal('SELECT email FROM users', schemaData, 'duckdb');
    const emailCol = result.columns.find((c) => c.name === 'email');
    expect(emailCol).toBeDefined();
    expect(emailCol!.type).toBe('varchar');
  });

  // --- Additional edge cases ---

  it('handles SELECT with literal values', async () => {
    const result = await inferColumnsLocal(
      "SELECT 42 AS num, 'hello' AS greeting FROM t",
      [],
      'duckdb',
    );
    const numCol = result.columns.find((c) => c.name === 'num');
    const greetCol = result.columns.find((c) => c.name === 'greeting');
    expect(numCol).toBeDefined();
    expect(numCol!.type).toBe('number');
    expect(greetCol).toBeDefined();
    expect(greetCol!.type).toBe('text');
  });

  // Each row: every inferred column must have the same expected type.
  const typeInferenceCases: Array<{ desc: string; sql: string; expectedType: string }> = [
    { desc: 'infers number type for aggregate functions', sql: 'SELECT COUNT(*) AS cnt, AVG(price) AS avg_price, MAX(qty) AS max_qty FROM t', expectedType: 'number' },
    { desc: 'infers text type for string functions', sql: 'SELECT LOWER(name) AS low, UPPER(name) AS up, TRIM(name) AS trimmed FROM t', expectedType: 'text' },
  ];

  it.each(typeInferenceCases)('$desc', async ({ sql, expectedType }) => {
    const result = await inferColumnsLocal(sql, [], 'duckdb');
    for (const col of result.columns) {
      expect(col.type).toBe(expectedType);
    }
  });

  it('returns wildcard placeholder when no schema for SELECT *', async () => {
    const result = await inferColumnsLocal('SELECT * FROM unknown_table', [], 'duckdb');
    expect(result.columns).toHaveLength(1);
    expect(result.columns[0].name).toBe('*');
    expect(result.columns[0].type).toBe('unknown');
  });

  it('empty query returns empty columns', async () => {
    const result = await inferColumnsLocal('', [], 'duckdb');
    expect(result.columns).toEqual([]);
  });

  // Dialect smoke: infers the expected number of columns and the first name.
  const dialectSmokeCases: Array<{ dialect: 'postgres' | 'bigquery'; sql: string; expectedLength: number; firstName: string }> = [
    { dialect: 'postgres', sql: 'SELECT id, name FROM users', expectedLength: 2, firstName: 'id' },
    { dialect: 'bigquery', sql: 'SELECT id FROM `project.dataset.table`', expectedLength: 1, firstName: 'id' },
  ];

  it.each(dialectSmokeCases)('works with $dialect dialect', async ({ dialect, sql, expectedLength, firstName }) => {
    const result = await inferColumnsLocal(sql, [], dialect);
    expect(result.columns).toHaveLength(expectedLength);
    expect(result.columns[0].name).toBe(firstName);
  });
});

// ─── ir-to-sql.test.ts ───


function normalizeSql(sql: string): string {
  return sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').replace(/;$/, '').trim().toUpperCase();
}

describe('IR to SQL generator', () => {
  // Each row: parse SQL → IR → regenerate SQL → assert each normalized substring
  // is present. Same shape across all single-clause round-trip cases.
  const cases: Array<{ desc: string; sql: string; mustContain: string[] }> = [
    { desc: 'simple SELECT *', sql: 'SELECT * FROM users', mustContain: ['SELECT *', 'FROM USERS'] },
    { desc: 'SELECT with columns and alias', sql: 'SELECT name AS user_name, email FROM users', mustContain: ['NAME AS USER_NAME', 'EMAIL'] },
    { desc: 'aggregates round-trip', sql: 'SELECT COUNT(*) AS total, SUM(amount) AS revenue FROM orders', mustContain: ['COUNT(*)', 'SUM(AMOUNT)'] },
    { desc: 'COUNT DISTINCT round-trip', sql: 'SELECT COUNT(DISTINCT email) FROM users', mustContain: ['COUNT(DISTINCT EMAIL)'] },
    { desc: 'JOIN round-trip', sql: 'SELECT u.name, o.amount FROM users u INNER JOIN orders o ON u.id = o.user_id', mustContain: ['JOIN ORDERS O ON', 'U.ID = O.USER_ID'] },
    { desc: 'LEFT JOIN round-trip', sql: 'SELECT * FROM users LEFT JOIN orders ON users.id = orders.user_id', mustContain: ['LEFT JOIN'] },
    { desc: 'WHERE round-trip', sql: 'SELECT * FROM users WHERE active = true AND age > 18', mustContain: ['WHERE', 'ACTIVE', 'AGE'] },
    { desc: 'WHERE with param round-trip', sql: 'SELECT * FROM users WHERE id = :user_id', mustContain: [':USER_ID'] },
    { desc: 'WHERE IS NULL / IS NOT NULL round-trip', sql: 'SELECT * FROM users WHERE deleted_at IS NULL AND email IS NOT NULL', mustContain: ['IS NULL', 'IS NOT NULL'] },
    { desc: 'WHERE IN round-trip', sql: "SELECT * FROM users WHERE status IN ('active', 'pending')", mustContain: ['IN ('] },
    { desc: 'WHERE with expression column (lower) round-trip', sql: "SELECT * FROM restaurants WHERE lower(city) = 'san francisco'", mustContain: ['LOWER', 'SAN FRANCISCO'] },
    { desc: 'GROUP BY round-trip', sql: 'SELECT category, COUNT(*) FROM products GROUP BY category', mustContain: ['GROUP BY CATEGORY'] },
    { desc: 'ORDER BY round-trip', sql: 'SELECT * FROM users ORDER BY name ASC, created_at DESC', mustContain: ['ORDER BY', 'DESC'] },
    { desc: 'LIMIT round-trip', sql: 'SELECT * FROM users LIMIT 10', mustContain: ['LIMIT 10'] },
    {
      desc: 'full query round-trip',
      sql: `
      SELECT u.name, COUNT(*) AS order_count, SUM(o.amount) AS total_amount
      FROM users u
      INNER JOIN orders o ON u.id = o.user_id
      WHERE u.active = true AND o.status = 'completed'
      GROUP BY u.name
      HAVING COUNT(*) > 5
      ORDER BY total_amount DESC
      LIMIT 20
    `,
      mustContain: ['SELECT', 'FROM USERS U', 'JOIN ORDERS O', 'WHERE', 'GROUP BY', 'HAVING', 'ORDER BY', 'LIMIT 20'],
    },
    { desc: 'CTE round-trip', sql: 'WITH active_users AS (SELECT * FROM users WHERE active = TRUE) SELECT * FROM active_users', mustContain: ['WITH ACTIVE_USERS AS', 'FROM ACTIVE_USERS'] },
    { desc: 'schema-qualified table round-trip', sql: 'SELECT * FROM public.users', mustContain: ['PUBLIC.USERS'] },
  ];

  it.each(cases)('$desc', async ({ sql, mustContain }) => {
    const ir = await parseSqlToIrLocal(sql, 'duckdb') as QueryIR;
    const norm = normalizeSql(irToSqlLocal(ir, 'duckdb'));
    for (const substr of mustContain) {
      expect(norm).toContain(substr);
    }
  });
});

// ---------------------------------------------------------------------------
// SQL round-trip
// ---------------------------------------------------------------------------

describe('SQL round-trip (E2E)', () => {
  it('simple select with WHERE and LIMIT', async () => {
    const original = 'SELECT name, email FROM users WHERE active = true LIMIT 10';
    const ir = await parseSqlToIrLocal(original, 'duckdb') as QueryIR;
    const sql = irToSqlLocal(ir, 'duckdb');
    const norm = normalizeSql(sql);
    expect(norm).toContain('SELECT');
    expect(norm).toContain('NAME');
    expect(norm).toContain('EMAIL');
    expect(norm).toContain('FROM USERS');
    expect(norm).toContain('WHERE');
    expect(norm).toContain('ACTIVE');
    expect(norm).toContain('LIMIT 10');
  });

  it('ILIKE literal round-trip', async () => {
    const sql = "SELECT name FROM users WHERE email ILIKE '%example%'";
    const ir = await parseSqlToIrLocal(sql, 'duckdb') as QueryIR;
    expect((ir.where!.conditions[0] as any).operator).toBe('ILIKE');
    const out = irToSqlLocal(ir, 'duckdb');
    expect(out.toUpperCase()).toContain('ILIKE');
    expect(out).toContain('example');
  });

  it('ILIKE param round-trip', async () => {
    const sql = 'SELECT name FROM users WHERE email ILIKE :search';
    const ir = await parseSqlToIrLocal(sql, 'duckdb') as QueryIR;
    const cond = ir.where!.conditions[0] as any;
    expect(cond.operator).toBe('ILIKE');
    expect(cond.param_name).toBe('search');
    const out = irToSqlLocal(ir, 'duckdb');
    expect(out).toContain(':search');
    expect(out.toUpperCase()).toContain('ILIKE');
  });

  it('JOIN with aggregates round-trip', async () => {
    const original = `
      SELECT u.name, COUNT(*) AS order_count, SUM(o.amount) AS total_amount
      FROM users u
      INNER JOIN orders o ON u.id = o.user_id
      WHERE u.active = true
      GROUP BY u.name
      ORDER BY total_amount DESC
      LIMIT 20
    `;
    const ir = await parseSqlToIrLocal(original, 'duckdb') as QueryIR;
    expect(ir.select).toHaveLength(3);
    expect(ir.select[0].column).toBe('name');
    expect(ir.select[0].table).toBe('u');
    expect(ir.select[1].type).toBe('aggregate');
    expect(ir.select[1].aggregate).toBe('COUNT');
    expect(ir.select[2].type).toBe('aggregate');
    expect(ir.select[2].aggregate).toBe('SUM');

    const sql = irToSqlLocal(ir, 'duckdb');
    const norm = normalizeSql(sql);
    expect(norm).toContain('U.NAME');
    expect(norm).toContain('COUNT(*)');
    expect(norm).toContain('SUM(O.AMOUNT)');
    expect(norm).toContain('FROM USERS U');
    expect(norm).toContain('JOIN ORDERS O');
    expect(norm).toContain('U.ID = O.USER_ID');
    expect(norm).toContain('U.ACTIVE');
    expect(norm).toContain('GROUP BY U.NAME');
    expect(norm).toContain('ORDER BY TOTAL_AMOUNT DESC');
    expect(norm).toContain('LIMIT 20');
  });

  it('complex filters with parameters', async () => {
    const original = `
      SELECT p.name, p.category, p.price
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.active = true
        AND p.price >= :min_price
        AND p.price <= :max_price
        AND c.name IN ('Electronics', 'Computers')
      ORDER BY p.price ASC, p.name ASC
    `;
    const ir = await parseSqlToIrLocal(original, 'duckdb') as QueryIR;
    expect(ir.joins).not.toBeNull();
    expect(ir.joins![0].type).toBe('LEFT');
    expect(ir.where).not.toBeNull();
    expect(ir.where!.operator).toBe('AND');
    expect(ir.where!.conditions.length).toBeGreaterThanOrEqual(3);

    const paramConds = ir.where!.conditions.filter((c: any) => c.param_name);
    expect(paramConds.length).toBeGreaterThanOrEqual(2);
    const paramNames = new Set(paramConds.map((c: any) => c.param_name));
    expect(paramNames).toContain('min_price');
    expect(paramNames).toContain('max_price');

    const sql = irToSqlLocal(ir, 'duckdb');
    const norm = normalizeSql(sql);
    expect(norm).toContain('LEFT JOIN CATEGORIES C');
    expect(norm).toContain(':MIN_PRICE');
    expect(norm).toContain(':MAX_PRICE');
    expect(norm).toContain('IN (');
  });
});

// ---------------------------------------------------------------------------
// Semantic equivalence
// ---------------------------------------------------------------------------

describe('Semantic equivalence', () => {
  it('COUNT(DISTINCT) preserved', async () => {
    const sql = 'SELECT category, COUNT(DISTINCT user_id) AS unique_users FROM orders GROUP BY category';
    const ir = await parseSqlToIrLocal(sql, 'duckdb') as QueryIR;
    const generated = irToSqlLocal(ir, 'duckdb');
    expect(generated).toContain('COUNT(DISTINCT user_id)');
    expect(generated.toUpperCase()).toContain('GROUP BY CATEGORY');
  });

  it('table aliases preserved', async () => {
    const sql = `
      SELECT u.id, u.name, o.amount
      FROM users u
      INNER JOIN orders o ON u.id = o.user_id
      WHERE u.active = true
    `;
    const ir = await parseSqlToIrLocal(sql, 'duckdb') as QueryIR;
    const generated = irToSqlLocal(ir, 'duckdb');
    expect(generated).toContain('users u');
    expect(generated).toContain('orders o');
    expect(generated).toContain('u.id');
    expect(generated).toContain('o.amount');
  });

  it('IS NULL / IS NOT NULL preserved', async () => {
    const sql = 'SELECT * FROM users WHERE deleted_at IS NULL AND email IS NOT NULL';
    const ir = await parseSqlToIrLocal(sql, 'duckdb') as QueryIR;
    const generated = irToSqlLocal(ir, 'duckdb');
    expect(generated).toContain('IS NULL');
    expect(generated).toContain('IS NOT NULL');
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('E2E edge cases', () => {
  it('SELECT * round-trip', async () => {
    const ir = await parseSqlToIrLocal('SELECT * FROM users', 'duckdb') as QueryIR;
    const generated = irToSqlLocal(ir, 'duckdb');
    expect(generated).toContain('SELECT *');
    expect(generated).toContain('FROM users');
  });

  it('no WHERE clause', async () => {
    const sql = 'SELECT name, email FROM users ORDER BY name';
    const ir = await parseSqlToIrLocal(sql, 'duckdb') as QueryIR;
    const generated = irToSqlLocal(ir, 'duckdb');
    expect(generated).not.toContain('WHERE');
    expect(generated.toUpperCase()).toContain('ORDER BY NAME');
  });

  it('schema-qualified tables', async () => {
    const ir = await parseSqlToIrLocal('SELECT * FROM public.users', 'duckdb') as QueryIR;
    const generated = irToSqlLocal(ir, 'duckdb');
    expect(generated).toContain('public.users');
  });
});

// ---------------------------------------------------------------------------
// Date-trunc filters
// ---------------------------------------------------------------------------

describe('DATE_TRUNC filters', () => {
  it('DATE_TRUNC in WHERE + positional GROUP BY/ORDER BY (bigquery)', async () => {
    const sql = `
      SELECT
        DATE_TRUNC(created_at, MONTH) AS month,
        COUNT(DISTINCT conv_id) AS unique_conversations
      FROM analytics.processed_requests_with_sub
      WHERE DATE_TRUNC(created_at, MONTH) < TIMESTAMP_TRUNC(CURRENT_TIMESTAMP(), MONTH)
      GROUP BY 1
      ORDER BY 1
    `;
    const ir = await parseSqlToIrLocal(sql, 'bigquery') as QueryIR;

    // SELECT
    expect(ir.select).toHaveLength(2);
    expect(ir.select[0].type).toBe('expression');
    expect(ir.select[0].function).toBe('DATE_TRUNC');
    expect(ir.select[0].unit).toBe('MONTH');
    expect(ir.select[1].type).toBe('aggregate');
    expect(ir.select[1].aggregate).toBe('COUNT_DISTINCT');

    // WHERE: DATE_TRUNC filter
    expect(ir.where).not.toBeNull();
    const dtConds = ir.where!.conditions.filter((c: any) => c.function === 'DATE_TRUNC');
    expect(dtConds).toHaveLength(1);
    expect((dtConds[0] as any).operator).toBe('<');
    expect((dtConds[0] as any).raw_value).not.toBeNull();

    // GROUP BY: resolved from positional reference
    expect(ir.group_by).not.toBeNull();
    expect(ir.group_by!.columns).toHaveLength(1);
    expect(ir.group_by!.columns[0].type).toBe('expression');
    expect(ir.group_by!.columns[0].function).toBe('DATE_TRUNC');

    // ORDER BY: resolved from positional reference
    expect(ir.order_by).not.toBeNull();
    expect(ir.order_by!).toHaveLength(1);
    expect(ir.order_by![0].type).toBe('expression');
    expect(ir.order_by![0].function).toBe('DATE_TRUNC');

    // Round-trip
    const generated = irToSqlLocal(ir, 'bigquery');
    const norm = normalizeSql(generated);
    expect(norm).toContain('DATE_TRUNC(');
    expect(norm).toContain('COUNT(DISTINCT CONV_ID)');
    expect(norm).toContain('WHERE');
    expect(norm).toContain('GROUP BY');
    expect(norm).toContain('ORDER BY');
  });

  it('DATE_TRUNC filter combined with string equality', async () => {
    const sql = `
      SELECT
        DATE_TRUNC(created_at, MONTH) AS month,
        COUNT(*) AS user_questions
      FROM analytics.processed_requests_with_sub
      WHERE last_message_role = 'user'
        AND DATE_TRUNC(created_at, MONTH) < TIMESTAMP_TRUNC(CURRENT_TIMESTAMP(), MONTH)
      GROUP BY 1
      ORDER BY 1
    `;
    const ir = await parseSqlToIrLocal(sql, 'bigquery') as QueryIR;

    expect(ir.where).not.toBeNull();
    expect(ir.where!.operator).toBe('AND');
    expect(ir.where!.conditions.length).toBeGreaterThanOrEqual(2);

    const stringConds = ir.where!.conditions.filter((c: any) => c.column === 'last_message_role');
    expect(stringConds).toHaveLength(1);
    expect((stringConds[0] as any).value).toBe('user');

    const dtConds = ir.where!.conditions.filter((c: any) => c.function === 'DATE_TRUNC');
    expect(dtConds).toHaveLength(1);

    expect(ir.group_by).not.toBeNull();
    expect(ir.order_by).not.toBeNull();

    const generated = irToSqlLocal(ir, 'bigquery');
    const norm = normalizeSql(generated);
    expect(norm).toContain('LAST_MESSAGE_ROLE');
    expect(norm).toContain('DATE_TRUNC(');
    expect(norm).toContain('WHERE');
    expect(norm).toContain('GROUP BY');
  });

  it('CURRENT_TIMESTAMP in OR filter (duckdb)', async () => {
    const sql = `
      SELECT
        plan_type,
        COUNT(DISTINCT email_id) AS users
      FROM analytics.all_subscriptions
      WHERE subscription_end IS NULL OR subscription_end > CURRENT_TIMESTAMP
      GROUP BY 1
      ORDER BY 2 DESC
    `;
    const ir = await parseSqlToIrLocal(sql, 'duckdb') as QueryIR;

    expect(ir.where).not.toBeNull();
    expect(ir.where!.operator).toBe('OR');
    expect(ir.where!.conditions).toHaveLength(2);

    const nullConds = ir.where!.conditions.filter((c: any) => c.operator === 'IS NULL');
    expect(nullConds).toHaveLength(1);

    const gtConds = ir.where!.conditions.filter((c: any) => c.operator === '>');
    expect(gtConds).toHaveLength(1);
    expect((gtConds[0] as any).raw_value).not.toBeNull();
    expect((gtConds[0] as any).raw_value.toUpperCase()).toContain('CURRENT_TIMESTAMP');

    expect(ir.group_by).not.toBeNull();
    expect(ir.group_by!.columns).toHaveLength(1);
    expect(ir.group_by!.columns[0].column).toBe('plan_type');

    expect(ir.order_by).not.toBeNull();
    expect(ir.order_by![0].direction).toBe('DESC');

    const generated = irToSqlLocal(ir, 'duckdb');
    const norm = normalizeSql(generated);
    expect(norm).toContain('IS NULL');
    expect(norm).toContain('CURRENT_TIMESTAMP');
    expect(norm).toContain('GROUP BY PLAN_TYPE');
  });
});

// ---------------------------------------------------------------------------
// Complex expressions
// ---------------------------------------------------------------------------

describe('Complex expressions (raw passthrough)', () => {
  it('DATE_TRUNC with STRPTIME and literals', async () => {
    const sql = `SELECT
    DATE_TRUNC('month', STRPTIME(acquisition_date, '%B %-d, %Y')) AS month,
    COUNT(*) AS value,
    'New Customers' AS label,
    NULL AS category
  FROM new_customers
  GROUP BY 1`;

    const ir = await parseSqlToIrLocal(sql, 'duckdb') as QueryIR;

    expect(ir.select).toHaveLength(4);
    // DATE_TRUNC(STRPTIME(...)) → raw passthrough
    expect(ir.select[0].type).toBe('raw');
    expect(ir.select[0].raw_sql!.toUpperCase()).toContain('STRPTIME');
    expect(ir.select[0].alias).toBe('month');
    // COUNT(*)
    expect(ir.select[1].type).toBe('aggregate');
    expect(ir.select[1].aggregate).toBe('COUNT');
    // String literal
    expect(ir.select[2].type).toBe('raw');
    expect(ir.select[2].alias).toBe('label');
    // NULL literal
    expect(ir.select[3].type).toBe('raw');
    expect(ir.select[3].alias).toBe('category');

    // GROUP BY resolved from positional reference
    expect(ir.group_by).not.toBeNull();
    expect(ir.group_by!.columns).toHaveLength(1);

    // Round-trip
    const generated = irToSqlLocal(ir, 'duckdb');
    expect(generated.toUpperCase()).toContain('STRPTIME');
    expect(generated.toUpperCase()).toContain('GROUP BY');
    expect(generated).toContain('COUNT(*)');
    expect(generated).toContain("'New Customers'");
    expect(generated.toUpperCase()).toContain('NULL');
  });

  it('positional GROUP BY 1 on DATE_TRUNC column with a null param: no alias leaks into GROUP BY', async () => {
    // Reproduces: "syntax error at or near 'AS'" when platform param is skipped
    // and GROUP BY 1 resolves to DATE_TRUNC('month', created_at) AS month.
    // The alias must be stripped from the GROUP BY output.
    const sql = `SELECT DATE_TRUNC('month', created_at) AS month, COUNT(*) AS orders
                 FROM orders
                 WHERE status = 'completed' AND created_at >= :start_date AND platform = :platform
                 GROUP BY 1 ORDER BY 1`;
    const ir = await parseSqlToIrLocal(sql, 'duckdb') as QueryIR;
    const noneSet = new Set(['platform']);
    const transformed = removeNoneParamConditions(ir, noneSet);
    const generated = irToSqlLocal(transformed, 'duckdb');

    // GROUP BY must not contain an alias (AS ...) — that is invalid SQL
    const groupByClause = generated.match(/GROUP BY([\s\S]+?)(?:\nORDER BY|\nLIMIT|$)/i)?.[1] ?? '';
    expect(groupByClause.toUpperCase()).not.toContain(' AS ');
    // The query must still have a valid GROUP BY clause
    expect(generated.toUpperCase()).toContain('GROUP BY');
    // The platform filter must be gone
    expect(generated).not.toContain('platform');
  });
});

// ---------------------------------------------------------------------------
// Compound queries
// ---------------------------------------------------------------------------

describe('Compound queries (UNION)', () => {
  it('simple UNION', async () => {
    const sql = 'SELECT name FROM users UNION SELECT name FROM admins';
    const ir = await parseSqlToIrLocal(sql, 'duckdb') as CompoundQueryIR;
    expect(ir.type).toBe('compound');
    expect(ir.queries).toHaveLength(2);
    expect(ir.operators).toEqual(['UNION']);
    expect(ir.queries[0].from.table).toBe('users');
    expect(ir.queries[1].from.table).toBe('admins');
    expect(ir.order_by).toBeUndefined();
    expect(ir.limit).toBeUndefined();
  });

  it('UNION ALL', async () => {
    const sql = 'SELECT id, name FROM t1 UNION ALL SELECT id, name FROM t2';
    const ir = await parseSqlToIrLocal(sql, 'duckdb') as CompoundQueryIR;
    expect(ir.type).toBe('compound');
    expect(ir.operators).toEqual(['UNION ALL']);
    expect(ir.queries[0].select).toHaveLength(2);
    expect(ir.queries[1].select).toHaveLength(2);
  });

  it('triple UNION with mixed operators', async () => {
    const sql = 'SELECT a FROM t1 UNION SELECT a FROM t2 UNION ALL SELECT a FROM t3';
    const ir = await parseSqlToIrLocal(sql, 'duckdb') as CompoundQueryIR;
    expect(ir.type).toBe('compound');
    expect(ir.queries).toHaveLength(3);
    expect(ir.operators).toEqual(['UNION', 'UNION ALL']);
  });

  it('UNION with ORDER BY and LIMIT', async () => {
    const sql = 'SELECT name FROM users UNION ALL SELECT name FROM admins ORDER BY name LIMIT 10';
    const ir = await parseSqlToIrLocal(sql, 'duckdb') as CompoundQueryIR;
    expect(ir.type).toBe('compound');
    expect(ir.order_by).not.toBeUndefined();
    expect(ir.order_by).toHaveLength(1);
    expect(ir.order_by![0].column).toBe('name');
    expect(ir.limit).toBe(10);
    // Individual queries should NOT have order_by/limit
    for (const q of ir.queries) {
      expect(q.order_by).toBeUndefined();
      expect(q.limit).toBeUndefined();
    }
  });

  it('UNION round-trip with WHERE clauses', async () => {
    const sql = "SELECT name, email FROM users WHERE active = true UNION ALL SELECT name, email FROM admins WHERE role = 'admin'";
    const ir = await parseSqlToIrLocal(sql, 'duckdb') as CompoundQueryIR;
    expect(ir.type).toBe('compound');
    const generated = irToSqlLocal(ir, 'duckdb');
    const norm = normalizeSql(generated);
    expect(norm).toContain('UNION ALL');
    expect(norm).toContain('FROM USERS');
    expect(norm).toContain('FROM ADMINS');
    expect(norm).toContain('WHERE');
  });

  it('individual UNION queries preserve WHERE', async () => {
    const sql = "SELECT name FROM users WHERE active = true UNION SELECT name FROM admins WHERE role = 'superadmin'";
    const ir = await parseSqlToIrLocal(sql, 'duckdb') as CompoundQueryIR;
    expect(ir.queries[0].where).not.toBeUndefined();
    expect(ir.queries[1].where).not.toBeUndefined();
  });

  it('simple query returns QueryIR not CompoundQueryIR', async () => {
    const sql = 'SELECT id, name FROM users WHERE id > 5';
    const ir = await parseSqlToIrLocal(sql, 'duckdb');
    expect(ir.type).not.toBe('compound');
    expect((ir as QueryIR).from.table).toBe('users');
  });

  it('UNION round-trip generates valid SQL', async () => {
    const sql = 'SELECT name FROM users UNION SELECT name FROM admins';
    const ir = await parseSqlToIrLocal(sql, 'duckdb') as CompoundQueryIR;
    const generated = irToSqlLocal(ir, 'duckdb');
    const norm = normalizeSql(generated);
    expect(norm).toContain('UNION');
    expect(norm).toContain('FROM USERS');
    expect(norm).toContain('FROM ADMINS');
  });
});

// ─── ir-transforms.test.ts ───

function makeIR(conditions: Partial<FilterCondition>[]): QueryIR {
  return {
    version: 1,
    select: [{ type: 'column', column: '*' }],
    from: { table: 'orders' },
    where: { operator: 'AND', conditions: conditions as FilterCondition[] },
  };
}

describe('removeNoneParamConditions', () => {
  it('returns IR unchanged when noneParams is empty', () => {
    const ir = makeIR([{ column: 'status', operator: '=', param_name: 'status' }]);
    expect(removeNoneParamConditions(ir, new Set())).toEqual(ir);
  });

  it('removes a single WHERE condition whose param is None', () => {
    const ir = makeIR([{ column: 'status', operator: '=', param_name: 'status' }]);
    const result = removeNoneParamConditions(ir, new Set(['status']));
    expect(result.where).toBeUndefined();
  });

  it('removes one AND-connected condition, keeps the other', () => {
    const ir = makeIR([
      { column: 'status', operator: '=', param_name: 'status' },
      { column: 'region', operator: '=', param_name: 'region' },
    ]);
    const result = removeNoneParamConditions(ir, new Set(['status']));
    expect(result.where?.conditions).toHaveLength(1);
    expect((result.where!.conditions[0] as FilterCondition).param_name).toBe('region');
  });

  it('removes filter preceded by AND, keeps the other', () => {
    const ir = makeIR([
      { column: 'region', operator: '=', param_name: 'region' },
      { column: 'status', operator: '=', param_name: 'status' },
    ]);
    const result = removeNoneParamConditions(ir, new Set(['status']));
    expect(result.where?.conditions).toHaveLength(1);
    expect((result.where!.conditions[0] as FilterCondition).param_name).toBe('region');
  });

  it('removes all conditions, collapses WHERE entirely', () => {
    const ir = makeIR([
      { column: 'a', operator: '=', param_name: 'p1' },
      { column: 'b', operator: '=', param_name: 'p2' },
    ]);
    const result = removeNoneParamConditions(ir, new Set(['p1', 'p2']));
    expect(result.where).toBeUndefined();
  });

  it('removes WHERE entirely and preserves GROUP BY', () => {
    const ir: QueryIR = {
      version: 1,
      select: [{ type: 'column', column: '*' }],
      from: { table: 't' },
      where: { operator: 'AND', conditions: [{ column: 'col', operator: '=', param_name: 'p' }] },
      group_by: { columns: [{ column: 'id' }] },
    };
    const result = removeNoneParamConditions(ir, new Set(['p']));
    expect(result.where).toBeUndefined();
    expect(result.group_by).toBeDefined();
  });

  it('removes nested FilterGroup when all its conditions become None', () => {
    const ir: QueryIR = {
      version: 1,
      select: [{ type: 'column', column: '*' }],
      from: { table: 't' },
      where: {
        operator: 'AND',
        conditions: [
          { column: 'a', operator: '=', param_name: 'p1' },
          {
            operator: 'OR',
            conditions: [
              { column: 'b', operator: '=', param_name: 'p2' },
              { column: 'c', operator: '=', param_name: 'p3' },
            ],
          },
        ],
      },
    };
    const result = removeNoneParamConditions(ir, new Set(['p1', 'p2', 'p3']));
    expect(result.where).toBeUndefined();
  });

  it('keeps nested OR group when some of its conditions remain', () => {
    const ir: QueryIR = {
      version: 1,
      select: [{ type: 'column', column: '*' }],
      from: { table: 't' },
      where: {
        operator: 'AND',
        conditions: [
          {
            operator: 'OR',
            conditions: [
              { column: 'b', operator: '=', param_name: 'p2' },
              { column: 'c', operator: '=', param_name: 'p3' },
            ],
          },
        ],
      },
    };
    const result = removeNoneParamConditions(ir, new Set(['p2']));
    // OR group still has p3
    expect(result.where?.conditions).toHaveLength(1);
    const innerGroup = result.where!.conditions[0] as import('../ir-types').FilterGroup;
    expect(innerGroup.conditions).toHaveLength(1);
    expect((innerGroup.conditions[0] as FilterCondition).param_name).toBe('p3');
  });

  it('does not touch HAVING when only WHERE params are None', () => {
    const ir: QueryIR = {
      version: 1,
      select: [{ type: 'aggregate', aggregate: 'COUNT', column: '*' }],
      from: { table: 't' },
      where: { operator: 'AND', conditions: [{ column: 'x', operator: '=', param_name: 'p' }] },
      having: { operator: 'AND', conditions: [{ aggregate: 'COUNT', column: null, operator: '>', value: 5 }] },
    };
    const result = removeNoneParamConditions(ir, new Set(['p']));
    expect(result.where).toBeUndefined();
    expect(result.having?.conditions).toHaveLength(1);
  });

  it('removes HAVING condition when its param is None', () => {
    const ir: QueryIR = {
      version: 1,
      select: [{ type: 'aggregate', aggregate: 'COUNT', column: '*' }],
      from: { table: 't' },
      having: {
        operator: 'AND',
        conditions: [{ aggregate: 'COUNT', column: null, operator: '>', param_name: 'min_count' }],
      },
    };
    const result = removeNoneParamConditions(ir, new Set(['min_count']));
    expect(result.having).toBeUndefined();
  });

  it('keeps conditions with literal values when other params are None', () => {
    const ir = makeIR([
      { column: 'active', operator: '=', value: true },
      { column: 'region', operator: '=', param_name: 'region' },
    ]);
    const result = removeNoneParamConditions(ir, new Set(['region']));
    expect(result.where?.conditions).toHaveLength(1);
    expect((result.where!.conditions[0] as FilterCondition).value).toBe(true);
  });

  it('removes a WHERE ILIKE condition whose param is None', () => {
    const ir = makeIR([{ column: 'name', operator: 'ILIKE', param_name: 'search' }]);
    const result = removeNoneParamConditions(ir, new Set(['search']));
    expect(result.where).toBeUndefined();
  });

  it('handles mix of None and valued params', () => {
    const ir = makeIR([
      { column: 'a', operator: '=', param_name: 'p1' },
      { column: 'b', operator: '=', param_name: 'p2' },
      { column: 'c', operator: '=', param_name: 'p3' },
    ]);
    const result = removeNoneParamConditions(ir, new Set(['p1', 'p3']));
    expect(result.where?.conditions).toHaveLength(1);
    expect((result.where!.conditions[0] as FilterCondition).param_name).toBe('p2');
  });
});

// ─── limit-enforcer.test.ts ───


describe('enforceQueryLimit', () => {
  it('no LIMIT adds default', async () => {
    const result = await enforceQueryLimit('SELECT * FROM users', { defaultLimit: 1000, dialect: 'duckdb' });
    expect(result).toContain('LIMIT');
    expect(result).toContain('1000');
  });

  it('existing LIMIT under max is preserved', async () => {
    const result = await enforceQueryLimit('SELECT * FROM users LIMIT 500', { maxLimit: 10000, dialect: 'postgres' });
    expect(result).toContain('LIMIT');
    expect(result).toContain('500');
  });

  it('existing LIMIT over max is capped', async () => {
    const result = await enforceQueryLimit('SELECT * FROM users LIMIT 50000', { maxLimit: 10000, dialect: 'bigquery' });
    expect(result.toUpperCase()).toContain('LIMIT 10000');
    expect(result).not.toContain('50000');
  });

  it('LIMIT with OFFSET preserved', async () => {
    const result = await enforceQueryLimit('SELECT * FROM users LIMIT 5000 OFFSET 100', { maxLimit: 10000, dialect: 'duckdb' });
    expect(result).toContain('5000');
    expect(result.toUpperCase()).toContain('OFFSET');
    expect(result).toContain('100');
  });

  it('LIMIT over max with OFFSET', async () => {
    const result = await enforceQueryLimit('SELECT * FROM users LIMIT 50000 OFFSET 100', { maxLimit: 10000, dialect: 'postgres' });
    expect(result.toUpperCase()).toContain('LIMIT 10000');
    expect(result.toUpperCase()).toContain('OFFSET');
  });

  it('subquery LIMIT ignored, outer LIMIT added', async () => {
    const result = await enforceQueryLimit('SELECT * FROM (SELECT * FROM users LIMIT 100) sub', { defaultLimit: 1000, dialect: 'bigquery' });
    expect(result).toContain('100');
    expect(result).toContain('1000');
  });

  it('CTE with LIMIT, outer LIMIT added', async () => {
    const sql = `WITH top_users AS (SELECT * FROM users LIMIT 50) SELECT * FROM top_users`;
    const result = await enforceQueryLimit(sql, { defaultLimit: 1000, dialect: 'duckdb' });
    expect(result).toContain('50');
    expect(result).toContain('1000');
  });

  // Compound set operations receive the default LIMIT at the root.
  const compoundDefaultLimitCases: Array<{ desc: string; sql: string; dialect: 'duckdb' | 'postgres' | 'bigquery' }> = [
    { desc: 'UNION queries get LIMIT', sql: 'SELECT * FROM users UNION SELECT * FROM admins', dialect: 'postgres' },
    { desc: 'multiple UNIONs', sql: 'SELECT * FROM users UNION SELECT * FROM admins UNION SELECT * FROM guests', dialect: 'duckdb' },
    { desc: 'INTERSECT queries', sql: 'SELECT * FROM users INTERSECT SELECT * FROM admins', dialect: 'postgres' },
    { desc: 'EXCEPT queries', sql: 'SELECT * FROM users EXCEPT SELECT * FROM admins', dialect: 'postgres' },
  ];

  it.each(compoundDefaultLimitCases)('$desc', async ({ sql, dialect }) => {
    const result = await enforceQueryLimit(sql, { defaultLimit: 1000, dialect });
    expect(result.toUpperCase()).toContain('LIMIT 1000');
  });

  it('UNION with existing over-max LIMIT is capped', async () => {
    const result = await enforceQueryLimit('SELECT * FROM users UNION SELECT * FROM admins LIMIT 50000', { maxLimit: 10000, dialect: 'duckdb' });
    expect(result.toUpperCase()).toContain('LIMIT 10000');
    expect(result).not.toContain('50000');
  });

  it('parse error returns original SQL', async () => {
    const sql = 'SELECT * FROM users WHERE x = ';
    const result = await enforceQueryLimit(sql, { defaultLimit: 1000, dialect: 'duckdb' });
    expect(result).toBe(sql);
  });

  // DML / DDL statements never receive a LIMIT.
  const noLimitCases: Array<{ desc: string; sql: string; dialect: 'duckdb' | 'postgres' | 'bigquery' }> = [
    { desc: 'INSERT query — no LIMIT added', sql: "INSERT INTO users (name) VALUES ('Alice')", dialect: 'postgres' },
    { desc: 'UPDATE query — no LIMIT added', sql: "UPDATE users SET name = 'Bob' WHERE id = 1", dialect: 'bigquery' },
    { desc: 'DELETE query — no LIMIT added', sql: 'DELETE FROM users WHERE id = 1', dialect: 'duckdb' },
    { desc: 'CREATE TABLE — no LIMIT added', sql: 'CREATE TABLE users (id INTEGER, name TEXT)', dialect: 'postgres' },
  ];

  it.each(noLimitCases)('$desc', async ({ sql, dialect }) => {
    const result = await enforceQueryLimit(sql, { defaultLimit: 1000, dialect });
    expect(result.toUpperCase()).not.toContain('LIMIT');
  });

  it('case insensitive keywords', async () => {
    const result = await enforceQueryLimit('select * from users', { defaultLimit: 1000, dialect: 'bigquery' });
    expect(result.toUpperCase()).toContain('LIMIT 1000');
  });

  it('nested subqueries — only one LIMIT added at root', async () => {
    const sql = 'SELECT * FROM (SELECT * FROM (SELECT * FROM users) a) b';
    const result = await enforceQueryLimit(sql, { defaultLimit: 1000, dialect: 'duckdb' });
    const limitCount = (result.toUpperCase().match(/LIMIT/g) || []).length;
    expect(limitCount).toBe(1);
    expect(result.toUpperCase()).toContain('LIMIT 1000');
  });

  // --- Named parameter preservation ---

  // Each row: enforceQueryLimit must preserve the named :params (case-sensitive) in the
  // output; `mustContainUpper` lists substrings asserted against the upper-cased result.
  const paramPreservationCases: Array<{ desc: string; sql: string; dialect: 'duckdb' | 'postgres' | 'bigquery'; params: string[]; mustContainUpper?: string[] }> = [
    { desc: 'postgres preserves :param in date filter', sql: 'SELECT COUNT(DISTINCT id) AS total_users FROM stores WHERE created_at > :date_min', dialect: 'postgres', params: [':date_min'], mustContainUpper: ['LIMIT 1000'] },
    { desc: 'postgres preserves :param in number filter', sql: 'SELECT * FROM orders WHERE amount > :min_amount', dialect: 'postgres', params: [':min_amount'] },
    { desc: 'postgres preserves multiple :params', sql: 'SELECT * FROM events WHERE created_at > :date_min AND created_at < :date_max', dialect: 'postgres', params: [':date_min', ':date_max'] },
    { desc: 'postgres preserves :param in text filter', sql: 'SELECT * FROM users WHERE name = :name_val', dialect: 'postgres', params: [':name_val'] },
    { desc: 'duckdb preserves :param', sql: 'SELECT * FROM stores WHERE created_at > :date_min', dialect: 'duckdb', params: [':date_min'] },
    { desc: 'bigquery preserves :param', sql: 'SELECT * FROM stores WHERE created_at > :date_min', dialect: 'bigquery', params: [':date_min'] },
  ];

  it.each(paramPreservationCases)('$desc', async ({ sql, dialect, params, mustContainUpper }) => {
    const result = await enforceQueryLimit(sql, { defaultLimit: 1000, dialect });
    for (const param of params) {
      expect(result).toContain(param);
    }
    for (const substr of mustContainUpper ?? []) {
      expect(result.toUpperCase()).toContain(substr);
    }
  });
});

// ─── mention-completions.test.ts ───


const schemaData: DatabaseWithSchema[] = [
  {
    databaseName: 'test_db',
    schemas: [
      {
        schema: 'public',
        tables: [
          { table: 'users', columns: [{ name: 'id', type: 'int' }] },
          { table: 'orders', columns: [{ name: 'id', type: 'int' }] },
          { table: 'user_events', columns: [{ name: 'id', type: 'int' }] },
        ],
      },
      {
        schema: 'analytics',
        tables: [
          { table: 'events', columns: [{ name: 'id', type: 'int' }] },
        ],
      },
    ],
  },
];

const questions: AvailableQuestion[] = [
  { id: 1, name: 'Revenue by Month', alias: 'revenue_by_month_1', type: 'question' },
  { id: 2, name: 'User Growth', alias: 'user_growth_2', type: 'question' },
  { id: 3, name: 'Sales Dashboard', alias: 'sales_dashboard_3', type: 'dashboard' },
];

describe('getMentionCompletionsLocal', () => {
  // --- Table mentions (mentionType = "all") ---

  it('returns all tables when prefix is empty and mentionType is "all"', () => {
    const result = getMentionCompletionsLocal('', schemaData, questions, 'all');
    const names = result.map(s => s.name);
    expect(names).toContain('users');
    expect(names).toContain('orders');
    expect(names).toContain('events');
    expect(names).toContain('user_events');
  });

  it('includes questions and dashboards when mentionType is "all"', () => {
    const result = getMentionCompletionsLocal('', schemaData, questions, 'all');
    const names = result.map(s => s.name);
    expect(names).toContain('Revenue by Month');
    expect(names).toContain('Sales Dashboard');
  });

  it('filters tables by prefix', () => {
    const result = getMentionCompletionsLocal('user', schemaData, questions, 'all');
    const names = result.map(s => s.name);
    expect(names).toContain('users');
    expect(names).toContain('user_events');
    expect(names).not.toContain('orders');
    expect(names).not.toContain('events');
  });

  it('filters by qualified name (schema.table)', () => {
    const result = getMentionCompletionsLocal('analytics', schemaData, questions, 'all');
    const names = result.map(s => s.name);
    expect(names).toContain('events'); // analytics.events matches
    expect(names).not.toContain('users');
  });

  it('filters questions by prefix', () => {
    const result = getMentionCompletionsLocal('revenue', schemaData, questions, 'all');
    const qNames = result.filter(s => s.type === 'question').map(s => s.name);
    expect(qNames).toContain('Revenue by Month');
    expect(qNames).not.toContain('User Growth');
  });

  it('filters questions by alias prefix', () => {
    const result = getMentionCompletionsLocal('user_growth', schemaData, questions, 'all');
    const qNames = result.filter(s => s.type === 'question').map(s => s.name);
    expect(qNames).toContain('User Growth');
  });

  // --- Questions-only (mentionType = "questions") ---

  it('excludes tables when mentionType is "questions"', () => {
    const result = getMentionCompletionsLocal('', schemaData, questions, 'questions');
    const types = new Set(result.map(s => s.type));
    expect(types).not.toContain('table');
    expect(types).toContain('question');
    expect(types).toContain('dashboard');
  });

  it('returns all questions/dashboards with empty prefix', () => {
    const result = getMentionCompletionsLocal('', schemaData, questions, 'questions');
    expect(result).toHaveLength(3);
  });

  // --- Insert text format ---

  it('table insert_text is @schema.table', () => {
    const result = getMentionCompletionsLocal('users', schemaData, [], 'all');
    const usersItem = result.find(s => s.name === 'users');
    expect(usersItem).toBeDefined();
    expect(usersItem!.insert_text).toBe('@public.users');
  });

  it('question insert_text uses @@ prefix', () => {
    const result = getMentionCompletionsLocal('revenue', [], questions, 'all');
    const revItem = result.find(s => s.name === 'Revenue by Month');
    expect(revItem).toBeDefined();
    expect(revItem!.insert_text).toBe('@@revenue_by_month_1');
  });

  // --- Edge cases ---

  it('handles empty schema data', () => {
    const result = getMentionCompletionsLocal('', [], questions, 'all');
    expect(result.length).toBe(3); // only questions
  });

  it('handles empty questions', () => {
    const result = getMentionCompletionsLocal('', schemaData, [], 'all');
    const types = new Set(result.map(s => s.type));
    expect(types).toContain('table');
    expect(types).not.toContain('question');
  });

  it('handles no matches', () => {
    const result = getMentionCompletionsLocal('zzzzz', schemaData, questions, 'all');
    expect(result).toHaveLength(0);
  });

  it('case-insensitive filtering', () => {
    const result = getMentionCompletionsLocal('USERS', schemaData, [], 'all');
    expect(result.map(s => s.name)).toContain('users');
  });
});

// ─── schema-filter-child-paths.test.ts ───



const CONTEXT_DIR = '/org';

const fullSchema: DatabaseSchema = {
  updated_at: '2024-01-01',
  schemas: [{
    schema: 'public',
    tables: [
      { table: 'team_a_table', columns: [] },
      { table: 'team_b_table', columns: [] },
      { table: 'shared_table', columns: [] },
    ],
  }],
};

const whitelist: WhitelistItem[] = [
  { name: 'team_a_table', type: 'table', schema: 'public', childPaths: ['/org/team_a'] },
  { name: 'team_b_table', type: 'table', schema: 'public', childPaths: ['/org/team_b'] },
  { name: 'shared_table', type: 'table', schema: 'public' }, // no childPaths — always visible
];

function tables(result: DatabaseSchema): string[] {
  return result.schemas[0]?.tables.map(t => t.table) ?? [];
}

describe('filterSchemaByWhitelist — childPaths file vs folder scope', () => {
  // Case 1: the contextDir folder itself always sees everything
  it('case 1: /org (contextDir itself) sees all tables', () => {
    const result = filterSchemaByWhitelist(fullSchema, whitelist, CONTEXT_DIR, CONTEXT_DIR);
    expect(tables(result)).toEqual(expect.arrayContaining(['team_a_table', 'team_b_table', 'shared_table']));
    expect(tables(result)).toHaveLength(3);
  });

  // Case 2: a named folder scope only sees what childPaths allows it
  it('case 2: /org/team_a folder scope sees team_a_table and shared_table only', () => {
    const result = filterSchemaByWhitelist(fullSchema, whitelist, '/org/team_a', CONTEXT_DIR);
    expect(tables(result)).toContain('team_a_table');
    expect(tables(result)).toContain('shared_table');
    expect(tables(result)).not.toContain('team_b_table');
  });

  // Case 3: symmetric — teamb folder sees only its own tables
  it('case 3: /org/team_b folder scope sees team_b_table and shared_table only', () => {
    const result = filterSchemaByWhitelist(fullSchema, whitelist, '/org/team_b', CONTEXT_DIR);
    expect(tables(result)).toContain('team_b_table');
    expect(tables(result)).toContain('shared_table');
    expect(tables(result)).not.toContain('team_a_table');
  });

  // Case 4: file IN contextDir itself (e.g. /org/some-question) sees all tables
  it('case 4: file in contextDir (/org/some-question) sees all tables', () => {
    const result = filterSchemaByWhitelist(fullSchema, whitelist, CONTEXT_DIR, CONTEXT_DIR);
    expect(tables(result)).toEqual(expect.arrayContaining(['team_a_table', 'team_b_table', 'shared_table']));
    expect(tables(result)).toHaveLength(3);
  });

  // Case 6: file inside /org/team_a should see only what /org/team_a folder sees
  // A file inherits its parent directory's context — it should NOT bypass childPaths
  it('case 6: file in /org/team_a (/org/team_a/my-question) sees team_a_table + shared_table only', () => {
    const result = filterSchemaByWhitelist(fullSchema, whitelist, '/org/team_a', CONTEXT_DIR);
    expect(tables(result)).toContain('team_a_table');
    expect(tables(result)).toContain('shared_table');
    expect(tables(result)).not.toContain('team_b_table');
  });

  // Case 7: file inside /org/team_b should see only what /org/team_b folder sees
  it('case 7: file in /org/team_b (/org/team_b/my-dashboard) sees team_b_table + shared_table only', () => {
    const result = filterSchemaByWhitelist(fullSchema, whitelist, '/org/team_b', CONTEXT_DIR);
    expect(tables(result)).toContain('team_b_table');
    expect(tables(result)).toContain('shared_table');
    expect(tables(result)).not.toContain('team_a_table');
  });

  // Case 5: a folder scope not in any childPaths sees only unrestricted tables
  it('case 5: /org/some-folder folder scope sees only shared_table', () => {
    const result = filterSchemaByWhitelist(fullSchema, whitelist, '/org/some-folder', CONTEXT_DIR);
    expect(tables(result)).toContain('shared_table');
    expect(tables(result)).not.toContain('team_a_table');
    expect(tables(result)).not.toContain('team_b_table');
  });

  // Bonus: nested path under /org/team_a also passes (startsWith)
  it('nested path /org/team_a/subfolder passes for team_a_table', () => {
    const result = filterSchemaByWhitelist(fullSchema, whitelist, '/org/team_a/subfolder', CONTEXT_DIR);
    expect(tables(result)).toContain('team_a_table');
    expect(tables(result)).not.toContain('team_b_table');
  });

  // Bonus: empty childPaths — table visible nowhere (current behaviour preserved)
  it('empty childPaths [] blocks table for all folder scopes', () => {
    const wl: WhitelistItem[] = [
      { name: 'restricted_table', type: 'table', schema: 'public', childPaths: [] },
    ];
    const schema: DatabaseSchema = { updated_at: '2024-01-01', schemas: [{ schema: 'public', tables: [{ table: 'restricted_table', columns: [] }] }] };
    const result = filterSchemaByWhitelist(schema, wl, '/org/team_a', CONTEXT_DIR);
    expect(tables(result)).not.toContain('restricted_table');
  });
});

// ─── sql-params.test.ts ───

describe('extractParametersFromSQL', () => {
  // Each row: an input SQL string and the exact params array it must extract.
  // Covers basic extraction, type casts, lookbehind/lookahead skips, escaped
  // colons, and complex real-world queries — all pure input→output cases.
  const cases: Array<{ desc: string; sql: string; expected: string[] }> = [
    // ── Basic extraction ──────────────────────────────────────────
    { desc: 'returns [] for empty string', sql: '', expected: [] },
    { desc: 'returns [] for whitespace-only string', sql: '   \n\t  ', expected: [] },
    { desc: 'extracts a single param', sql: 'SELECT :foo', expected: ['foo'] },
    { desc: 'extracts multiple params', sql: 'WHERE a = :x AND b = :y', expected: ['x', 'y'] },
    { desc: 'deduplicates repeated params', sql: ':limit OFFSET :limit', expected: ['limit'] },
    { desc: 'extracts params with numbers in name', sql: 'SELECT :param1', expected: ['param1'] },
    { desc: 'extracts params with underscores', sql: 'WHERE date >= :start_date', expected: ['start_date'] },

    // ── Type casts — must NOT extract ────────────────────────────
    { desc: 'ignores :: DuckDB/PG type cast', sql: 'SELECT col::VARCHAR', expected: [] },
    { desc: 'ignores :: after a value', sql: "SELECT 'foo'::TEXT", expected: [] },
    // Regex limitation: (?!:) lookahead prevents matching :p when :: follows immediately.
    // Workaround: write ':p ::INT' (space before the cast).
    { desc: ':p directly followed by :: is not extracted (lookahead fires)', sql: 'SELECT :p::INT', expected: [] },
    { desc: ':p with a space before the cast is extracted: :p ::INT', sql: 'SELECT :p ::INT', expected: ['p'] },
    { desc: 'ignores DuckDB timestamp cast', sql: "SELECT '2021-01-01'::TIMESTAMP", expected: [] },

    // ── Colons preceded by word chars — skipped via lookbehind ───
    // digits are \w, so lookbehind fires on '10:30:00'
    { desc: 'ignores colon in time literal', sql: "WHERE time = '10:30:00'", expected: [] },
    { desc: 'ignores colon in timestamp literal', sql: "WHERE ts = '2024-01-01 10:30:00'", expected: [] },
    // 's' in 'https:' is \w, so lookbehind fires
    { desc: 'ignores URL in string', sql: "WHERE url = 'https://example.com'", expected: [] },
    // 'l' in "col:name" is \w, so lookbehind fires
    { desc: 'ignores :param inside double-quoted identifier', sql: 'SELECT "col:name"', expected: [] },
    { desc: 'extracts param after double-quoted identifier', sql: 'SELECT "col" = :p', expected: ['p'] },

    // ── Escaped colon — must NOT extract ─────────────────────────
    // backslash is in lookbehind (?<![:\w\\])
    { desc: 'ignores \\: escaped colon', sql: 'WHERE x = \\:not', expected: [] },

    // ── Complex real-world queries ────────────────────────────────
    {
      desc: 'handles full query with casts and params',
      sql: `SELECT id, name::TEXT, created_at::DATE
     FROM users
     WHERE status = 'active'
       AND created_at >= :start_date
       AND region = :region
     LIMIT :limit`,
      expected: ['start_date', 'region', 'limit'],
    },
    // colons inside '%Y-%m-%d' format string — no colons present, param outside is extracted
    { desc: 'handles DuckDB STRPTIME pattern', sql: "SELECT strptime(col, '%Y-%m-%d') FROM t WHERE date >= :start", expected: ['start'] },
    // Without [a-zA-Z_] anchor, the engine backtracks from :00 (fails lookahead) to :0 (passes)
    { desc: 'ignores :00:00 time literal — no backtracking to :0', sql: "SELECT ':00:00'", expected: [] },
    {
      desc: 'handles DATE_PARSE format string with real param',
      sql: "SELECT DATE_PARSE(CONCAT(CAST(year AS VARCHAR), '-', LPAD(CAST(hour AS VARCHAR), 2, '0'), ':00:00'), '%Y-%m-%d %H:%i:%s') FROM t WHERE dt >= :start_date",
      expected: ['start_date'],
    },

    // ── Param immediately followed by punctuation ─────────────────
    { desc: 'param followed by comma', sql: 'SELECT :p,', expected: ['p'] },
    { desc: 'param followed by close paren', sql: 'fn(:p)', expected: ['p'] },
    { desc: 'param followed by newline', sql: ':p\n', expected: ['p'] },
  ];

  it.each(cases)('$desc', ({ sql, expected }) => {
    expect(extractParametersFromSQL(sql)).toEqual(expected);
  });
});

// ─── sql-to-ir.test.ts ───


describe('Basic SELECT', () => {
  // Each row: parse SQL → IR, then assert the parsed select/from shape.
  const cases: Array<{ desc: string; sql: string; assert: (ir: QueryIR) => void }> = [
    {
      desc: 'SELECT *',
      sql: 'SELECT * FROM users',
      assert: (ir) => {
        expect(ir.select).toHaveLength(1);
        expect(ir.select[0].column).toBe('*');
        expect(ir.select[0].type).toBe('column');
        expect(ir.from.table).toBe('users');
      },
    },
    {
      desc: 'SELECT with specific columns',
      sql: 'SELECT name, email FROM users',
      assert: (ir) => {
        expect(ir.select).toHaveLength(2);
        expect(ir.select[0].column).toBe('name');
        expect(ir.select[1].column).toBe('email');
      },
    },
    {
      desc: 'SELECT with column alias',
      sql: 'SELECT name AS user_name, email FROM users',
      assert: (ir) => {
        expect(ir.select[0].alias).toBe('user_name');
        expect(ir.select[0].column).toBe('name');
      },
    },
    {
      desc: 'SELECT with table.column',
      sql: 'SELECT users.name, users.email FROM users',
      assert: (ir) => {
        expect(ir.select[0].table).toBe('users');
        expect(ir.select[0].column).toBe('name');
      },
    },
  ];

  it.each(cases)('$desc', async ({ sql, assert }) => {
    const ir = await parseSqlToIrLocal(sql, 'duckdb') as QueryIR;
    assert(ir);
  });
});

describe('Aggregates', () => {
  it('COUNT(*)', async () => {
    const ir = await parseSqlToIrLocal('SELECT COUNT(*) FROM users', 'duckdb') as QueryIR;
    expect(ir.select).toHaveLength(1);
    expect(ir.select[0].type).toBe('aggregate');
    expect(ir.select[0].aggregate).toBe('COUNT');
    expect(ir.select[0].column).toBeNull();
  });

  it('COUNT(column)', async () => {
    const ir = await parseSqlToIrLocal('SELECT COUNT(id) FROM users', 'duckdb') as QueryIR;
    expect(ir.select[0].aggregate).toBe('COUNT');
    expect(ir.select[0].column).toBe('id');
  });

  it('COUNT(DISTINCT column)', async () => {
    const ir = await parseSqlToIrLocal('SELECT COUNT(DISTINCT email) FROM users', 'duckdb') as QueryIR;
    expect(ir.select[0].aggregate).toBe('COUNT_DISTINCT');
    expect(ir.select[0].column).toBe('email');
  });

  it('multiple aggregates', async () => {
    const ir = await parseSqlToIrLocal('SELECT COUNT(*), SUM(amount), AVG(amount) FROM orders', 'duckdb') as QueryIR;
    expect(ir.select).toHaveLength(3);
    expect(ir.select[0].aggregate).toBe('COUNT');
    expect(ir.select[1].aggregate).toBe('SUM');
    expect(ir.select[2].aggregate).toBe('AVG');
  });

  it('aggregate with alias', async () => {
    const ir = await parseSqlToIrLocal('SELECT COUNT(*) AS total_users FROM users', 'duckdb') as QueryIR;
    expect(ir.select[0].alias).toBe('total_users');
  });
});

describe('JOINs', () => {
  it('INNER JOIN', async () => {
    const sql = `SELECT u.name, o.amount FROM users u INNER JOIN orders o ON u.id = o.user_id`;
    const ir = await parseSqlToIrLocal(sql, 'duckdb') as QueryIR;
    expect(ir.joins).not.toBeNull();
    expect(ir.joins).toHaveLength(1);
    expect(ir.joins![0].type).toBe('INNER');
    expect(ir.joins![0].table.table).toBe('orders');
    expect(ir.joins![0].table.alias).toBe('o');
    expect(ir.joins![0].on).toHaveLength(1);
    expect(ir.joins![0].on![0].left_table).toBe('u');
    expect(ir.joins![0].on![0].left_column).toBe('id');
    expect(ir.joins![0].on![0].right_table).toBe('o');
    expect(ir.joins![0].on![0].right_column).toBe('user_id');
  });

  it('LEFT JOIN', async () => {
    const sql = 'SELECT * FROM users LEFT JOIN orders ON users.id = orders.user_id';
    const ir = await parseSqlToIrLocal(sql, 'duckdb') as QueryIR;
    expect(ir.joins![0].type).toBe('LEFT');
  });

  it('multiple JOINs', async () => {
    const sql = `SELECT * FROM users u INNER JOIN orders o ON u.id = o.user_id LEFT JOIN products p ON o.product_id = p.id`;
    const ir = await parseSqlToIrLocal(sql, 'duckdb') as QueryIR;
    expect(ir.joins).toHaveLength(2);
    expect(ir.joins![0].type).toBe('INNER');
    expect(ir.joins![1].type).toBe('LEFT');
  });

  it('JOIN with multiple ON conditions', async () => {
    const sql = `SELECT * FROM users u INNER JOIN orders o ON u.id = o.user_id AND u.dept_id = o.dept_id`;
    const ir = await parseSqlToIrLocal(sql, 'duckdb') as QueryIR;
    expect(ir.joins![0].on).toHaveLength(2);
  });
});

describe('WHERE', () => {
  it('simple WHERE', async () => {
    const ir = await parseSqlToIrLocal('SELECT * FROM users WHERE active = true', 'duckdb') as QueryIR;
    expect(ir.where).not.toBeNull();
    expect(ir.where!.operator).toBe('AND');
    expect(ir.where!.conditions).toHaveLength(1);
    const cond = ir.where!.conditions[0] as any;
    expect(cond.column).toBe('active');
    expect(cond.operator).toBe('=');
  });

  it('WHERE with parameter', async () => {
    const ir = await parseSqlToIrLocal('SELECT * FROM users WHERE id = :user_id', 'duckdb') as QueryIR;
    const cond = ir.where!.conditions[0] as any;
    expect(cond.param_name).toBe('user_id');
  });

  it('WHERE with AND', async () => {
    const ir = await parseSqlToIrLocal('SELECT * FROM users WHERE active = true AND age > 18', 'duckdb') as QueryIR;
    expect(ir.where!.conditions).toHaveLength(2);
  });

  it('WHERE operators', async () => {
    const cases: [string, string][] = [
      ['SELECT * FROM users WHERE age > 18', '>'],
      ['SELECT * FROM users WHERE age < 65', '<'],
      ['SELECT * FROM users WHERE age >= 18', '>='],
      ['SELECT * FROM users WHERE age <= 65', '<='],
      ['SELECT * FROM users WHERE age != 25', '!='],
      ["SELECT * FROM users WHERE name LIKE '%John%'", 'LIKE'],
    ];
    for (const [sql, expectedOp] of cases) {
      const ir = await parseSqlToIrLocal(sql, 'duckdb') as QueryIR;
      expect((ir.where!.conditions[0] as any).operator).toBe(expectedOp);
    }
  });

  it('WHERE ILIKE', async () => {
    const ir = await parseSqlToIrLocal("SELECT * FROM users WHERE name ILIKE '%john%'", 'duckdb') as QueryIR;
    expect((ir.where!.conditions[0] as any).operator).toBe('ILIKE');
  });

  it('WHERE ILIKE with param', async () => {
    const ir = await parseSqlToIrLocal('SELECT * FROM users WHERE name ILIKE :search', 'duckdb') as QueryIR;
    const cond = ir.where!.conditions[0] as any;
    expect(cond.operator).toBe('ILIKE');
    expect(cond.param_name).toBe('search');
  });

  it('WHERE IS NULL', async () => {
    const ir = await parseSqlToIrLocal('SELECT * FROM users WHERE deleted_at IS NULL', 'duckdb') as QueryIR;
    expect((ir.where!.conditions[0] as any).operator).toBe('IS NULL');
  });

  it('WHERE IS NOT NULL', async () => {
    const ir = await parseSqlToIrLocal('SELECT * FROM users WHERE email IS NOT NULL', 'duckdb') as QueryIR;
    expect((ir.where!.conditions[0] as any).operator).toBe('IS NOT NULL');
  });

  it('WHERE IN', async () => {
    const ir = await parseSqlToIrLocal("SELECT * FROM users WHERE status IN ('active', 'pending')", 'duckdb') as QueryIR;
    const cond = ir.where!.conditions[0] as any;
    expect(cond.operator).toBe('IN');
    expect(Array.isArray(cond.value)).toBe(true);
    expect(cond.value).toHaveLength(2);
  });
});

describe('GROUP BY', () => {
  it('simple GROUP BY', async () => {
    const ir = await parseSqlToIrLocal('SELECT category, COUNT(*) FROM products GROUP BY category', 'duckdb') as QueryIR;
    expect(ir.group_by).not.toBeNull();
    expect(ir.group_by!.columns).toHaveLength(1);
    expect(ir.group_by!.columns[0].column).toBe('category');
  });

  it('GROUP BY multiple columns', async () => {
    const ir = await parseSqlToIrLocal('SELECT category, brand, COUNT(*) FROM products GROUP BY category, brand', 'duckdb') as QueryIR;
    expect(ir.group_by!.columns).toHaveLength(2);
  });

  it('GROUP BY with table qualifier', async () => {
    const ir = await parseSqlToIrLocal('SELECT p.category FROM products p GROUP BY p.category', 'duckdb') as QueryIR;
    expect(ir.group_by!.columns[0].table).toBe('p');
  });
});

describe('HAVING', () => {
  it('simple HAVING', async () => {
    const sql = 'SELECT category, COUNT(*) FROM products GROUP BY category HAVING COUNT(*) > 10';
    const ir = await parseSqlToIrLocal(sql, 'duckdb') as QueryIR;
    expect(ir.having).not.toBeNull();
    expect(ir.having!.operator).toBe('AND');
    expect(ir.having!.conditions).toHaveLength(1);
  });
});

describe('ORDER BY', () => {
  it('simple ORDER BY', async () => {
    const ir = await parseSqlToIrLocal('SELECT * FROM users ORDER BY name', 'duckdb') as QueryIR;
    expect(ir.order_by).not.toBeNull();
    expect(ir.order_by).toHaveLength(1);
    expect(ir.order_by![0].column).toBe('name');
    expect(ir.order_by![0].direction).toBe('ASC');
  });

  it('ORDER BY DESC', async () => {
    const ir = await parseSqlToIrLocal('SELECT * FROM users ORDER BY created_at DESC', 'duckdb') as QueryIR;
    expect(ir.order_by![0].direction).toBe('DESC');
  });

  it('ORDER BY multiple columns', async () => {
    const ir = await parseSqlToIrLocal('SELECT * FROM users ORDER BY last_name ASC, first_name DESC', 'duckdb') as QueryIR;
    expect(ir.order_by).toHaveLength(2);
    expect(ir.order_by![0].direction).toBe('ASC');
    expect(ir.order_by![1].direction).toBe('DESC');
  });
});

describe('LIMIT', () => {
  it('LIMIT', async () => {
    const ir = await parseSqlToIrLocal('SELECT * FROM users LIMIT 10', 'duckdb') as QueryIR;
    expect(ir.limit).toBe(10);
  });

  it('no LIMIT', async () => {
    const ir = await parseSqlToIrLocal('SELECT * FROM users', 'duckdb') as QueryIR;
    expect(ir.limit).toBeUndefined();
  });
});

describe('Complex queries', () => {
  it('full query with all features', async () => {
    const sql = `
      SELECT
        u.name,
        COUNT(*) AS order_count,
        SUM(o.amount) AS total_amount
      FROM users u
      INNER JOIN orders o ON u.id = o.user_id
      WHERE u.active = true AND o.status = 'completed'
      GROUP BY u.name
      HAVING COUNT(*) > 5
      ORDER BY total_amount DESC
      LIMIT 20
    `;
    const ir = await parseSqlToIrLocal(sql, 'duckdb') as QueryIR;
    expect(ir.select).toHaveLength(3);
    expect(ir.joins).not.toBeNull();
    expect(ir.where).not.toBeNull();
    expect(ir.group_by).not.toBeNull();
    expect(ir.having).not.toBeNull();
    expect(ir.order_by).not.toBeNull();
    expect(ir.limit).toBe(20);
  });
});

describe('Unsupported features', () => {
  it('subquery rejected', async () => {
    const sql = 'SELECT * FROM users WHERE id IN (SELECT user_id FROM orders)';
    await expect(parseSqlToIrLocal(sql, 'duckdb')).rejects.toThrow();
  });

  it('CTE supported', async () => {
    const sql = 'WITH active_users AS (SELECT * FROM users WHERE active = TRUE) SELECT * FROM active_users';
    const ir = await parseSqlToIrLocal(sql, 'duckdb') as QueryIR;
    expect(ir).not.toBeNull();
    expect(ir.ctes).not.toBeNull();
    expect(ir.ctes).toHaveLength(1);
    expect(ir.ctes![0].name).toBe('active_users');
  });

  it('UNION supported', async () => {
    const sql = 'SELECT * FROM users UNION SELECT * FROM admins';
    const ir = await parseSqlToIrLocal(sql, 'duckdb') as CompoundQueryIR;
    expect(ir).not.toBeNull();
    expect(ir.type).toBe('compound');
  });

  it('CASE expression stored as raw', async () => {
    const sql = "SELECT CASE WHEN age > 18 THEN 'adult' ELSE 'minor' END AS age_group FROM users";
    const ir = await parseSqlToIrLocal(sql, 'duckdb') as QueryIR;
    expect(ir.select[0].type).toBe('raw');
    expect(ir.select[0].raw_sql!.toUpperCase()).toContain('CASE');
  });
});

describe('Edge cases', () => {
  it('invalid SQL throws', async () => {
    await expect(parseSqlToIrLocal('INVALID SQL SYNTAX', 'duckdb')).rejects.toThrow();
  });

  it('no FROM clause throws', async () => {
    await expect(parseSqlToIrLocal('SELECT 1 + 1', 'duckdb')).rejects.toThrow();
  });

  it('schema-qualified table', async () => {
    const ir = await parseSqlToIrLocal('SELECT * FROM public.users', 'duckdb') as QueryIR;
    expect(ir.from.schema).toBe('public');
    expect(ir.from.table).toBe('users');
  });
});

describe('Function calls in WHERE', () => {
  it('SPLIT_PART with param', async () => {
    const sql = `
      SELECT release_date, ROUND(AVG(elo), 0) AS avg_elo, MAX(elo) AS max_elo
      FROM chatbot_arena_leaderboard
      WHERE release_date IS NOT NULL
        AND SPLIT_PART(release_date, '-', 1) = :year
      GROUP BY release_date
      ORDER BY release_date ASC
    `;
    const ir = await parseSqlToIrLocal(sql, 'duckdb') as QueryIR;
    expect(ir.where).not.toBeNull();
    expect(ir.where!.conditions).toHaveLength(2);
    const paramConds = ir.where!.conditions.filter(
      (c: any) => c.param_name === 'year',
    );
    expect(paramConds).toHaveLength(1);
  });

  it('comparison with param', async () => {
    const sql = 'SELECT * FROM scores WHERE elo > :min_elo';
    const ir = await parseSqlToIrLocal(sql, 'duckdb') as QueryIR;
    const cond = ir.where!.conditions[0] as any;
    expect(cond.param_name).toBe('min_elo');
    expect(cond.operator).toBe('>');
  });

  it('expression-based column like lower(city)', async () => {
    const sql = "SELECT * FROM restaurants WHERE lower(city) = 'san francisco'";
    const ir = await parseSqlToIrLocal(sql, 'duckdb') as QueryIR;
    expect(ir.where).not.toBeNull();
    expect(ir.where!.conditions).toHaveLength(1);
    const cond = ir.where!.conditions[0] as any;
    // Should preserve the expression via raw_column
    expect(cond.raw_column).toBeDefined();
    expect(cond.raw_column!.toLowerCase()).toContain('lower');
    expect(cond.raw_column!.toLowerCase()).toContain('city');
    expect(cond.operator).toBe('=');
    expect(cond.value).toBe('san francisco'); // Should preserve the literal value as-is (not converted to param) --- IGNORE ---
  });

  it('expression-based column round-trips through IR', async () => {
    const sql = "SELECT * FROM restaurants WHERE lower(city) = 'san francisco'";
    const ir = await parseSqlToIrLocal(sql, 'duckdb') as QueryIR;
    // Ensure conditions is always an array (never undefined)
    expect(Array.isArray(ir.where!.conditions)).toBe(true);
  });
});

// ─── validate-query-tables-local.test.ts ───


const WHITELIST_USERS_ONLY: WhitelistEntry[] = [
  { schema: 'public', tables: [{ table: 'users' }] },
];

const WHITELIST_MULTI: WhitelistEntry[] = [
  { schema: 'public', tables: [{ table: 'users' }, { table: 'accounts' }] },
  { schema: 'analytics', tables: [{ table: 'events' }] },
];

describe('validateQueryTablesLocal (polyglot WASM)', () => {
  // ── Empty / no-op cases ──────────────────────────────────────────────────

  it('returns null for an empty whitelist (no restriction)', async () => {
    const result = await validateQueryTablesLocal('SELECT * FROM orders', []);
    expect(result).toBeNull();
  });

  // ── Allowed tables ────────────────────────────────────────────────────────

  it('returns null when all referenced tables are whitelisted', async () => {
    const result = await validateQueryTablesLocal('SELECT id, name FROM users', WHITELIST_USERS_ONLY);
    expect(result).toBeNull();
  });

  it('returns null for schema-qualified allowed reference (public.users)', async () => {
    const result = await validateQueryTablesLocal('SELECT * FROM public.users', WHITELIST_USERS_ONLY);
    expect(result).toBeNull();
  });

  it('returns null when all tables across multiple schemas are whitelisted', async () => {
    const sql = 'SELECT u.id, e.event FROM public.users u JOIN analytics.events e ON u.id = e.user_id';
    const result = await validateQueryTablesLocal(sql, WHITELIST_MULTI);
    expect(result).toBeNull();
  });

  // ── Blocked tables ────────────────────────────────────────────────────────

  it('returns an error string when a table is not in the whitelist', async () => {
    const result = await validateQueryTablesLocal('SELECT * FROM orders', WHITELIST_USERS_ONLY);
    expect(result).not.toBeNull();
    expect(typeof result).toBe('string');
    expect(result).toMatch(/orders/i);
  });

  it('error message mentions the blocked table name', async () => {
    const result = await validateQueryTablesLocal('SELECT * FROM secret_data', WHITELIST_USERS_ONLY);
    expect(result).toMatch(/secret_data/i);
  });

  it('returns an error when one table in a multi-table query is blocked', async () => {
    const sql = 'SELECT u.id FROM users u JOIN restricted_table r ON u.id = r.user_id';
    const result = await validateQueryTablesLocal(sql, WHITELIST_USERS_ONLY);
    expect(result).not.toBeNull();
    expect(result).toMatch(/restricted_table/i);
  });

  it('returns an error for wrong-schema qualified reference (analytics.users not in whitelist)', async () => {
    const result = await validateQueryTablesLocal('SELECT * FROM analytics.users', WHITELIST_USERS_ONLY);
    expect(result).not.toBeNull();
  });

  // ── CTE handling ─────────────────────────────────────────────────────────

  it('does not flag a CTE whose name matches a blocked table', async () => {
    const sql = 'WITH orders AS (SELECT 1 AS id) SELECT id FROM orders';
    const result = await validateQueryTablesLocal(sql, WHITELIST_USERS_ONLY);
    expect(result).toBeNull();
  });

  it('flags a real table referenced inside a CTE body', async () => {
    const sql = 'WITH cte AS (SELECT * FROM secret_table) SELECT * FROM cte';
    const result = await validateQueryTablesLocal(sql, WHITELIST_USERS_ONLY);
    expect(result).not.toBeNull();
    expect(result).toMatch(/secret_table/i);
  });

  it('does not flag a CTE name defined inside a subquery (non-recursive collectCteNames bug)', async () => {
    // DuckDB supports CTEs inside subqueries. The validator must not report the CTE
    // alias as a blocked table — only real base tables matter.
    const sql = 'SELECT * FROM (WITH inner_cte AS (SELECT id FROM users) SELECT id FROM inner_cte) sub';
    const result = await validateQueryTablesLocal(sql, WHITELIST_USERS_ONLY);
    // inner_cte is a CTE alias, not a real table — should not appear in the error
    if (result !== null) {
      expect(result).not.toMatch(/inner_cte/i);
    }
  });

  it('does not flag nested CTE aliases at multiple levels', async () => {
    // outer_cte is top-level, inner_cte is inside a subquery — neither is a real table
    const sql = [
      'WITH outer_cte AS (SELECT id FROM users)',
      'SELECT * FROM (',
      '  WITH inner_cte AS (SELECT id FROM outer_cte)',
      '  SELECT id FROM inner_cte',
      ') sub',
    ].join('\n');
    const result = await validateQueryTablesLocal(sql, WHITELIST_USERS_ONLY);
    if (result !== null) {
      expect(result).not.toMatch(/inner_cte/i);
      expect(result).not.toMatch(/outer_cte/i);
    }
  });

  // ── Error tolerance ───────────────────────────────────────────────────────

  it('returns null for unparseable SQL (allow through)', async () => {
    const result = await validateQueryTablesLocal('NOT VALID SQL !!! ###', WHITELIST_USERS_ONLY);
    expect(result).toBeNull();
  });

  it('returns null for an empty SQL string', async () => {
    const result = await validateQueryTablesLocal('', WHITELIST_USERS_ONLY);
    expect(result).toBeNull();
  });
});

// ─── validate-query-tables.test.ts ───



// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const TEST_USER: EffectiveUser = {
  userId: 1,
  email: 'test@example.com',
  name: 'Test User',
  role: 'admin',
  home_folder: '/org',
  mode: 'org',
};

describe('validateQueryTables — delegates to validateQueryTablesLocal (drops user arg)', () => {
  // The exported wrapper is a pure pass-through to validateQueryTablesLocal
  // (it ignores the EffectiveUser arg). The SQL/whitelist logic is covered
  // exhaustively above; here we only assert the wrapper forwards both outcomes.

  it('forwards an allowed query (returns null)', async () => {
    const result = await validateQueryTables('SELECT id, name FROM users', WHITELIST_USERS_ONLY, TEST_USER);
    expect(result).toBeNull();
  });

  it('forwards a blocked query (returns the error string)', async () => {
    const result = await validateQueryTables('SELECT * FROM orders', WHITELIST_USERS_ONLY, TEST_USER);
    expect(result).toMatch(/orders/i);
  });
});

// ─── validate-sql.test.ts ───

describe('validateSqlLocal (polyglot WASM)', () => {
  // --- Basic valid queries (various dialects) ---

  const validSelectCases: Array<{ dialect: 'duckdb' | 'postgres' | 'bigquery'; sql: string; checkNoErrors?: boolean }> = [
    { dialect: 'duckdb', sql: 'SELECT * FROM foo', checkNoErrors: true },
    { dialect: 'postgres', sql: 'SELECT id, name FROM users WHERE active = true' },
    { dialect: 'bigquery', sql: 'SELECT COUNT(*) AS total FROM orders' },
  ];

  it.each(validSelectCases)('valid simple select - $dialect', async ({ dialect, sql, checkNoErrors }) => {
    const result = await validateSqlLocal(sql, dialect);
    expect(result.valid).toBe(true);
    if (checkNoErrors) {
      expect(result.errors).toEqual([]);
    }
  });

  // --- Empty / whitespace ---

  it('empty query is valid', async () => {
    const result = await validateSqlLocal('', 'duckdb');
    expect(result.valid).toBe(true);
  });

  it('whitespace-only query is valid', async () => {
    const result = await validateSqlLocal('   ', 'postgres');
    expect(result.valid).toBe(true);
  });

  // --- Invalid queries ---

  const invalidKeywordCases: Array<{ dialect: 'duckdb' | 'postgres' | 'bigquery'; checkErrors?: boolean }> = [
    { dialect: 'duckdb', checkErrors: true },
    { dialect: 'postgres' },
    { dialect: 'bigquery' },
  ];

  it.each(invalidKeywordCases)('invalid keyword - $dialect', async ({ dialect, checkErrors }) => {
    const result = await validateSqlLocal('SELEC * FROM foo', dialect);
    expect(result.valid).toBe(false);
    if (checkErrors) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  // --- Error position info ---

  it('error has valid position info', async () => {
    const result = await validateSqlLocal('SELEC * FROM foo', 'duckdb');
    const err = result.errors[0];
    expect(err.line).toBeGreaterThanOrEqual(1);
    expect(err.col).toBeGreaterThanOrEqual(1);
    expect(err.end_col).toBeGreaterThan(err.col);
  });

  // --- Params and references ---

  it('params dont cause errors - postgres', async () => {
    const result = await validateSqlLocal(
      'SELECT * FROM foo WHERE d > :start_date AND n = :name',
      'postgres',
    );
    expect(result.valid).toBe(true);
  });

  it('params dont cause errors - bigquery', async () => {
    const result = await validateSqlLocal(
      'SELECT * FROM foo WHERE amount > :min_amount',
      'bigquery',
    );
    expect(result.valid).toBe(true);
  });

  it('references dont cause errors', async () => {
    const result = await validateSqlLocal(
      'SELECT * FROM @revenue_1 r JOIN @costs_2 c ON r.id = c.id',
      'duckdb',
    );
    expect(result.valid).toBe(true);
  });

  it('mixed params and references', async () => {
    const result = await validateSqlLocal(
      'SELECT * FROM @rev_1 WHERE d > :start_date',
      'postgres',
    );
    expect(result.valid).toBe(true);
  });

  // --- Multi-statement ---

  it('multi statement is valid', async () => {
    const result = await validateSqlLocal('SELECT 1; SELECT 2', 'duckdb');
    expect(result.valid).toBe(true);
  });

  // --- Error positions not shifted by params ---

  it('error positions not shifted by params', async () => {
    const result = await validateSqlLocal(
      'SELECT * FROM foo WHERE :start_date BETWEEN AND',
      'postgres',
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].line).toBe(1);
  });

  // --- Dialect-specific syntax ---

  const dialectSyntaxCases: Array<{ desc: string; sql: string; dialect: 'duckdb' | 'postgres' | 'bigquery' }> = [
    { desc: 'duckdb read_csv', sql: "SELECT * FROM read_csv('file.csv')", dialect: 'duckdb' },
    { desc: 'duckdb list literal', sql: 'SELECT [1, 2, 3] AS nums', dialect: 'duckdb' },
    { desc: 'bigquery backtick table', sql: 'SELECT * FROM `project.dataset.table`', dialect: 'bigquery' },
    { desc: 'bigquery struct', sql: "SELECT STRUCT(1 AS a, 'foo' AS b) AS s", dialect: 'bigquery' },
    { desc: 'postgres dollar quoting', sql: 'SELECT $$hello world$$ AS greeting', dialect: 'postgres' },
  ];

  it.each(dialectSyntaxCases)('$desc', async ({ sql, dialect }) => {
    const result = await validateSqlLocal(sql, dialect);
    expect(result.valid).toBe(true);
  });

  // --- Multiline SQL with errors ---

  // Invalid multiline queries: valid === false with at least one error reported.
  const multilineInvalidCases: Array<{ desc: string; sql: string; dialect: 'duckdb' | 'postgres' | 'bigquery' }> = [
    {
      desc: 'multiline missing FROM (JION typo)',
      dialect: 'duckdb',
      sql: `SELECT
    u.id,
    u.name,
    o.total
JION orders o ON o.user_id = u.id
WHERE u.active = true`,
    },
    {
      desc: 'multiline unclosed subquery',
      dialect: 'postgres',
      sql: `SELECT *
FROM (
    SELECT id, name
    FROM users
    WHERE active = true

WHERE id > 10`,
    },
    {
      desc: 'multiline CTE with typo',
      dialect: 'duckdb',
      sql: `WITH monthly_revenue AS (
    SELECT
        DATE_TRUNC('month', created_at) AS month,
        SUM(amount) AS revenue
    FROM orders
    GRUOP BY 1
)
SELECT *
FROM monthly_revenue
ORDER BY month`,
    },
    {
      desc: 'multiline double WHERE',
      dialect: 'postgres',
      sql: `SELECT
    u.name,
    o.total
FROM users u
JOIN orders o ON o.user_id = u.id
WHERE u.active = true
WHERE o.created_at > '2024-01-01'`,
    },
    {
      desc: 'multiline mismatched parens',
      dialect: 'postgres',
      sql: `SELECT
    id,
    name,
    (CASE WHEN active THEN 'yes' ELSE 'no' AS status
FROM users`,
    },
  ];

  it.each(multilineInvalidCases)('$desc', async ({ sql, dialect }) => {
    const result = await validateSqlLocal(sql, dialect);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  // Distinct assertion shape: asserts the reported error line, not the error count.
  it('multiline error reports correct line', async () => {
    const result = await validateSqlLocal(
      'SELECT id\nFROM users\nWHERE id >\nORDER BY',
      'bigquery',
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].line).toBeGreaterThan(1);
  });

  // Valid multiline queries.
  const multilineValidCases: Array<{ desc: string; sql: string; dialect: 'duckdb' | 'postgres' | 'bigquery' }> = [
    {
      desc: 'multiline valid complex query',
      dialect: 'bigquery',
      sql: `WITH active_users AS (
    SELECT id, name, email
    FROM users
    WHERE active = true
),
user_orders AS (
    SELECT
        u.id,
        u.name,
        COUNT(o.id) AS order_count,
        SUM(o.total) AS total_spent
    FROM active_users u
    LEFT JOIN orders o ON o.user_id = u.id
    GROUP BY u.id, u.name
)
SELECT
    name,
    order_count,
    total_spent,
    CASE
        WHEN total_spent > 1000 THEN 'high'
        WHEN total_spent > 100 THEN 'medium'
        ELSE 'low'
    END AS tier
FROM user_orders
ORDER BY total_spent DESC
LIMIT 50`,
    },
    {
      desc: 'multiline with params and references',
      dialect: 'duckdb',
      sql: `SELECT
    r.month,
    r.revenue,
    c.cost,
    r.revenue - c.cost AS profit
FROM @revenue_by_month_1 r
JOIN @costs_by_month_2 c ON c.month = r.month
WHERE r.month >= :start_date
    AND r.month <= :end_date
ORDER BY r.month`,
    },
  ];

  it.each(multilineValidCases)('$desc', async ({ sql, dialect }) => {
    const result = await validateSqlLocal(sql, dialect);
    expect(result.valid).toBe(true);
  });
});
