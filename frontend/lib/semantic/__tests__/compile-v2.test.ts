/**
 * V2 compiler golden tests (Semantic_Model_v2.md M2): compileSemanticQuery over
 * primary/references, `_views.*` sources, author aliases, SQL metrics via
 * alias-rewrite, and metric-only join inclusion. m2m compiles in M3 — until
 * then it throws a clear SemanticCompileError.
 */
import { describe, it, expect } from 'vitest';
import { compileSemanticQuery, validateSemanticQuery } from '../compile';
import { rewriteMetricSql } from '../metric-sql';
import { irToSqlLocal } from '@/lib/sql/ir-to-sql';
import type { SemanticModelV2 } from '@/lib/types/semantic';
import type { SemanticQuerySpec } from '@/lib/validation/atlas-schemas';

const MODEL: SemanticModelV2 = {
  name: 'Orders',
  connection: 'wh',
  primary: { kind: 'table', schema: 'main', table: 'orders' },
  primaryKey: ['id'],
  references: [
    {
      source: { kind: 'table', schema: 'main', table: 'customers' },
      alias: 'buyer',                       // author alias ≠ table name
      relationship: 'many_to_one',
      on: [{ primaryColumn: 'customer_id', referencedColumn: 'id' }],
    },
    {
      source: { kind: 'model', view: 'costs' },
      alias: 'costs',
      relationship: 'one_to_one',
      joinType: 'INNER',
      on: [{ primaryColumn: 'id', referencedColumn: 'order_id' }],
    },
    {
      source: { kind: 'table', schema: 'main', table: 'tags' },
      alias: 'tag',
      relationship: 'many_to_many',
      through: {
        source: { kind: 'table', schema: 'main', table: 'order_tags' },
        primaryOn: [{ primaryColumn: 'id', bridgeColumn: 'order_id' }],
        referencedOn: [{ bridgeColumn: 'tag_id', referencedColumn: 'id' }],
      },
    },
  ],
  dimensions: [
    { name: 'Region', source: 'primary', column: 'region' },
    { name: 'Buyer Name', source: 'buyer', column: 'name' },
    { name: 'Cost Bucket', source: 'costs', column: 'bucket' },
    { name: 'Tag', source: 'tag', column: 'name' },
    { name: 'Created At', source: 'primary', column: 'created_at', temporal: true },
  ],
  measures: [
    { name: 'Order Count', agg: 'COUNT' },
    { name: 'Revenue', agg: 'SUM', column: 'amount' },
  ],
  metrics: [
    { name: 'AOV', type: 'ratio', numerator: 'Revenue', denominator: 'Order Count' },
    { name: 'Net Revenue', type: 'sql', sql: 'SUM(primary.amount) - SUM(costs.total)' },
  ],
  timeDimension: { column: 'created_at' },
};

const spec = (over: Partial<SemanticQuerySpec>): SemanticQuerySpec => ({
  model: 'Orders', table: 'orders', schema: 'main',
  measures: [], dimensions: [],
  ...over,
} as SemanticQuerySpec);

const sqlFor = (s: SemanticQuerySpec, dialect = 'duckdb'): string =>
  irToSqlLocal(compileSemanticQuery(s, MODEL), dialect);

describe('V2 compilation — primary + to-one references', () => {
  it('golden: measures only, no joins (unqualified, FROM schema.table)', () => {
    const sql = sqlFor(spec({ measures: ['Revenue'] }));
    expect(sql).toBe([
      'SELECT SUM(amount) AS revenue',
      'FROM main.orders',
      'ORDER BY revenue DESC',
      'LIMIT 1000',
    ].join('\n'));
  });

  it('golden: to-one join via author alias, base columns qualified', () => {
    const sql = sqlFor(spec({ measures: ['Revenue'], dimensions: ['Buyer Name'] }));
    expect(sql).toBe([
      'SELECT',
      '  buyer.name AS buyer_name,',
      '  SUM(orders.amount) AS revenue',
      'FROM main.orders',
      'LEFT JOIN main.customers buyer ON orders.customer_id = buyer.id',
      'GROUP BY buyer.name',
      'ORDER BY revenue DESC',
      'LIMIT 1000',
    ].join('\n'));
  });

  it('a view reference joins as _views.<name> with its alias and joinType', () => {
    const sql = sqlFor(spec({ measures: ['Order Count'], dimensions: ['Cost Bucket'] }));
    expect(sql).toContain('JOIN _views.costs costs ON orders.id = costs.order_id');
    expect(sql).not.toMatch(/LEFT JOIN _views/); // INNER was declared
    expect(sql).toContain('costs.bucket AS cost_bucket');
  });

  it('a view PRIMARY compiles to FROM _views.<name>', () => {
    const viewPrimary: SemanticModelV2 = {
      name: 'Costs', connection: 'wh',
      primary: { kind: 'model', view: 'costs' },
      dimensions: [{ name: 'Bucket', source: 'primary', column: 'bucket' }],
      measures: [{ name: 'Spend', agg: 'SUM', column: 'total' }],
    };
    const ir = compileSemanticQuery(spec({ model: 'Costs', measures: ['Spend'] }), viewPrimary);
    expect(irToSqlLocal(ir, 'duckdb')).toContain('FROM _views.costs');
  });

  it('composite on keys emit multiple AND-ed join conditions', () => {
    const composite: SemanticModelV2 = {
      ...MODEL,
      references: [{
        source: { kind: 'table', schema: 'main', table: 'customers' },
        alias: 'buyer', relationship: 'many_to_one',
        on: [
          { primaryColumn: 'customer_id', referencedColumn: 'id' },
          { primaryColumn: 'region', referencedColumn: 'region' },
        ],
      }],
      dimensions: MODEL.dimensions.filter((d) => d.source === 'primary' || d.source === 'buyer'),
      metrics: [],
    };
    const sql = irToSqlLocal(
      compileSemanticQuery(spec({ measures: ['Revenue'], dimensions: ['Buyer Name'] }), composite), 'duckdb');
    expect(sql).toContain('ON orders.customer_id = buyer.id AND orders.region = buyer.region');
  });

  it('timeGrain uses dialect-correct DATE_TRUNC', () => {
    const s = spec({ measures: ['Revenue'], timeGrain: 'MONTH' });
    expect(sqlFor(s, 'duckdb')).toContain("DATE_TRUNC('MONTH', created_at)");
    expect(sqlFor(s, 'bigquery')).toContain('DATE_TRUNC(created_at, MONTH)');
    expect(sqlFor(s, 'postgres')).toContain("DATE_TRUNC('MONTH', created_at)");
  });

  it('filters on a reference dimension pull the join and qualify by alias', () => {
    const sql = sqlFor(spec({
      measures: ['Revenue'],
      filters: [{ dimension: 'Buyer Name', operator: '=', value: 'ACME' }],
    }));
    expect(sql).toContain("WHERE buyer.name = 'ACME'");
    expect(sql).toContain('LEFT JOIN main.customers buyer');
  });
});

describe('V2 SQL metrics', () => {
  it('compiles a SQL metric as a raw select column with primary rewritten', () => {
    const sql = sqlFor(spec({ measures: ['Net Revenue'], dimensions: ['Region'] }));
    expect(sql).toContain('SUM(orders.amount) - SUM(costs.total) AS net_revenue');
  });

  it('metric-only join inclusion: a metric ref pulls its join with NO dimension using it', () => {
    // Only primary dimensions selected — the join must come from the metric refs.
    const sql = sqlFor(spec({ measures: ['Net Revenue'] }));
    expect(sql).toContain('JOIN _views.costs costs ON orders.id = costs.order_id');
  });

  it('ratio metrics qualify by the base when joins are in play', () => {
    const sql = sqlFor(spec({ measures: ['AOV'], dimensions: ['Buyer Name'] }));
    expect(sql).toContain('SUM(orders.amount) * 1.0 / NULLIF(COUNT(*), 0) AS aov');
  });
});

describe('m2m compiles (full coverage in m2m.test.ts)', () => {
  it('an m2m dimension compiles to a dedup-bridge CTE + LEFT join', () => {
    const sql = sqlFor(spec({ measures: ['Revenue'], dimensions: ['Tag'] }));
    expect(sql).toMatch(/^WITH _m2m_tag AS \(/);
    expect(sql).toContain('LEFT JOIN _m2m_tag ON orders.id = _m2m_tag._pk');
  });

  it('an m2m filter compiles to a correlated EXISTS', () => {
    const sql = sqlFor(spec({ measures: ['Revenue'], filters: [{ dimension: 'Tag', operator: '=', value: 'vip' }] }));
    expect(sql).toContain('EXISTS (SELECT 1');
    expect(sql).toContain('order_tags.order_id = orders.id');
  });
});

describe('validateSemanticQuery (V2)', () => {
  it('accepts SQL metrics as measurables', () => {
    expect(validateSemanticQuery(spec({ measures: ['Net Revenue'] }), MODEL)).toEqual([]);
  });

  it('keeps human-readable unknown-name errors', () => {
    const issues = validateSemanticQuery(spec({ measures: ['Ghost'], dimensions: ['Nope'] }), MODEL);
    expect(issues.some((i) => i.includes('Ghost'))).toBe(true);
    expect(issues.some((i) => i.includes('Nope'))).toBe(true);
  });

  it('spec.timeColumn accepts any PRIMARY temporal dimension column', () => {
    expect(validateSemanticQuery(
      spec({ measures: ['Revenue'], timeGrain: 'DAY', timeColumn: 'created_at' }), MODEL)).toEqual([]);
    const bad = validateSemanticQuery(
      spec({ measures: ['Revenue'], timeGrain: 'DAY', timeColumn: 'name' }), MODEL);
    expect(bad.length).toBeGreaterThan(0);
  });
});

describe('rewriteMetricSql', () => {
  it('rewrites primary refs only, leaving alias refs and strings alone', () => {
    expect(rewriteMetricSql(
      "SUM(primary.amount) + SUM(costs.total) + COUNT(CASE WHEN primary.region = 'primary.fake' THEN 1 END)",
      'orders',
    )).toBe("SUM(orders.amount) + SUM(costs.total) + COUNT(CASE WHEN orders.region = 'primary.fake' THEN 1 END)");
  });
});
