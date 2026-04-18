/**
 * Tests for parseSqlToIrLocal (polyglot WASM).
 * Ported from backend/tests/test_sql_ir_parser.py.
 */
import { parseSqlToIrLocal } from '../sql-to-ir';
import type { QueryIR, CompoundQueryIR } from '@/lib/sql/ir-types';

describe('Basic SELECT', () => {
  it('SELECT *', async () => {
    const ir = await parseSqlToIrLocal('SELECT * FROM users', 'duckdb') as QueryIR;
    expect(ir.select).toHaveLength(1);
    expect(ir.select[0].column).toBe('*');
    expect(ir.select[0].type).toBe('column');
    expect(ir.from.table).toBe('users');
  });

  it('SELECT with specific columns', async () => {
    const ir = await parseSqlToIrLocal('SELECT name, email FROM users', 'duckdb') as QueryIR;
    expect(ir.select).toHaveLength(2);
    expect(ir.select[0].column).toBe('name');
    expect(ir.select[1].column).toBe('email');
  });

  it('SELECT with column alias', async () => {
    const ir = await parseSqlToIrLocal('SELECT name AS user_name, email FROM users', 'duckdb') as QueryIR;
    expect(ir.select[0].alias).toBe('user_name');
    expect(ir.select[0].column).toBe('name');
  });

  it('SELECT with table.column', async () => {
    const ir = await parseSqlToIrLocal('SELECT users.name, users.email FROM users', 'duckdb') as QueryIR;
    expect(ir.select[0].table).toBe('users');
    expect(ir.select[0].column).toBe('name');
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
    const sql = `SELECT * FROM users u INNER JOIN orders o ON u.id = o.user_id AND u.company_id = o.company_id`;
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
});
