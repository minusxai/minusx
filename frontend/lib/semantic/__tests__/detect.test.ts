/**
 * Semantic detection tests.
 *
 * Three layers, mirroring the design:
 *  1. IR-level round trips: compile(spec) → semanticSpecFromIr → same spec
 *     (dialect-free — the bulk of coverage).
 *  2. Hand-written SQL variants that must (or must not) detect.
 *  3. Dialect matrix: compile → irToSql(dialect) → parse(dialect) → detect
 *     must return the identical spec for every dialect — this is what pins
 *     parser/generator symmetry per dialect.
 */
import { describe, it, expect } from 'vitest';
import { detectSemanticQuery, semanticSpecFromIr } from '../detect';
import { compileSemanticQuery } from '../compile';
import { irToSqlLocal } from '@/lib/sql/ir-to-sql';
import type { SemanticModel } from '@/lib/types/semantic';
import type { SemanticQuerySpec } from '@/lib/validation/atlas-schemas';

const ORDERS: SemanticModel = {
  name: 'Orders',
  connection: 'warehouse',
  schema: 'mxfood',
  table: 'orders',
  timeDimension: { column: 'created_at' },
  dimensions: [
    { name: 'Status', column: 'status' },
    { name: 'Region', column: 'region', join: 'c' },
  ],
  joins: [
    { table: 'customers', schema: 'mxfood', alias: 'c', relationship: 'many_to_one', leftColumn: 'customer_id', rightColumn: 'id' },
  ],
  measures: [
    { name: 'Count', agg: 'COUNT' },
    { name: 'Revenue', agg: 'SUM', column: 'total' },
    { name: 'Buyers', agg: 'COUNT_DISTINCT', column: 'customer_id' },
  ],
  metrics: [{ name: 'AOV', type: 'ratio', numerator: 'Revenue', denominator: 'Count' }],
};

const MODELS = [ORDERS];

const SPECS: Array<[string, SemanticQuerySpec]> = [
  ['measure only', { model: 'Orders', measures: ['Revenue'], dimensions: [] }],
  ['dimension + time', { model: 'Orders', measures: ['Count', 'Revenue'], dimensions: ['Status'], timeGrain: 'MONTH' }],
  ['joined dimension', { model: 'Orders', measures: ['Buyers'], dimensions: ['Region'] }],
  ['ratio metric', { model: 'Orders', measures: ['AOV'], dimensions: ['Status'] }],
  ['filters + limit', {
    model: 'Orders', measures: ['Revenue'], dimensions: ['Status'],
    filters: [{ dimension: 'Status', operator: '!=', value: 'cancelled' }], limit: 50,
  }],
];

describe('semanticSpecFromIr — IR round trips', () => {
  for (const [name, spec] of SPECS) {
    it(`recovers the spec: ${name}`, () => {
      const ir = compileSemanticQuery(spec, ORDERS);
      expect(semanticSpecFromIr(ir, MODELS)).toEqual(spec);
    });
  }

  it('rejects IRs that do not map', () => {
    const base = compileSemanticQuery(SPECS[1][1], ORDERS);
    // Unknown table
    expect(semanticSpecFromIr({ ...base, from: { table: 'users' } }, MODELS)).toBeNull();
    // Aggregate not declared as a measure (AVG total)
    expect(semanticSpecFromIr({
      ...base,
      select: [{ type: 'aggregate', aggregate: 'AVG', column: 'total', alias: 'x' }],
    }, MODELS)).toBeNull();
    // Column that is not a dimension
    expect(semanticSpecFromIr({
      ...base,
      select: [...base.select, { type: 'column', column: 'driver_id' }],
    }, MODELS)).toBeNull();
    // HAVING
    expect(semanticSpecFromIr({
      ...base,
      having: { operator: 'AND', conditions: [{ column: null, aggregate: 'COUNT', operator: '>', value: 5 }] },
    }, MODELS)).toBeNull();
    // OR filters
    expect(semanticSpecFromIr({
      ...base,
      where: { operator: 'OR', conditions: [
        { column: 'status', operator: '=', value: 'a' },
        { column: 'status', operator: '=', value: 'b' },
      ] },
    }, MODELS)).toBeNull();
    // Join not declared on the model
    expect(semanticSpecFromIr({
      ...base,
      joins: [{ type: 'LEFT', table: { table: 'drivers', alias: 'd' }, on: [{ left_table: 'orders', left_column: 'driver_id', right_table: 'd', right_column: 'id' }] }],
    }, MODELS)).toBeNull();
  });
});

describe('detectSemanticQuery — hand-written SQL', () => {
  it('detects agent-style SQL that fits the model (duckdb)', async () => {
    const sql = `SELECT status, DATE_TRUNC('month', created_at) AS month, COUNT(*) AS n, SUM(total) AS revenue
      FROM mxfood.orders
      WHERE status != 'cancelled'
      GROUP BY status, DATE_TRUNC('month', created_at)
      ORDER BY month`;
    const spec = await detectSemanticQuery(sql, MODELS, 'duckdb');
    expect(spec).toEqual({
      model: 'Orders',
      measures: ['Count', 'Revenue'],
      dimensions: ['Status'],
      timeGrain: 'MONTH',
      filters: [{ dimension: 'Status', operator: '!=', value: 'cancelled' }],
    });
  });

  it('detects joined-dimension SQL with the declared join', async () => {
    const sql = `SELECT c.region, COUNT(DISTINCT customer_id) AS buyers
      FROM mxfood.orders
      LEFT JOIN mxfood.customers c ON orders.customer_id = c.id
      GROUP BY c.region`;
    const spec = await detectSemanticQuery(sql, MODELS, 'duckdb');
    expect(spec).toEqual({ model: 'Orders', measures: ['Buyers'], dimensions: ['Region'] });
  });

  it('returns null for SQL outside the model vocabulary', async () => {
    expect(await detectSemanticQuery(
      'SELECT driver_id, COUNT(*) FROM mxfood.orders GROUP BY driver_id', MODELS, 'duckdb',
    )).toBeNull();
    expect(await detectSemanticQuery(
      'SELECT AVG(total) FROM mxfood.orders', MODELS, 'duckdb',
    )).toBeNull();
    expect(await detectSemanticQuery('SELECT * FROM mxfood.orders', MODELS, 'duckdb')).toBeNull();
    expect(await detectSemanticQuery('not sql at all', MODELS, 'duckdb')).toBeNull();
    expect(await detectSemanticQuery('SELECT COUNT(*) FROM mxfood.orders', [], 'duckdb')).toBeNull();
  });
});

describe('dialect matrix — compile → SQL → parse → detect round trip', () => {
  for (const dialect of ['duckdb', 'postgres', 'bigquery']) {
    for (const [name, spec] of SPECS) {
      it(`${dialect}: ${name}`, async () => {
        const sql = irToSqlLocal(compileSemanticQuery(spec, ORDERS), dialect);
        const detected = await detectSemanticQuery(sql, MODELS, dialect);
        expect(detected).toEqual(spec);
      });
    }
  }
});

describe('reliability gate — recompile-and-compare', () => {
  it('rejects vocabulary-matching SQL whose structure the compiler would not reproduce', async () => {
    // Vocabulary all matches (Status dim, Revenue measure) but GROUP BY does
    // not mirror the selected dimension — only the recompile gate catches it.
    const sql = `SELECT status, SUM(total) AS revenue FROM mxfood.orders GROUP BY status, customer_id`;
    expect(await detectSemanticQuery(sql, MODELS, 'duckdb')).toBeNull();
  });
});
