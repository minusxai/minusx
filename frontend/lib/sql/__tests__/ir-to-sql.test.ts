/**
 * Tests for irToSqlLocal (IR → SQL generator).
 * Ported from backend/sql_ir/generator.py and backend/tests/test_sql_ir_e2e.py.
 * Tests round-trip: SQL → IR → SQL.
 */
import { parseSqlToIrLocal } from '../sql-to-ir';
import { irToSqlLocal } from '../ir-to-sql';
import type { QueryIR, CompoundQueryIR } from '@/lib/sql/ir-types';

/** Normalize SQL for comparison */
function normalizeSql(sql: string): string {
  return sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').replace(/;$/, '').trim().toUpperCase();
}

describe('IR to SQL generator', () => {
  it('simple SELECT *', async () => {
    const ir = await parseSqlToIrLocal('SELECT * FROM users', 'duckdb') as QueryIR;
    const sql = irToSqlLocal(ir, 'duckdb');
    expect(normalizeSql(sql)).toContain('SELECT *');
    expect(normalizeSql(sql)).toContain('FROM USERS');
  });

  it('SELECT with columns and alias', async () => {
    const ir = await parseSqlToIrLocal('SELECT name AS user_name, email FROM users', 'duckdb') as QueryIR;
    const sql = irToSqlLocal(ir, 'duckdb');
    expect(normalizeSql(sql)).toContain('NAME AS USER_NAME');
    expect(normalizeSql(sql)).toContain('EMAIL');
  });

  it('aggregates round-trip', async () => {
    const ir = await parseSqlToIrLocal('SELECT COUNT(*) AS total, SUM(amount) AS revenue FROM orders', 'duckdb') as QueryIR;
    const sql = irToSqlLocal(ir, 'duckdb');
    expect(normalizeSql(sql)).toContain('COUNT(*)');
    expect(normalizeSql(sql)).toContain('SUM(AMOUNT)');
  });

  it('COUNT DISTINCT round-trip', async () => {
    const ir = await parseSqlToIrLocal('SELECT COUNT(DISTINCT email) FROM users', 'duckdb') as QueryIR;
    const sql = irToSqlLocal(ir, 'duckdb');
    expect(normalizeSql(sql)).toContain('COUNT(DISTINCT EMAIL)');
  });

  it('JOIN round-trip', async () => {
    const original = 'SELECT u.name, o.amount FROM users u INNER JOIN orders o ON u.id = o.user_id';
    const ir = await parseSqlToIrLocal(original, 'duckdb') as QueryIR;
    const sql = irToSqlLocal(ir, 'duckdb');
    const norm = normalizeSql(sql);
    expect(norm).toContain('JOIN ORDERS O ON');
    expect(norm).toContain('U.ID = O.USER_ID');
  });

  it('LEFT JOIN round-trip', async () => {
    const original = 'SELECT * FROM users LEFT JOIN orders ON users.id = orders.user_id';
    const ir = await parseSqlToIrLocal(original, 'duckdb') as QueryIR;
    const sql = irToSqlLocal(ir, 'duckdb');
    expect(normalizeSql(sql)).toContain('LEFT JOIN');
  });

  it('WHERE round-trip', async () => {
    const original = "SELECT * FROM users WHERE active = true AND age > 18";
    const ir = await parseSqlToIrLocal(original, 'duckdb') as QueryIR;
    const sql = irToSqlLocal(ir, 'duckdb');
    const norm = normalizeSql(sql);
    expect(norm).toContain('WHERE');
    expect(norm).toContain('ACTIVE');
    expect(norm).toContain('AGE');
  });

  it('WHERE with param round-trip', async () => {
    const original = 'SELECT * FROM users WHERE id = :user_id';
    const ir = await parseSqlToIrLocal(original, 'duckdb') as QueryIR;
    const sql = irToSqlLocal(ir, 'duckdb');
    expect(normalizeSql(sql)).toContain(':USER_ID');
  });

  it('WHERE IS NULL / IS NOT NULL round-trip', async () => {
    const original = 'SELECT * FROM users WHERE deleted_at IS NULL AND email IS NOT NULL';
    const ir = await parseSqlToIrLocal(original, 'duckdb') as QueryIR;
    const sql = irToSqlLocal(ir, 'duckdb');
    const norm = normalizeSql(sql);
    expect(norm).toContain('IS NULL');
    expect(norm).toContain('IS NOT NULL');
  });

  it('WHERE IN round-trip', async () => {
    const original = "SELECT * FROM users WHERE status IN ('active', 'pending')";
    const ir = await parseSqlToIrLocal(original, 'duckdb') as QueryIR;
    const sql = irToSqlLocal(ir, 'duckdb');
    expect(normalizeSql(sql)).toContain('IN (');
  });

  it('WHERE with expression column (lower) round-trip', async () => {
    const original = "SELECT * FROM restaurants WHERE lower(city) = 'san francisco'";
    const ir = await parseSqlToIrLocal(original, 'duckdb') as QueryIR;
    const sql = irToSqlLocal(ir, 'duckdb');
    const norm = normalizeSql(sql);
    expect(norm).toContain('LOWER');
    expect(norm).toContain('SAN FRANCISCO');
  });

  it('GROUP BY round-trip', async () => {
    const original = 'SELECT category, COUNT(*) FROM products GROUP BY category';
    const ir = await parseSqlToIrLocal(original, 'duckdb') as QueryIR;
    const sql = irToSqlLocal(ir, 'duckdb');
    expect(normalizeSql(sql)).toContain('GROUP BY CATEGORY');
  });

  it('ORDER BY round-trip', async () => {
    const original = 'SELECT * FROM users ORDER BY name ASC, created_at DESC';
    const ir = await parseSqlToIrLocal(original, 'duckdb') as QueryIR;
    const sql = irToSqlLocal(ir, 'duckdb');
    const norm = normalizeSql(sql);
    expect(norm).toContain('ORDER BY');
    expect(norm).toContain('DESC');
  });

  it('LIMIT round-trip', async () => {
    const original = 'SELECT * FROM users LIMIT 10';
    const ir = await parseSqlToIrLocal(original, 'duckdb') as QueryIR;
    const sql = irToSqlLocal(ir, 'duckdb');
    expect(normalizeSql(sql)).toContain('LIMIT 10');
  });

  it('full query round-trip', async () => {
    const original = `
      SELECT u.name, COUNT(*) AS order_count, SUM(o.amount) AS total_amount
      FROM users u
      INNER JOIN orders o ON u.id = o.user_id
      WHERE u.active = true AND o.status = 'completed'
      GROUP BY u.name
      HAVING COUNT(*) > 5
      ORDER BY total_amount DESC
      LIMIT 20
    `;
    const ir = await parseSqlToIrLocal(original, 'duckdb') as QueryIR;
    const sql = irToSqlLocal(ir, 'duckdb');
    const norm = normalizeSql(sql);
    expect(norm).toContain('SELECT');
    expect(norm).toContain('FROM USERS U');
    expect(norm).toContain('JOIN ORDERS O');
    expect(norm).toContain('WHERE');
    expect(norm).toContain('GROUP BY');
    expect(norm).toContain('HAVING');
    expect(norm).toContain('ORDER BY');
    expect(norm).toContain('LIMIT 20');
  });

  it('CTE round-trip', async () => {
    const original = 'WITH active_users AS (SELECT * FROM users WHERE active = TRUE) SELECT * FROM active_users';
    const ir = await parseSqlToIrLocal(original, 'duckdb') as QueryIR;
    const sql = irToSqlLocal(ir, 'duckdb');
    const norm = normalizeSql(sql);
    expect(norm).toContain('WITH ACTIVE_USERS AS');
    expect(norm).toContain('FROM ACTIVE_USERS');
  });

  it('schema-qualified table round-trip', async () => {
    const ir = await parseSqlToIrLocal('SELECT * FROM public.users', 'duckdb') as QueryIR;
    const sql = irToSqlLocal(ir, 'duckdb');
    expect(normalizeSql(sql)).toContain('PUBLIC.USERS');
  });
});

// ---------------------------------------------------------------------------
// Ported from TestSQLRoundTrip (test_sql_ir_e2e.py)
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
// Ported from TestSemanticEquivalence (test_sql_ir_e2e.py)
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
// Ported from TestEdgeCases (test_sql_ir_e2e.py)
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
// Ported from TestDateTruncFilters (test_sql_ir_e2e.py)
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
// Ported from TestComplexExpressions (test_sql_ir_e2e.py)
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
});

// ---------------------------------------------------------------------------
// Ported from TestCompoundQueries (test_sql_ir_e2e.py)
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
