/**
 * Semantic compiler tests — spec × model → QueryIR, plus a real SQL round-trip
 * through irToSqlLocal / the WASM parser to prove the generated SQL is valid
 * (time grain via DATE_TRUNC, joins, ratio metrics with NULLIF).
 */
import { describe, it, expect } from 'vitest';
import { compileSemanticQuery, validateSemanticQuery, semanticAlias, SemanticCompileError } from '../compile';
import { irToSqlLocal } from '@/lib/sql/ir-to-sql';
import { parseSqlToIrLocal } from '@/lib/sql/sql-to-ir';
import type { SemanticModel } from '@/lib/types/semantic';
import type { SemanticQuerySpec } from '@/lib/validation/atlas-schemas';

const ORDERS_MODEL: SemanticModel = {
  name: 'Orders',
  connection: 'warehouse',
  schema: 'analytics',
  table: 'orders',
  timeDimension: { column: 'created_at', label: 'Order date' },
  dimensions: [
    { name: 'Status', column: 'status' },
    { name: 'Region', column: 'region', join: 'c' },
  ],
  joins: [
    { table: 'customers', schema: 'analytics', alias: 'c', type: 'LEFT', leftColumn: 'customer_id', rightColumn: 'id' },
  ],
  measures: [
    { name: 'Revenue', agg: 'SUM', column: 'amount' },
    { name: 'Orders', agg: 'COUNT' },
    { name: 'Active Buyers', agg: 'COUNT_DISTINCT', column: 'customer_id' },
  ],
  metrics: [
    { name: 'AOV', type: 'ratio', numerator: 'Revenue', denominator: 'Orders' },
  ],
};

const spec = (overrides: Partial<SemanticQuerySpec> = {}): SemanticQuerySpec => ({
  model: 'Orders',
  measures: ['Revenue'],
  dimensions: [],
  ...overrides,
});

describe('semanticAlias', () => {
  it('slugs business names into SQL-safe aliases', () => {
    expect(semanticAlias('Active Buyers')).toBe('active_buyers');
    expect(semanticAlias('AOV')).toBe('aov');
    expect(semanticAlias('Revenue (net)')).toBe('revenue_net');
  });
});

describe('validateSemanticQuery', () => {
  it('accepts a valid spec', () => {
    expect(validateSemanticQuery(spec({ dimensions: ['Status'], timeGrain: 'MONTH' }), ORDERS_MODEL)).toEqual([]);
  });

  it('flags unknown measures, dimensions and filter dimensions', () => {
    const issues = validateSemanticQuery(spec({
      measures: ['Revenue', 'Nope'],
      dimensions: ['Missing'],
      filters: [{ dimension: 'AlsoMissing', operator: '=', value: 'x' }],
    }), ORDERS_MODEL);
    expect(issues.join('; ')).toMatch(/Nope/);
    expect(issues.join('; ')).toMatch(/Missing/);
    expect(issues.join('; ')).toMatch(/AlsoMissing/);
  });

  it('flags empty measures and timeGrain without a model time dimension', () => {
    expect(validateSemanticQuery(spec({ measures: [] }), ORDERS_MODEL).join('; ')).toMatch(/measure/i);
    const noTime: SemanticModel = { ...ORDERS_MODEL, timeDimension: undefined };
    expect(validateSemanticQuery(spec({ timeGrain: 'MONTH' }), noTime).join('; ')).toMatch(/time/i);
  });
});

describe('compileSemanticQuery', () => {
  it('compiles measures + base-table dimension + time grain', () => {
    const ir = compileSemanticQuery(spec({
      measures: ['Revenue', 'Orders'],
      dimensions: ['Status'],
      timeGrain: 'MONTH',
      filters: [{ dimension: 'Status', operator: '!=', value: 'cancelled' }],
      limit: 500,
    }), ORDERS_MODEL);

    expect(ir.from).toEqual({ table: 'orders', schema: 'analytics' });
    expect(ir.select).toEqual([
      { type: 'column', column: 'status', alias: 'status' },
      { type: 'expression', function: 'DATE_TRUNC', unit: 'MONTH', column: 'created_at', alias: 'month' },
      { type: 'aggregate', aggregate: 'SUM', column: 'amount', alias: 'revenue' },
      { type: 'aggregate', aggregate: 'COUNT', column: null, alias: 'orders' },
    ]);
    expect(ir.group_by).toEqual({
      columns: [
        { column: 'status' },
        { type: 'expression', function: 'DATE_TRUNC', unit: 'MONTH', column: 'created_at' },
      ],
    });
    expect(ir.where).toEqual({
      operator: 'AND',
      conditions: [{ column: 'status', operator: '!=', value: 'cancelled' }],
    });
    // Time present → ordered by the time expression ascending.
    expect(ir.order_by).toEqual([
      { type: 'expression', function: 'DATE_TRUNC', unit: 'MONTH', column: 'created_at', direction: 'ASC' },
    ]);
    expect(ir.limit).toBe(500);
    expect(ir.joins).toBeUndefined();
  });

  it('adds a join only when a joined dimension is referenced, and qualifies its column', () => {
    const ir = compileSemanticQuery(spec({
      measures: ['Active Buyers'],
      dimensions: ['Region'],
    }), ORDERS_MODEL);

    expect(ir.joins).toEqual([{
      type: 'LEFT',
      table: { table: 'customers', schema: 'analytics', alias: 'c' },
      on: [{ left_table: 'orders', left_column: 'customer_id', right_table: 'c', right_column: 'id' }],
    }]);
    expect(ir.select[0]).toEqual({ type: 'column', column: 'region', table: 'c', alias: 'region' });
    expect(ir.group_by).toEqual({ columns: [{ column: 'region', table: 'c' }] });
    // No time → ordered by the first measure descending.
    expect(ir.order_by).toEqual([{ type: 'column', column: 'active_buyers', direction: 'DESC' }]);
  });

  it('compiles ratio metrics to a NULLIF-guarded raw expression', () => {
    const ir = compileSemanticQuery(spec({ measures: ['AOV'], dimensions: ['Status'] }), ORDERS_MODEL);
    const raw = ir.select.find((c) => c.type === 'raw');
    expect(raw?.alias).toBe('aov');
    expect(raw?.raw_sql).toBe('SUM(amount) * 1.0 / NULLIF(COUNT(*), 0)');
  });

  it('defaults the limit to 1000', () => {
    expect(compileSemanticQuery(spec(), ORDERS_MODEL).limit).toBe(1000);
  });

  it('throws SemanticCompileError with the validation issues', () => {
    expect(() => compileSemanticQuery(spec({ measures: ['Nope'] }), ORDERS_MODEL))
      .toThrow(SemanticCompileError);
  });

  it('generated SQL parses back through the WASM parser (duckdb + postgres)', async () => {
    const ir = compileSemanticQuery(spec({
      measures: ['Revenue', 'AOV'],
      dimensions: ['Status', 'Region'],
      timeGrain: 'WEEK',
      filters: [{ dimension: 'Region', operator: 'IN', value: ['EU', 'US'] }],
    }), ORDERS_MODEL);

    for (const dialect of ['duckdb', 'postgres']) {
      const sql = irToSqlLocal(ir, dialect);
      expect(sql).toContain('DATE_TRUNC');
      expect(sql).toContain('LEFT JOIN');
      expect(sql).toContain('NULLIF');
      const reparsed = await parseSqlToIrLocal(sql, dialect);
      expect(reparsed.type).not.toBe('compound');
      const simple = reparsed as QueryIRLike;
      expect(simple.from.table).toBe('orders');
      expect(simple.joins).toHaveLength(1);
      expect(simple.group_by?.columns?.length).toBe(3);
    }
  });
});

interface QueryIRLike {
  from: { table: string };
  joins?: unknown[];
  group_by?: { columns?: unknown[] };
}
