/**
 * E2E Tests for SQL IR Completions Module
 * Tests sqlToIR and irToSql methods at the completions API level
 */

import { withPythonBackend } from '@/test/harness/python-backend';
import { setupMockFetch } from '@/test/harness/mock-fetch';
import { setupTestDb } from '@/test/harness/test-db';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { POST as sqlToIRHandler } from '@/app/api/sql-to-ir/route';
import { POST as irToSqlHandler } from '@/app/api/ir-to-sql/route';
import { CompletionsAPI } from '../completions';
import { QueryIR } from '@/lib/sql/ir-types';

describe('Completions SQL IR - E2E Tests', () => {
  const { getPythonPort } = withPythonBackend();
  setupTestDb(getTestDbPath('sql_ir_completions'));

  // Mock fetch with route interceptors (same pattern as chatE2E)
  const mockFetch = setupMockFetch({
    getPythonPort,
    interceptors: [
      {
        includesUrl: ['localhost:3000/api/sql-to-ir'],
        startsWithUrl: ['/api/sql-to-ir'],
        handler: sqlToIRHandler
      },
      {
        includesUrl: ['localhost:3000/api/ir-to-sql'],
        startsWithUrl: ['/api/ir-to-sql'],
        handler: irToSqlHandler
      }
    ]
  });

  beforeEach(() => {
    mockFetch.mockClear();
  });

  describe('Case 1: sqlToIR covering full spec', () => {
    it('should parse complex query with all supported features', async () => {
      const complexSQL = `
        SELECT
          u.name,
          u.email,
          COUNT(*) AS order_count,
          SUM(o.amount) AS total_amount,
          AVG(o.amount) AS avg_amount
        FROM users u
        INNER JOIN orders o ON u.id = o.user_id
        LEFT JOIN categories c ON o.category_id = c.id
        WHERE u.active = true
          AND o.status IN ('completed', 'shipped')
          AND o.amount >= 100
          AND o.created_at IS NOT NULL
        GROUP BY u.name, u.email
        ORDER BY total_amount DESC, order_count ASC
        LIMIT 50
      `;

      const result = await CompletionsAPI.sqlToIR({ sql: complexSQL });

      expect(result.success).toBe(true);
      expect(result.ir).toBeDefined();

      const ir = result.ir!;

      // Verify SELECT clause
      expect(ir.select).toHaveLength(5);
      expect(ir.select[0]).toMatchObject({
        type: 'column',
        column: 'name',
        table: 'u'
      });
      expect(ir.select[2]).toMatchObject({
        type: 'aggregate',
        aggregate: 'COUNT',
        column: null,  // null indicates COUNT(*)
        alias: 'order_count'
      });
      expect(ir.select[3]).toMatchObject({
        type: 'aggregate',
        aggregate: 'SUM',
        column: 'amount',
        table: 'o',
        alias: 'total_amount'
      });

      // Verify FROM clause
      expect(ir.from).toMatchObject({
        table: 'users',
        alias: 'u'
      });

      // Verify JOINs
      expect(ir.joins).toHaveLength(2);
      expect(ir.joins![0]).toMatchObject({
        type: 'INNER',
        table: {
          table: 'orders',
          alias: 'o'
        }
      });
      expect(ir.joins![1]).toMatchObject({
        type: 'LEFT',
        table: {
          table: 'categories',
          alias: 'c'
        }
      });

      // Verify WHERE clause
      expect(ir.where).toBeDefined();
      expect(ir.where!.operator).toBe('AND');
      expect(ir.where!.conditions.length).toBeGreaterThan(0);

      // Verify GROUP BY
      expect(ir.group_by).toBeDefined();
      expect(ir.group_by!.columns).toHaveLength(2);

      // Verify ORDER BY
      expect(ir.order_by).toHaveLength(2);
      expect(ir.order_by![0]).toMatchObject({
        column: 'total_amount',
        direction: 'DESC'
      });
      expect(ir.order_by![1]).toMatchObject({
        column: 'order_count',
        direction: 'ASC'
      });

      // Verify LIMIT
      expect(ir.limit).toBe(50);
    });

    it('should parse query with COUNT DISTINCT', async () => {
      const sql = 'SELECT category, COUNT(DISTINCT user_id) AS unique_users FROM orders GROUP BY category';

      const result = await CompletionsAPI.sqlToIR({ sql });

      expect(result.success).toBe(true);
      expect(result.ir!.select[1]).toMatchObject({
        type: 'aggregate',
        aggregate: 'COUNT_DISTINCT',
        column: 'user_id',
        alias: 'unique_users'
      });
    });

    it('should parse query with parameters', async () => {
      const sql = 'SELECT * FROM products WHERE price >= :min_price AND price <= :max_price';

      const result = await CompletionsAPI.sqlToIR({ sql });

      expect(result.success).toBe(true);
      expect(result.ir!.where).toBeDefined();

      // Find parameter conditions
      const conditions = result.ir!.where!.conditions;
      const paramConditions = conditions.filter((c: any) => c.param_name);
      expect(paramConditions.length).toBeGreaterThanOrEqual(2);
    });

    it('should parse query with IS NULL and IS NOT NULL', async () => {
      const sql = 'SELECT * FROM users WHERE deleted_at IS NULL AND email IS NOT NULL';

      const result = await CompletionsAPI.sqlToIR({ sql });

      expect(result.success).toBe(true);
      expect(result.ir!.where).toBeDefined();

      const conditions = result.ir!.where!.conditions;
      expect(conditions.some((c: any) => c.operator === 'IS NULL')).toBe(true);
      expect(conditions.some((c: any) => c.operator === 'IS NOT NULL')).toBe(true);
    });
  });

  describe('Case 2: sqlToIR handling unsupported SQL', () => {
    it('should reject query with subquery', async () => {
      const sql = 'SELECT * FROM users WHERE id IN (SELECT user_id FROM orders)';

      const result = await CompletionsAPI.sqlToIR({ sql });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.unsupportedFeatures).toContain('Subqueries');
      expect(result.hint).toBeDefined();
    });

    it('should reject query with CTE', async () => {
      const sql = `
        WITH active_users AS (
          SELECT * FROM users WHERE active = true
        )
        SELECT * FROM active_users
      `;

      const result = await CompletionsAPI.sqlToIR({ sql });

      expect(result.success).toBe(false);
      expect(result.unsupportedFeatures).toContain('WITH clauses (CTEs)');
    });

    it('should reject query with UNION', async () => {
      const sql = 'SELECT * FROM users UNION SELECT * FROM admins';

      const result = await CompletionsAPI.sqlToIR({ sql });

      expect(result.success).toBe(false);
      expect(result.unsupportedFeatures).toContain('UNION');
    });

    it('should reject query with CASE expression', async () => {
      const sql = "SELECT CASE WHEN age > 18 THEN 'adult' ELSE 'minor' END FROM users";

      const result = await CompletionsAPI.sqlToIR({ sql });

      expect(result.success).toBe(false);
      expect(result.unsupportedFeatures).toContain('CASE expressions');
    });

    it('should reject query with window function', async () => {
      const sql = 'SELECT name, ROW_NUMBER() OVER (ORDER BY created_at) FROM users';

      const result = await CompletionsAPI.sqlToIR({ sql });

      expect(result.success).toBe(false);
      expect(result.unsupportedFeatures).toContain('Window functions');
    });

    it('should reject invalid SQL syntax', async () => {
      const sql = 'SELECT INVALID SYNTAX FROM';

      const result = await CompletionsAPI.sqlToIR({ sql });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('Case 3: irToSql covering full spec', () => {
    it('should generate SQL from complete IR', async () => {
      const ir: QueryIR = {
        version: 1,
        select: [
          { type: 'column', column: 'name', table: 'u' },
          { type: 'aggregate', aggregate: 'COUNT', column: '*', alias: 'total' },
          { type: 'aggregate', aggregate: 'SUM', column: 'amount', table: 'o', alias: 'sum_amount' }
        ],
        from: {
          table: 'users',
          alias: 'u'
        },
        joins: [
          {
            type: 'INNER',
            table: { table: 'orders', alias: 'o' },
            on: [
              {
                left_table: 'u',
                left_column: 'id',
                right_table: 'o',
                right_column: 'user_id'
              }
            ]
          }
        ],
        where: {
          operator: 'AND',
          conditions: [
            { column: 'active', table: 'u', operator: '=', value: 'true' },
            { column: 'amount', table: 'o', operator: '>=', value: 100 }
          ]
        },
        group_by: {
          columns: [{ column: 'name', table: 'u' }]
        },
        order_by: [
          { column: 'sum_amount', direction: 'DESC' }
        ],
        limit: 10
      };

      const result = await CompletionsAPI.irToSql({ ir });

      expect(result.success).toBe(true);
      expect(result.sql).toBeDefined();

      const sql = result.sql!;

      // Verify SQL contains expected components
      expect(sql).toContain('SELECT');
      expect(sql).toContain('u.name');
      expect(sql).toContain('COUNT(*)');
      expect(sql).toContain('SUM(o.amount)');
      expect(sql).toContain('FROM users u');
      expect(sql).toContain('INNER JOIN orders o');
      expect(sql).toContain('ON u.id = o.user_id');
      expect(sql).toContain('WHERE');
      expect(sql).toContain('u.active =');
      expect(sql).toContain('o.amount >= 100');
      expect(sql).toContain('GROUP BY u.name');
      expect(sql).toContain('ORDER BY sum_amount DESC');
      expect(sql).toContain('LIMIT 10');
    });

    it('should generate SQL with COUNT DISTINCT', async () => {
      const ir: QueryIR = {
        version: 1,
        select: [
          { type: 'aggregate', aggregate: 'COUNT_DISTINCT', column: 'user_id', alias: 'unique_users' }
        ],
        from: { table: 'orders' }
      };

      const result = await CompletionsAPI.irToSql({ ir });

      expect(result.success).toBe(true);
      expect(result.sql).toContain('COUNT(DISTINCT user_id)');
    });

    it('should generate SQL with parameters', async () => {
      const ir: QueryIR = {
        version: 1,
        select: [{ type: 'column', column: '*' }],
        from: { table: 'products' },
        where: {
          operator: 'AND',
          conditions: [
            { column: 'price', operator: '>=', param_name: 'min_price' },
            { column: 'price', operator: '<=', param_name: 'max_price' }
          ]
        }
      };

      const result = await CompletionsAPI.irToSql({ ir });

      expect(result.success).toBe(true);
      expect(result.sql).toContain(':min_price');
      expect(result.sql).toContain(':max_price');
    });

    it('should generate SQL with IS NULL and IS NOT NULL', async () => {
      const ir: QueryIR = {
        version: 1,
        select: [{ type: 'column', column: '*' }],
        from: { table: 'users' },
        where: {
          operator: 'AND',
          conditions: [
            { column: 'deleted_at', operator: 'IS NULL' },
            { column: 'email', operator: 'IS NOT NULL' }
          ]
        }
      };

      const result = await CompletionsAPI.irToSql({ ir });

      expect(result.success).toBe(true);
      expect(result.sql).toContain('deleted_at IS NULL');
      expect(result.sql).toContain('email IS NOT NULL');
    });

    it('should generate SQL with IN operator', async () => {
      const ir: QueryIR = {
        version: 1,
        select: [{ type: 'column', column: '*' }],
        from: { table: 'products' },
        where: {
          operator: 'AND',
          conditions: [
            { column: 'status', operator: 'IN', value: ['active', 'pending'] }
          ]
        }
      };

      const result = await CompletionsAPI.irToSql({ ir });

      expect(result.success).toBe(true);
      expect(result.sql).toContain("IN ('active', 'pending')");
    });

    it('should generate SQL with LEFT JOIN', async () => {
      const ir: QueryIR = {
        version: 1,
        select: [{ type: 'column', column: '*' }],
        from: { table: 'users' },
        joins: [
          {
            type: 'LEFT',
            table: { table: 'orders' },
            on: [{ left_table: 'users', left_column: 'id', right_table: 'orders', right_column: 'user_id' }]
          }
        ]
      };

      const result = await CompletionsAPI.irToSql({ ir });

      expect(result.success).toBe(true);
      expect(result.sql).toContain('LEFT JOIN');
    });

    it('should generate SQL with schema-qualified table', async () => {
      const ir: QueryIR = {
        version: 1,
        select: [{ type: 'column', column: '*' }],
        from: { table: 'users', schema: 'public' }
      };

      const result = await CompletionsAPI.irToSql({ ir });

      expect(result.success).toBe(true);
      expect(result.sql).toContain('public.users');
    });
  });

  describe('Case 4: irToSql handling invalid IR', () => {
    it('should handle missing required fields gracefully', async () => {
      const invalidIR = {
        version: 1,
        select: []
        // Missing 'from' field
      } as any;

      const result = await CompletionsAPI.irToSql({ ir: invalidIR });

      // Should still attempt to generate, but may produce invalid SQL
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle malformed filter conditions', async () => {
      const ir: QueryIR = {
        version: 1,
        select: [{ type: 'column', column: '*' }],
        from: { table: 'users' },
        where: {
          operator: 'AND',
          conditions: [
            { column: '', operator: '=', value: 'test' } // Empty column name
          ]
        }
      };

      const result = await CompletionsAPI.irToSql({ ir });

      // Generator should still work, but SQL may be invalid
      expect(result.success).toBe(true); // Generator doesn't validate, just converts
      expect(result.sql).toBeDefined();
    });

    it('should handle empty IR gracefully', async () => {
      const ir: QueryIR = {
        version: 1,
        select: [{ type: 'column', column: '*' }],
        from: { table: 'users' }
      };

      const result = await CompletionsAPI.irToSql({ ir });

      expect(result.success).toBe(true);
      // Generated SQL may have newlines for formatting
      const normalizedSql = result.sql!.replace(/\s+/g, ' ');
      expect(normalizedSql).toContain('SELECT *');
      expect(normalizedSql).toContain('FROM users');
    });
  });

  describe('Round-trip validation', () => {
    it('should successfully round-trip: SQL → IR → SQL', async () => {
      const originalSQL = `
        SELECT u.name, COUNT(*) AS total
        FROM users u
        WHERE u.active = true
        GROUP BY u.name
        ORDER BY total DESC
        LIMIT 10
      `;

      // Parse to IR
      const parseResult = await CompletionsAPI.sqlToIR({ sql: originalSQL });
      expect(parseResult.success).toBe(true);

      // Generate SQL from IR
      const generateResult = await CompletionsAPI.irToSql({ ir: parseResult.ir! });
      expect(generateResult.success).toBe(true);

      const regeneratedSQL = generateResult.sql!;

      // Verify key components are preserved
      expect(regeneratedSQL).toContain('u.name');
      expect(regeneratedSQL).toContain('COUNT(*)');
      expect(regeneratedSQL).toContain('FROM users u');
      expect(regeneratedSQL).toContain('WHERE u.active');
      expect(regeneratedSQL).toContain('GROUP BY u.name');
      expect(regeneratedSQL).toContain('ORDER BY total DESC');
      expect(regeneratedSQL).toContain('LIMIT 10');
    });
  });

  // ========================================================================
  // LOSSLESSNESS TESTS
  // Tests for binary support boundary: supported SQL MUST be fully lossless
  // ========================================================================

  describe('Losslessness: Information Loss Detection', () => {
    describe('CRITICAL: SELECT DISTINCT support', () => {
      it('should preserve SELECT DISTINCT in IR', async () => {
        const sql = 'SELECT DISTINCT status FROM orders';

        const result = await CompletionsAPI.sqlToIR({ sql });

        expect(result.success).toBe(true);
        expect(result.ir).toBeDefined();
        expect(result.ir!.distinct).toBe(true);
      });

      it('should generate SELECT DISTINCT from IR', async () => {
        const ir: QueryIR = {
          version: 1,
          distinct: true,
          select: [{ type: 'column', column: 'status' }],
          from: { table: 'orders' }
        };

        const result = await CompletionsAPI.irToSql({ ir });

        expect(result.success).toBe(true);
        expect(result.sql).toContain('SELECT DISTINCT');
      });

      it('should round-trip SELECT DISTINCT without loss', async () => {
        const originalSQL = 'SELECT DISTINCT category FROM products';

        const parseResult = await CompletionsAPI.sqlToIR({ sql: originalSQL });
        expect(parseResult.success).toBe(true);

        const generateResult = await CompletionsAPI.irToSql({ ir: parseResult.ir! });
        expect(generateResult.success).toBe(true);

        const regeneratedSQL = generateResult.sql!;
        expect(regeneratedSQL).toContain('SELECT DISTINCT');
        expect(regeneratedSQL.toUpperCase()).toMatch(/SELECT\s+DISTINCT/);
      });
    });

    describe('CRITICAL: COUNT(*) vs COUNT(column) distinction', () => {
      it('should preserve COUNT(*) in IR', async () => {
        const sql = 'SELECT COUNT(*) FROM users';

        const result = await CompletionsAPI.sqlToIR({ sql });

        expect(result.success).toBe(true);
        expect(result.ir).toBeDefined();
        expect(result.ir!.select[0].type).toBe('aggregate');
        expect(result.ir!.select[0].aggregate).toBe('COUNT');
        expect(result.ir!.select[0].column).toBeNull(); // null indicates COUNT(*)
      });

      it('should preserve COUNT(column) in IR', async () => {
        const sql = 'SELECT COUNT(id) FROM users';

        const result = await CompletionsAPI.sqlToIR({ sql });

        expect(result.success).toBe(true);
        expect(result.ir!.select[0].type).toBe('aggregate');
        expect(result.ir!.select[0].aggregate).toBe('COUNT');
        expect(result.ir!.select[0].column).toBe('id');
      });

      it('should generate COUNT(*) from IR with null column', async () => {
        const ir: QueryIR = {
          version: 1,
          select: [
            {
              type: 'aggregate',
              aggregate: 'COUNT',
              column: null  // null indicates COUNT(*)
            }
          ],
          from: { table: 'users' }
        };

        const result = await CompletionsAPI.irToSql({ ir });

        expect(result.success).toBe(true);
        expect(result.sql).toContain('COUNT(*)');
      });

      it('should round-trip COUNT(*) vs COUNT(column) without confusion', async () => {
        // Test COUNT(*)
        const countStarSQL = 'SELECT COUNT(*) FROM users';
        const countStarParse = await CompletionsAPI.sqlToIR({ sql: countStarSQL });
        const countStarGenerate = await CompletionsAPI.irToSql({ ir: countStarParse.ir! });

        expect(countStarGenerate.sql).toContain('COUNT(*)');

        // Test COUNT(column)
        const countColSQL = 'SELECT COUNT(name) FROM users';
        const countColParse = await CompletionsAPI.sqlToIR({ sql: countColSQL });
        const countColGenerate = await CompletionsAPI.irToSql({ ir: countColParse.ir! });

        expect(countColGenerate.sql).toContain('COUNT(name)');
        expect(countColGenerate.sql).not.toContain('COUNT(*)');
      });
    });

    describe('Acceptable Losses (Non-Semantic)', () => {
      it('should NOT preserve SQL comments (acceptable loss)', async () => {
        const sql = `
          -- This is a comment
          SELECT name /* inline comment */ FROM users
        `;

        const parseResult = await CompletionsAPI.sqlToIR({ sql });
        const generateResult = await CompletionsAPI.irToSql({ ir: parseResult.ir! });

        // Comments are lost, but this is acceptable (doesn't affect query semantics)
        expect(generateResult.sql).not.toContain('--');
        expect(generateResult.sql).not.toContain('/*');
      });

      it('should NOT preserve exact formatting (acceptable loss)', async () => {
        const sql = 'SELECT    name,email   FROM     users';

        const parseResult = await CompletionsAPI.sqlToIR({ sql });
        const generateResult = await CompletionsAPI.irToSql({ ir: parseResult.ir! });

        // Formatting changes are acceptable (doesn't affect query semantics)
        // Generated SQL will have standardized formatting
        expect(generateResult.sql).toContain('SELECT');
        expect(generateResult.sql).toContain('name');
        expect(generateResult.sql).toContain('email');
        expect(generateResult.sql).toContain('FROM users');
      });

      it('should normalize boolean values (acceptable change)', async () => {
        const sql = 'SELECT * FROM users WHERE active = true';

        const parseResult = await CompletionsAPI.sqlToIR({ sql });
        const generateResult = await CompletionsAPI.irToSql({ ir: parseResult.ir! });

        // May normalize true → TRUE or true or 'TRUE', but semantically equivalent
        // Currently converts to string 'TRUE' which is acceptable for most databases
        expect(generateResult.sql).toMatch(/active\s*=\s*('TRUE'|true|TRUE)/i);
      });
    });
  });

  describe('Losslessness: Binary Support Boundary (Reject Unsupported)', () => {
    describe('Complex aggregate expressions (MUST reject)', () => {
      it('should reject SUM(col1 * col2)', async () => {
        const sql = 'SELECT SUM(price * quantity) AS total FROM orders';

        const result = await CompletionsAPI.sqlToIR({ sql });
        expect(result.success).toBe(false);
        expect(result.unsupportedFeatures).toContain('Complex aggregate expressions (e.g., SUM(col1 * col2))');
        expect(result.hint).toBeDefined();
      });

      it('should reject COUNT(CASE WHEN ...)', async () => {
        const sql = "SELECT COUNT(CASE WHEN status = 'active' THEN 1 END) FROM users";

        const result = await CompletionsAPI.sqlToIR({ sql });

        // Should be rejected (contains CASE in aggregate)
        expect(result.success).toBe(false);
        expect(result.unsupportedFeatures).toContain('CASE in aggregates (e.g., COUNT(CASE WHEN ...))');
      });

      it('should reject AVG(col1 + col2)', async () => {
        const sql = 'SELECT AVG(price + tax) AS avg_total FROM products';

        const result = await CompletionsAPI.sqlToIR({ sql });
        expect(result.success).toBe(false);
        expect(result.unsupportedFeatures).toContain('Complex aggregate expressions (e.g., SUM(col1 * col2))');
      });
    });

    describe('Complex filter expressions (MUST reject)', () => {
      it('should reject WHERE col1 + col2 > value', async () => {
        const sql = 'SELECT * FROM users WHERE age + 5 > 30';

        const result = await CompletionsAPI.sqlToIR({ sql });
        expect(result.success).toBe(false);
        expect(result.unsupportedFeatures).toContain('Complex expressions in filters (e.g., col1 + col2 > 10)');
      });

      it('should reject WHERE with arithmetic on both sides', async () => {
        const sql = 'SELECT * FROM products WHERE price * 1.1 > cost * 1.2';

        const result = await CompletionsAPI.sqlToIR({ sql });
        expect(result.success).toBe(false);
      });
    });

    describe('Unsupported operators (MUST reject)', () => {
      it('should reject BETWEEN operator', async () => {
        const sql = 'SELECT * FROM users WHERE age BETWEEN 20 AND 30';

        const result = await CompletionsAPI.sqlToIR({ sql });
        expect(result.success).toBe(false);
        expect(result.unsupportedFeatures).toContain('BETWEEN (use >= and <= instead)');
        expect(result.hint).toContain('Use >= and <=');
      });

      it('should reject NOT LIKE operator', async () => {
        const sql = "SELECT * FROM users WHERE name NOT LIKE 'A%'";

        const result = await CompletionsAPI.sqlToIR({ sql });
        expect(result.success).toBe(false);
        expect(result.unsupportedFeatures).toContain('NOT LIKE');
      });

      it('should reject NOT IN operator', async () => {
        const sql = "SELECT * FROM users WHERE status NOT IN ('deleted', 'banned')";

        const result = await CompletionsAPI.sqlToIR({ sql });
        expect(result.success).toBe(false);
        expect(result.unsupportedFeatures).toContain('NOT IN');
      });

      it('should reject regex operators', async () => {
        const sql = "SELECT * FROM users WHERE email ~ '^[a-z]+@'";

        const result = await CompletionsAPI.sqlToIR({ sql });
        expect(result.success).toBe(false);
        expect(result.unsupportedFeatures).toContain('Regex operators (~, ~*, etc.)');
      });
    });
  });

  describe('Losslessness: Semantic Equivalence (All Supported Features)', () => {
    describe('Basic queries preserve semantics', () => {
      const supportedQueries = [
        {
          name: 'SELECT *',
          sql: 'SELECT * FROM users',
          checks: ['SELECT', '*', 'FROM users']
        },
        {
          name: 'SELECT columns',
          sql: 'SELECT name, email FROM users',
          checks: ['name', 'email']
        },
        {
          name: 'SELECT with table qualifier',
          sql: 'SELECT users.name, users.email FROM users',
          checks: ['users.name', 'users.email']
        },
        {
          name: 'SELECT with aliases',
          sql: 'SELECT name AS user_name, email AS user_email FROM users',
          checks: ['user_name', 'user_email']
        }
      ];

      supportedQueries.forEach(({ name, sql, checks }) => {
        it(`should preserve semantics for: ${name}`, async () => {
          const parseResult = await CompletionsAPI.sqlToIR({ sql });
          expect(parseResult.success).toBe(true);

          const generateResult = await CompletionsAPI.irToSql({ ir: parseResult.ir! });
          expect(generateResult.success).toBe(true);

          // Verify key components are present
          checks.forEach(check => {
            expect(generateResult.sql).toContain(check);
          });
        });
      });
    });

    describe('Aggregate queries preserve semantics', () => {
      const aggregateQueries = [
        {
          name: 'Multiple aggregates',
          sql: 'SELECT COUNT(*), SUM(amount), AVG(amount), MIN(amount), MAX(amount) FROM orders',
          checks: ['COUNT(*)', 'SUM(amount)', 'AVG(amount)', 'MIN(amount)', 'MAX(amount)']
        },
        {
          name: 'Aggregate with GROUP BY',
          sql: 'SELECT status, COUNT(*) FROM orders GROUP BY status',
          checks: ['status', 'COUNT(*)', 'GROUP BY status']
        }
      ];

      aggregateQueries.forEach(({ name, sql, checks }) => {
        it(`should preserve semantics for: ${name}`, async () => {
          const parseResult = await CompletionsAPI.sqlToIR({ sql });
          expect(parseResult.success).toBe(true);

          const generateResult = await CompletionsAPI.irToSql({ ir: parseResult.ir! });
          expect(generateResult.success).toBe(true);

          checks.forEach(check => {
            expect(generateResult.sql).toContain(check);
          });
        });
      });
    });

    describe('Filter queries preserve semantics', () => {
      const filterQueries = [
        {
          name: 'Simple equality',
          sql: 'SELECT * FROM users WHERE active = true',
          checks: ['active']
        },
        {
          name: 'Inequality',
          sql: 'SELECT * FROM users WHERE age > 18',
          checks: ['age', '>']
        },
        {
          name: 'Multiple conditions (AND)',
          sql: 'SELECT * FROM users WHERE age > 18 AND status = \'active\'',
          checks: ['age', 'status', 'AND']
        },
        {
          name: 'Multiple conditions (OR)',
          sql: 'SELECT * FROM users WHERE age < 18 OR age > 65',
          checks: ['age', 'OR']
        },
        {
          name: 'LIKE operator',
          sql: "SELECT * FROM users WHERE name LIKE 'A%'",
          checks: ['name', 'LIKE']
        },
        {
          name: 'IN operator',
          sql: "SELECT * FROM users WHERE status IN ('active', 'pending')",
          checks: ['status', 'IN']
        },
        {
          name: 'Parameters',
          sql: 'SELECT * FROM users WHERE age >= :min_age AND age <= :max_age',
          checks: [':min_age', ':max_age']
        }
      ];

      filterQueries.forEach(({ name, sql, checks }) => {
        it(`should preserve semantics for: ${name}`, async () => {
          const parseResult = await CompletionsAPI.sqlToIR({ sql });
          expect(parseResult.success).toBe(true);

          const generateResult = await CompletionsAPI.irToSql({ ir: parseResult.ir! });
          expect(generateResult.success).toBe(true);

          checks.forEach(check => {
            expect(generateResult.sql).toContain(check);
          });
        });
      });
    });

    describe('JOIN queries preserve semantics', () => {
      it('should preserve INNER JOIN semantics', async () => {
        const sql = 'SELECT u.name, o.amount FROM users u INNER JOIN orders o ON u.id = o.user_id';

        const parseResult = await CompletionsAPI.sqlToIR({ sql });
        expect(parseResult.success).toBe(true);

        const generateResult = await CompletionsAPI.irToSql({ ir: parseResult.ir! });
        expect(generateResult.success).toBe(true);

        expect(generateResult.sql).toContain('INNER JOIN');
        expect(generateResult.sql).toContain('users');
        expect(generateResult.sql).toContain('orders');
        expect(generateResult.sql).toContain('u.id');
        expect(generateResult.sql).toContain('o.user_id');
      });

      it('should preserve multiple JOINs', async () => {
        const sql = `
          SELECT u.name, o.amount, c.name
          FROM users u
          INNER JOIN orders o ON u.id = o.user_id
          LEFT JOIN categories c ON o.category_id = c.id
        `;

        const parseResult = await CompletionsAPI.sqlToIR({ sql });
        expect(parseResult.success).toBe(true);

        const generateResult = await CompletionsAPI.irToSql({ ir: parseResult.ir! });
        expect(generateResult.success).toBe(true);

        expect(generateResult.sql).toContain('INNER JOIN');
        expect(generateResult.sql).toContain('LEFT JOIN');
        expect(generateResult.sql).toContain('categories');
      });
    });

    describe('ORDER BY and LIMIT preserve semantics', () => {
      it('should preserve ORDER BY with direction', async () => {
        const sql = 'SELECT * FROM users ORDER BY name ASC';

        const parseResult = await CompletionsAPI.sqlToIR({ sql });
        const generateResult = await CompletionsAPI.irToSql({ ir: parseResult.ir! });

        expect(generateResult.sql).toContain('ORDER BY');
        expect(generateResult.sql).toContain('name');
        expect(generateResult.sql).toContain('ASC');
      });

      it('should preserve multiple ORDER BY columns', async () => {
        const sql = 'SELECT * FROM users ORDER BY last_name ASC, first_name ASC';

        const parseResult = await CompletionsAPI.sqlToIR({ sql });
        const generateResult = await CompletionsAPI.irToSql({ ir: parseResult.ir! });

        expect(generateResult.sql).toContain('ORDER BY');
        expect(generateResult.sql).toContain('last_name');
        expect(generateResult.sql).toContain('first_name');
      });

      it('should preserve LIMIT', async () => {
        const sql = 'SELECT * FROM users LIMIT 100';

        const parseResult = await CompletionsAPI.sqlToIR({ sql });
        const generateResult = await CompletionsAPI.irToSql({ ir: parseResult.ir! });

        expect(generateResult.sql).toContain('LIMIT 100');
      });
    });

    describe('Complex queries preserve semantics', () => {
      it('should preserve full-featured query semantics', async () => {
        const sql = `
          SELECT
            u.name,
            u.email,
            COUNT(*) AS order_count,
            SUM(o.amount) AS total_amount
          FROM users u
          INNER JOIN orders o ON u.id = o.user_id
          WHERE u.active = true
            AND o.status = 'completed'
            AND o.amount >= 100
          GROUP BY u.name, u.email
          HAVING COUNT(*) > 5
          ORDER BY total_amount DESC
          LIMIT 10
        `;

        const parseResult = await CompletionsAPI.sqlToIR({ sql });
        expect(parseResult.success).toBe(true);

        const generateResult = await CompletionsAPI.irToSql({ ir: parseResult.ir! });
        expect(generateResult.success).toBe(true);

        const checks = [
          'u.name',
          'u.email',
          'COUNT(*)',
          'SUM(o.amount)',
          'users',
          'INNER JOIN',
          'orders',
          'WHERE',
          'u.active',
          'GROUP BY',
          'HAVING',
          'ORDER BY',
          'DESC',
          'LIMIT 10'
        ];

        checks.forEach(check => {
          expect(generateResult.sql).toContain(check);
        });
      });
    });
  });

  describe('Losslessness: Textual Preservation (Dirty Tracking)', () => {
    it('should detect IR is unchanged (deep equality)', () => {
      const ir: QueryIR = {
        version: 1,
        select: [{ type: 'column', column: 'name' }],
        from: { table: 'users' }
      };

      // Deep clone to simulate "unchanged" IR
      const unchangedIR = JSON.parse(JSON.stringify(ir));

      // Stable serialization for comparison
      const serialize = (obj: any) => JSON.stringify(obj, Object.keys(obj).sort());

      expect(serialize(ir)).toBe(serialize(unchangedIR));
    });

    it('should detect IR has changed (deep equality)', () => {
      const originalIR: QueryIR = {
        version: 1,
        select: [{ type: 'column', column: 'name' }],
        from: { table: 'users' }
      };

      const modifiedIR: QueryIR = {
        version: 1,
        select: [{ type: 'column', column: 'name' }, { type: 'column', column: 'email' }],
        from: { table: 'users' }
      };

      const serialize = (obj: any) => JSON.stringify(obj, Object.keys(obj).sort());

      expect(serialize(originalIR)).not.toBe(serialize(modifiedIR));
    });

    it('should document expected behavior: preserve original SQL when IR unchanged', async () => {
      const originalSQL = 'SELECT name, email FROM users WHERE active = true';

      // Parse to IR
      const parseResult = await CompletionsAPI.sqlToIR({ sql: originalSQL });
      expect(parseResult.success).toBe(true);

      const originalIR = parseResult.ir!;

      // Simulate: User opens GUI, makes no changes, closes GUI
      // In this case, we want to return originalSQL, not regenerated SQL

      // Deep clone IR (simulates no changes)
      const unchangedIR = JSON.parse(JSON.stringify(originalIR));

      // Check if IR is dirty
      const serialize = (obj: any) => JSON.stringify(obj, Object.keys(obj).sort());
      const isDirty = serialize(originalIR) !== serialize(unchangedIR);

      expect(isDirty).toBe(false);

      // Expected behavior: When not dirty, QueryBuilder should return originalSQL
      // When dirty, QueryBuilder should generate new SQL from IR
      // This will be implemented in QueryBuilder component with state tracking
    });

    describe('Formatting differences in regenerated SQL', () => {
      it('should normalize formatting in regenerated SQL', async () => {
        const originalSQL = 'SELECT    name,email   FROM     users   WHERE active=true';

        const parseResult = await CompletionsAPI.sqlToIR({ sql: originalSQL });
        const generateResult = await CompletionsAPI.irToSql({ ir: parseResult.ir! });

        // Regenerated SQL will have standardized formatting
        // This is acceptable - only semantic equivalence matters for dirty IR
        expect(generateResult.sql).not.toBe(originalSQL);
        expect(generateResult.sql).toContain('SELECT');
        expect(generateResult.sql).toContain('name');
        expect(generateResult.sql).toContain('email');
        expect(generateResult.sql).toContain('FROM users');
      });

      it('should normalize case in regenerated SQL', async () => {
        const originalSQL = 'select name from users where active = TRUE';

        const parseResult = await CompletionsAPI.sqlToIR({ sql: originalSQL });
        const generateResult = await CompletionsAPI.irToSql({ ir: parseResult.ir! });

        // Generated SQL uses uppercase keywords
        expect(generateResult.sql).toContain('SELECT');
        expect(generateResult.sql).toContain('FROM');
        expect(generateResult.sql).toContain('WHERE');
      });
    });
  });

  describe('Losslessness: Edge Cases', () => {
    it('should handle string escaping correctly', async () => {
      const sql = "SELECT * FROM users WHERE name = 'O''Brien'";

      const parseResult = await CompletionsAPI.sqlToIR({ sql });
      const generateResult = await CompletionsAPI.irToSql({ ir: parseResult.ir! });

      // Should preserve string escaping
      expect(generateResult.sql).toMatch(/O''Brien|O\\'Brien/);
    });

    it('should preserve string literal in HAVING (not coerce to number)', async () => {
      // Regression: HAVING AVG(col) > '75' was coercing '75' to 75 (number),
      // causing round-trip failure due to '75' vs 75 in normalized SQL.
      const sql = `SELECT
  AVG(avg_order_value) AS avg_avg_order_value,
  DATE_TRUNC('WEEK', week_start) AS week_start_week
FROM orders
GROUP BY DATE_TRUNC('WEEK', week_start)
HAVING AVG(avg_order_value) > '75'`;

      const parseResult = await CompletionsAPI.sqlToIR({ sql });
      expect(parseResult.success).toBe(true);
      expect(parseResult.ir).toBeDefined();

      // HAVING value should be preserved as string '75'
      const havingCond = parseResult.ir!.having?.conditions?.[0] as any;
      expect(havingCond?.value).toBe('75');
      expect(typeof havingCond?.value).toBe('string');

      const generateResult = await CompletionsAPI.irToSql({ ir: parseResult.ir! });
      expect(generateResult.success).toBe(true);
      // Must regenerate with quoted '75', not numeric 75
      expect(generateResult.sql).toContain("'75'");
    });

    it('should handle empty WHERE clause', async () => {
      const sql = 'SELECT * FROM users';

      const parseResult = await CompletionsAPI.sqlToIR({ sql });
      // May be undefined or null - both are acceptable for "no WHERE clause"
      expect(parseResult.ir!.where == null).toBe(true);

      const generateResult = await CompletionsAPI.irToSql({ ir: parseResult.ir! });
      expect(generateResult.sql).not.toContain('WHERE');
    });
  });
});
