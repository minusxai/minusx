/**
 * Simple-tier query model tests — IR-level fit/projection rules plus real
 * SQL round-trips through the WASM parser (parseSqlToIrLocal / irToSqlLocal)
 * to prove the time-dimension (DATE_TRUNC) path end to end.
 */
import { describe, it, expect } from 'vitest';
import { simpleSpecFromIr, irFromSimpleSpec, type SimpleQuerySpec } from '../simple-query';
import { parseSqlToIrLocal } from '../sql-to-ir';
import { irToSqlLocal } from '../ir-to-sql';
import type { QueryIR } from '../ir-types';

const baseIr = (overrides: Partial<QueryIR> = {}): QueryIR => ({
  version: 1,
  select: [{ type: 'column', column: '*' }],
  from: { table: 'orders' },
  ...overrides,
});

const expectFits = (ir: QueryIR): SimpleQuerySpec => {
  const result = simpleSpecFromIr(ir);
  expect(result.fits, result.fits ? '' : `expected fit, got: ${(result as any).reasons?.join(', ')}`).toBe(true);
  return (result as { fits: true; spec: SimpleQuerySpec }).spec;
};

const expectNoFit = (ir: QueryIR, reasonMatch: RegExp): void => {
  const result = simpleSpecFromIr(ir);
  expect(result.fits).toBe(false);
  if (!result.fits) {
    expect(result.reasons.join('; ')).toMatch(reasonMatch);
  }
};

// ---------------------------------------------------------------------------
// simpleSpecFromIr — queries that FIT
// ---------------------------------------------------------------------------

describe('simpleSpecFromIr — fits', () => {
  it('SELECT * (raw rows mode)', () => {
    const spec = expectFits(baseIr({ limit: 100 }));
    expect(spec.table).toEqual({ table: 'orders' });
    expect(spec.measures).toEqual([]);
    expect(spec.groupBy).toEqual([]);
    expect(spec.time).toBeUndefined();
    expect(spec.filters).toEqual([]);
    expect(spec.limit).toBe(100);
  });

  it('SELECT * with flat AND filters', () => {
    const spec = expectFits(baseIr({
      where: {
        operator: 'AND',
        conditions: [
          { column: 'status', operator: '=', value: 'complete' },
          { column: 'amount', operator: '>', value: 100 },
        ],
      },
    }));
    expect(spec.filters).toEqual([
      { column: 'status', operator: '=', value: 'complete' },
      { column: 'amount', operator: '>', value: 100 },
    ]);
  });

  it('pure aggregate: SELECT COUNT(*)', () => {
    const spec = expectFits(baseIr({
      select: [{ type: 'aggregate', aggregate: 'COUNT', column: null }],
    }));
    expect(spec.measures).toEqual([{ aggregate: 'COUNT', column: null }]);
    expect(spec.groupBy).toEqual([]);
  });

  it('group-by dimensions + multiple measures', () => {
    const spec = expectFits(baseIr({
      select: [
        { type: 'column', column: 'status' },
        { type: 'column', column: 'region' },
        { type: 'aggregate', aggregate: 'COUNT', column: null, alias: 'n' },
        { type: 'aggregate', aggregate: 'SUM', column: 'amount', alias: 'revenue' },
      ],
      group_by: { columns: [{ column: 'status' }, { column: 'region' }] },
    }));
    expect(spec.groupBy).toEqual(['status', 'region']);
    expect(spec.measures).toEqual([
      { aggregate: 'COUNT', column: null, alias: 'n' },
      { aggregate: 'SUM', column: 'amount', alias: 'revenue' },
    ]);
  });

  it('time dimension: DATE_TRUNC select + matching group by', () => {
    const spec = expectFits(baseIr({
      select: [
        { type: 'expression', function: 'DATE_TRUNC', unit: 'MONTH', column: 'created_at', alias: 'month' },
        { type: 'aggregate', aggregate: 'SUM', column: 'amount', alias: 'revenue' },
      ],
      group_by: { columns: [{ type: 'expression', function: 'DATE_TRUNC', unit: 'MONTH', column: 'created_at' }] },
    }));
    expect(spec.time).toEqual({ column: 'created_at', grain: 'MONTH', alias: 'month' });
    expect(spec.groupBy).toEqual([]);
    expect(spec.measures).toEqual([{ aggregate: 'SUM', column: 'amount', alias: 'revenue' }]);
  });

  it('time + categorical dimension together', () => {
    const spec = expectFits(baseIr({
      select: [
        { type: 'expression', function: 'DATE_TRUNC', unit: 'WEEK', column: 'created_at', alias: 'week' },
        { type: 'column', column: 'status' },
        { type: 'aggregate', aggregate: 'COUNT_DISTINCT', column: 'user_id', alias: 'users' },
      ],
      group_by: {
        columns: [
          { type: 'expression', function: 'DATE_TRUNC', unit: 'WEEK', column: 'created_at' },
          { column: 'status' },
        ],
      },
    }));
    expect(spec.time?.grain).toBe('WEEK');
    expect(spec.groupBy).toEqual(['status']);
  });

  it('ORDER BY visible fields is preserved', () => {
    const spec = expectFits(baseIr({
      select: [
        { type: 'column', column: 'status' },
        { type: 'aggregate', aggregate: 'COUNT', column: null, alias: 'n' },
      ],
      group_by: { columns: [{ column: 'status' }] },
      order_by: [{ type: 'column', column: 'n', direction: 'DESC' }],
    }));
    expect(spec.orderBy).toEqual([{ type: 'column', column: 'n', direction: 'DESC' }]);
  });

  it('ORDER BY the time expression is preserved', () => {
    const spec = expectFits(baseIr({
      select: [
        { type: 'expression', function: 'DATE_TRUNC', unit: 'DAY', column: 'created_at', alias: 'day' },
        { type: 'aggregate', aggregate: 'COUNT', column: null, alias: 'n' },
      ],
      group_by: { columns: [{ type: 'expression', function: 'DATE_TRUNC', unit: 'DAY', column: 'created_at' }] },
      order_by: [{ type: 'expression', function: 'DATE_TRUNC', unit: 'DAY', column: 'created_at', direction: 'ASC' }],
    }));
    expect(spec.time?.grain).toBe('DAY');
    expect(spec.orderBy).toHaveLength(1);
  });

  it('ORDER BY any column in raw rows mode', () => {
    const spec = expectFits(baseIr({
      order_by: [{ type: 'column', column: 'created_at', direction: 'DESC' }],
    }));
    expect(spec.orderBy).toEqual([{ type: 'column', column: 'created_at', direction: 'DESC' }]);
  });
});

// ---------------------------------------------------------------------------
// simpleSpecFromIr — queries that DON'T fit
// ---------------------------------------------------------------------------

describe('simpleSpecFromIr — rejections', () => {
  it('compound (UNION) queries', () => {
    const result = simpleSpecFromIr({
      type: 'compound',
      version: 1,
      queries: [baseIr(), baseIr()],
      operators: ['UNION ALL'],
    });
    expect(result.fits).toBe(false);
  });

  it('JOINs', () => {
    expectNoFit(baseIr({
      joins: [{ type: 'LEFT', table: { table: 'users' }, on: [{ left_table: 'orders', left_column: 'user_id', right_table: 'users', right_column: 'id' }] }],
    }), /join/i);
  });

  it('CTEs', () => {
    expectNoFit(baseIr({ ctes: [{ name: 'x', raw_sql: 'SELECT 1' }] }), /cte|with/i);
  });

  it('HAVING', () => {
    expectNoFit(baseIr({
      select: [{ type: 'column', column: 'status' }, { type: 'aggregate', aggregate: 'COUNT', column: null }],
      group_by: { columns: [{ column: 'status' }] },
      having: { operator: 'AND', conditions: [{ column: null, aggregate: 'COUNT', operator: '>', value: 10 }] },
    }), /having/i);
  });

  it('DISTINCT', () => {
    expectNoFit(baseIr({ distinct: true }), /distinct/i);
  });

  it('OR filter groups', () => {
    expectNoFit(baseIr({
      where: { operator: 'OR', conditions: [{ column: 'a', operator: '=', value: 1 }, { column: 'b', operator: '=', value: 2 }] },
    }), /or/i);
  });

  it('nested filter groups', () => {
    expectNoFit(baseIr({
      where: {
        operator: 'AND',
        conditions: [
          { column: 'a', operator: '=', value: 1 },
          { operator: 'OR', conditions: [{ column: 'b', operator: '=', value: 2 }, { column: 'c', operator: '=', value: 3 }] },
        ],
      },
    }), /nested|group/i);
  });

  it(':param-bound filters', () => {
    expectNoFit(baseIr({
      where: { operator: 'AND', conditions: [{ column: 'status', operator: '=', param_name: 'status' }] },
    }), /param/i);
  });

  it('raw SQL filter fragments', () => {
    expectNoFit(baseIr({
      where: { operator: 'AND', conditions: [{ raw_column: 'lower(city)', operator: '=', value: 'sf' }] },
    }), /expression|raw/i);
  });

  it('DATE_TRUNC filters (function on the filter column)', () => {
    expectNoFit(baseIr({
      where: { operator: 'AND', conditions: [{ column: 'created_at', function: 'DATE_TRUNC', unit: 'MONTH', operator: '>', value: '2024-01-01' }] },
    }), /filter/i);
  });

  it('non-time expressions in SELECT (SPLIT_PART)', () => {
    expectNoFit(baseIr({
      select: [
        { type: 'expression', function: 'SPLIT_PART', column: 'email', function_args: ['@', 2], alias: 'domain' },
        { type: 'aggregate', aggregate: 'COUNT', column: null },
      ],
      group_by: { columns: [{ type: 'expression', column: 'email', function: 'SPLIT_PART', function_args: ['@', 2] }] },
    }), /expression/i);
  });

  it('raw SELECT columns', () => {
    expectNoFit(baseIr({
      select: [{ type: 'raw', raw_sql: 'CASE WHEN x THEN 1 ELSE 0 END' }],
    }), /expression|raw/i);
  });

  it('wrapped aggregates (ROUND)', () => {
    expectNoFit(baseIr({
      select: [{ type: 'aggregate', aggregate: 'AVG', column: 'amount', wrapper_function: 'ROUND', wrapper_args: [2] }],
    }), /round|wrapped|expression/i);
  });

  it('multiple time dimensions', () => {
    expectNoFit(baseIr({
      select: [
        { type: 'expression', function: 'DATE_TRUNC', unit: 'MONTH', column: 'created_at' },
        { type: 'expression', function: 'DATE_TRUNC', unit: 'DAY', column: 'shipped_at' },
        { type: 'aggregate', aggregate: 'COUNT', column: null },
      ],
      group_by: {
        columns: [
          { type: 'expression', function: 'DATE_TRUNC', unit: 'MONTH', column: 'created_at' },
          { type: 'expression', function: 'DATE_TRUNC', unit: 'DAY', column: 'shipped_at' },
        ],
      },
    }), /time/i);
  });

  it('GROUP BY not mirrored in SELECT', () => {
    expectNoFit(baseIr({
      select: [{ type: 'column', column: 'status' }, { type: 'aggregate', aggregate: 'COUNT', column: null }],
      group_by: { columns: [{ column: 'region' }] },
    }), /group/i);
  });

  it('plain columns mixed with aggregates but no GROUP BY', () => {
    expectNoFit(baseIr({
      select: [{ type: 'column', column: 'status' }, { type: 'aggregate', aggregate: 'COUNT', column: null }],
    }), /group/i);
  });

  it('ORDER BY a hidden (non-visible) column in aggregate mode', () => {
    expectNoFit(baseIr({
      select: [
        { type: 'column', column: 'status' },
        { type: 'aggregate', aggregate: 'COUNT', column: null, alias: 'n' },
      ],
      group_by: { columns: [{ column: 'status' }] },
      order_by: [{ type: 'column', column: 'secret_col', direction: 'ASC' }],
    }), /order/i);
  });

  it('ORDER BY raw SQL', () => {
    expectNoFit(baseIr({
      order_by: [{ type: 'raw', raw_sql: 'CASE WHEN x THEN 0 ELSE 1 END', direction: 'ASC' }],
    }), /order/i);
  });
});

// ---------------------------------------------------------------------------
// irFromSimpleSpec — canonical IR construction
// ---------------------------------------------------------------------------

describe('irFromSimpleSpec', () => {
  it('raw rows mode emits SELECT *', () => {
    const ir = irFromSimpleSpec({ table: { table: 'orders' }, measures: [], groupBy: [], filters: [], limit: 50 });
    expect(ir.select).toEqual([{ type: 'column', column: '*' }]);
    expect(ir.group_by).toBeUndefined();
    expect(ir.limit).toBe(50);
  });

  it('aggregate mode: dimensions first, then time, then measures; GROUP BY mirrors dimensions', () => {
    const ir = irFromSimpleSpec({
      table: { table: 'orders', schema: 'analytics' },
      measures: [{ aggregate: 'SUM', column: 'amount', alias: 'revenue' }],
      groupBy: ['status'],
      time: { column: 'created_at', grain: 'MONTH', alias: 'month' },
      filters: [{ column: 'region', operator: '=', value: 'EU' }],
      limit: 1000,
    });
    expect(ir.select).toEqual([
      { type: 'column', column: 'status' },
      { type: 'expression', function: 'DATE_TRUNC', unit: 'MONTH', column: 'created_at', alias: 'month' },
      { type: 'aggregate', aggregate: 'SUM', column: 'amount', alias: 'revenue' },
    ]);
    expect(ir.group_by).toEqual({
      columns: [
        { column: 'status' },
        { type: 'expression', function: 'DATE_TRUNC', unit: 'MONTH', column: 'created_at' },
      ],
    });
    expect(ir.where).toEqual({ operator: 'AND', conditions: [{ column: 'region', operator: '=', value: 'EU' }] });
  });

  it('pure aggregate (no dimensions) has no GROUP BY', () => {
    const ir = irFromSimpleSpec({
      table: { table: 'orders' },
      measures: [{ aggregate: 'COUNT', column: null }],
      groupBy: [],
      filters: [],
    });
    expect(ir.group_by).toBeUndefined();
    expect(ir.where).toBeUndefined();
  });

  it('round-trips: simpleSpecFromIr(irFromSimpleSpec(spec)) === spec', () => {
    const spec: SimpleQuerySpec = {
      table: { table: 'orders' },
      measures: [
        { aggregate: 'COUNT', column: null, alias: 'n' },
        { aggregate: 'AVG', column: 'amount', alias: 'avg_amount' },
      ],
      groupBy: ['status'],
      time: { column: 'created_at', grain: 'QUARTER', alias: 'quarter' },
      filters: [{ column: 'status', operator: '!=', value: 'cancelled' }],
      orderBy: [{ type: 'column', column: 'n', direction: 'DESC' }],
      limit: 500,
    };
    const back = expectFits(irFromSimpleSpec(spec));
    expect(back).toEqual(spec);
  });
});

// ---------------------------------------------------------------------------
// Real SQL round-trips through the WASM parser (time-dimension proof)
// ---------------------------------------------------------------------------

describe('simple-query ↔ real SQL (WASM round-trip)', () => {
  it('parses a Scuba-shaped duckdb query into a Simple spec', async () => {
    const sql = `SELECT DATE_TRUNC('month', created_at) AS month, status, COUNT(*) AS n, SUM(amount) AS revenue
      FROM orders
      WHERE region = 'EU' AND amount > 10
      GROUP BY DATE_TRUNC('month', created_at), status
      ORDER BY month ASC
      LIMIT 1000`;
    const ir = await parseSqlToIrLocal(sql, 'duckdb') as QueryIR;
    const spec = expectFits(ir);
    expect(spec.time?.column).toBe('created_at');
    expect(spec.time?.grain).toBe('MONTH');
    expect(spec.groupBy).toEqual(['status']);
    expect(spec.measures.map(m => m.aggregate)).toEqual(['COUNT', 'SUM']);
    expect(spec.filters).toHaveLength(2);
    expect(spec.limit).toBe(1000);
  });

  it('generated SQL for a spec re-parses to the same spec (duckdb + postgres)', async () => {
    const spec: SimpleQuerySpec = {
      table: { table: 'orders' },
      measures: [{ aggregate: 'SUM', column: 'amount', alias: 'revenue' }],
      groupBy: ['status'],
      time: { column: 'created_at', grain: 'WEEK', alias: 'week' },
      filters: [{ column: 'status', operator: '=', value: 'complete' }],
      limit: 1000,
    };
    for (const dialect of ['duckdb', 'postgres']) {
      const sql = irToSqlLocal(irFromSimpleSpec(spec), dialect);
      expect(sql).toContain('DATE_TRUNC');
      const reparsed = await parseSqlToIrLocal(sql, dialect) as QueryIR;
      const back = expectFits(reparsed);
      expect(back.time).toEqual(spec.time);
      expect(back.groupBy).toEqual(spec.groupBy);
      expect(back.measures).toEqual(spec.measures);
      expect(back.filters).toEqual(spec.filters);
      expect(back.limit).toBe(1000);
    }
  });

  it('a query with a JOIN does not fit Simple', async () => {
    const sql = `SELECT o.status, COUNT(*) AS n FROM orders o JOIN users u ON o.user_id = u.id GROUP BY o.status`;
    const ir = await parseSqlToIrLocal(sql, 'duckdb') as QueryIR;
    expectNoFit(ir, /join/i);
  });
});

// ---------------------------------------------------------------------------
// pruneOrderBy — drops preserved ORDER BY entries that lose their referent
// ---------------------------------------------------------------------------

describe('pruneOrderBy', () => {
  it('drops entries referencing removed fields, keeps still-visible ones', async () => {
    const { pruneOrderBy } = await import('../simple-query');
    const spec: SimpleQuerySpec = {
      table: { table: 'orders' },
      measures: [{ aggregate: 'COUNT', column: null, alias: 'n' }],
      groupBy: ['status'],
      filters: [],
      orderBy: [
        { type: 'column', column: 'n', direction: 'DESC' },
        { type: 'column', column: 'region', direction: 'ASC' }, // no longer visible
        { type: 'expression', function: 'DATE_TRUNC', unit: 'DAY', column: 'created_at', direction: 'ASC' }, // no time dim
      ],
    };
    const pruned = pruneOrderBy(spec);
    expect(pruned.orderBy).toEqual([{ type: 'column', column: 'n', direction: 'DESC' }]);
  });

  it('keeps any column order in raw rows mode and omits empty orderBy', async () => {
    const { pruneOrderBy } = await import('../simple-query');
    const raw: SimpleQuerySpec = {
      table: { table: 'orders' }, measures: [], groupBy: [], filters: [],
      orderBy: [{ type: 'column', column: 'anything', direction: 'DESC' }],
    };
    expect(pruneOrderBy(raw).orderBy).toEqual(raw.orderBy);
    const none: SimpleQuerySpec = { table: { table: 'orders' }, measures: [{ aggregate: 'COUNT', column: null }], groupBy: [], filters: [], orderBy: [{ type: 'column', column: 'gone', direction: 'ASC' }] };
    expect(pruneOrderBy(none).orderBy).toBeUndefined();
  });
});
