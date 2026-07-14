/**
 * Semantic detection tests — SQL ⇄ Semantic conversion.
 *
 * Layered like the lib/sql IR suite:
 *  1. IR-level round trips: compile(spec) → semanticSpecFromIr → same spec
 *     (dialect-free — the bulk of coverage, diverse spec shapes).
 *  2. Hand-written SQL variants that MUST detect: aliased tables, aliased
 *     joins, positional GROUP BY, reordered select lists, filter shapes.
 *  3. Hand-written SQL that MUST NOT detect (vocabulary misses, structural
 *     misses, and cases only the recompile gate catches).
 *  4. Dialect matrix: compile → irToSql(dialect) → parse(dialect) → detect
 *     must return the identical spec across every runtime dialect
 *     (connectionTypeToDialect: duckdb, postgres, bigquery, presto, sqlite,
 *     clickhouse) — this pins parser/generator symmetry per dialect.
 */
import { describe, it, expect } from 'vitest';
import { semanticSpecFromIr } from '../detect';
import { detectSemanticQuery } from '../detect-sql';
import { compileSemanticQuery } from '../compile';
import { irToSqlLocal } from '@/lib/sql/ir-to-sql';
import type { SemanticModel } from '@/lib/types/semantic';
import type { SemanticQuerySpec } from '@/lib/validation/atlas-schemas';

// ---------------------------------------------------------------------------
// Fixtures: two models on the same connection + a schemaless one
// ---------------------------------------------------------------------------

const ORDERS: SemanticModel = {
  name: 'Orders',
  connection: 'warehouse',
  schema: 'mxfood',
  table: 'orders',
  timeDimension: { column: 'created_at' },
  dimensions: [
    { name: 'Status', column: 'status' },
    { name: 'Platform', column: 'platform' },
    { name: 'Is Subscription', column: 'is_subscription' },
    { name: 'Region', column: 'region', join: 'c' },
    { name: 'Customer Tier', column: 'tier', join: 'c' },
  ],
  joins: [
    { table: 'customers', schema: 'mxfood', alias: 'c', relationship: 'many_to_one', leftColumn: 'customer_id', rightColumn: 'id' },
    { table: 'zones', schema: 'mxfood', alias: 'z', type: 'INNER', relationship: 'one_to_one', leftColumn: 'zone_id', rightColumn: 'id' },
  ],
  measures: [
    { name: 'Count', agg: 'COUNT' },
    { name: 'Revenue', agg: 'SUM', column: 'total' },
    { name: 'Avg Delivery Mins', agg: 'AVG', column: 'delivery_mins' },
    { name: 'Buyers', agg: 'COUNT_DISTINCT', column: 'customer_id' },
    { name: 'Max Total', agg: 'MAX', column: 'total' },
  ],
  metrics: [
    { name: 'AOV', type: 'ratio', numerator: 'Revenue', denominator: 'Count' },
    { name: 'Revenue per Buyer', type: 'ratio', numerator: 'Revenue', denominator: 'Buyers' },
  ],
};

const EVENTS: SemanticModel = {
  name: 'Events',
  connection: 'warehouse',
  table: 'events', // no schema — unqualified table
  timeDimension: { column: 'event_ts' },
  dimensions: [{ name: 'Event Name', column: 'event_name' }],
  measures: [
    { name: 'Events', agg: 'COUNT' },
    { name: 'Sessions', agg: 'COUNT_DISTINCT', column: 'session_id' },
  ],
};

const MODELS = [ORDERS, EVENTS];

// Diverse spec shapes for round trips + the dialect matrix.
const SPECS: Array<[string, SemanticQuerySpec]> = [
  ['single measure, no dims', { model: 'Orders', measures: ['Revenue'], dimensions: [] }],
  ['count only', { model: 'Orders', measures: ['Count'], dimensions: [] }],
  ['multiple measures + dim', { model: 'Orders', measures: ['Count', 'Revenue', 'Avg Delivery Mins'], dimensions: ['Status'] }],
  ['two dims + time (MONTH)', { model: 'Orders', measures: ['Revenue'], dimensions: ['Status', 'Platform'], timeGrain: 'MONTH' }],
  ['time only (WEEK)', { model: 'Orders', measures: ['Count'], dimensions: [], timeGrain: 'WEEK' }],
  ['quarter grain', { model: 'Orders', measures: ['Revenue'], dimensions: [], timeGrain: 'QUARTER' }],
  ['hour grain', { model: 'Orders', measures: ['Count'], dimensions: [], timeGrain: 'HOUR' }],
  ['joined dimension (LEFT)', { model: 'Orders', measures: ['Buyers'], dimensions: ['Region'] }],
  ['two joined dims, same join', { model: 'Orders', measures: ['Count'], dimensions: ['Region', 'Customer Tier'] }],
  ['ratio metric', { model: 'Orders', measures: ['AOV'], dimensions: ['Status'] }],
  ['ratio with COUNT_DISTINCT denominator', { model: 'Orders', measures: ['Revenue per Buyer'], dimensions: [] }],
  ['measure + metric mixed', { model: 'Orders', measures: ['Revenue', 'AOV'], dimensions: ['Platform'] }],
  ['equality filter', {
    model: 'Orders', measures: ['Revenue'], dimensions: ['Status'],
    filters: [{ dimension: 'Status', operator: '=', value: 'completed' }],
  }],
  ['IN + numeric filters', {
    model: 'Orders', measures: ['Count'], dimensions: [],
    filters: [
      { dimension: 'Status', operator: 'IN', value: ['completed', 'shipped'] },
      { dimension: 'Platform', operator: '!=', value: 'web' },
    ],
  }],
  ['IS NOT NULL filter on joined dim', {
    model: 'Orders', measures: ['Count'], dimensions: ['Region'],
    filters: [{ dimension: 'Region', operator: 'IS NOT NULL' }],
  }],
  ['LIKE filter', {
    model: 'Orders', measures: ['Count'], dimensions: [],
    filters: [{ dimension: 'Platform', operator: 'LIKE', value: 'ios%' }],
  }],
  ['custom limit', { model: 'Orders', measures: ['Revenue'], dimensions: ['Status'], limit: 25 }],
  ['second model, schemaless', { model: 'Events', measures: ['Events', 'Sessions'], dimensions: ['Event Name'], timeGrain: 'DAY' }],
  ['kitchen sink', {
    model: 'Orders',
    measures: ['Count', 'Revenue', 'AOV'],
    dimensions: ['Status', 'Region'],
    timeGrain: 'MONTH',
    filters: [
      { dimension: 'Status', operator: '!=', value: 'cancelled' },
      { dimension: 'Customer Tier', operator: 'IN', value: ['gold', 'silver'] },
    ],
    limit: 500,
  }],
];

// ---------------------------------------------------------------------------
// 1. IR round trips
// ---------------------------------------------------------------------------

describe('semanticSpecFromIr — IR round trips (dialect-free)', () => {
  for (const [name, spec] of SPECS) {
    it(`recovers the spec: ${name}`, () => {
      const model = MODELS.find((m) => m.name === spec.model)!;
      const ir = compileSemanticQuery(spec, model);
      expect(semanticSpecFromIr(ir, MODELS)).toEqual(spec);
    });
  }

  it('resolves the RIGHT model among several', () => {
    const spec: SemanticQuerySpec = { model: 'Events', measures: ['Events'], dimensions: [] };
    const ir = compileSemanticQuery(spec, EVENTS);
    expect(semanticSpecFromIr(ir, MODELS)?.model).toBe('Events');
  });
});

// ---------------------------------------------------------------------------
// 2. Hand-written SQL that MUST detect (duckdb unless noted)
// ---------------------------------------------------------------------------

describe('detectSemanticQuery — hand-written SQL variants', () => {
  it('agent-style SQL: time + dim + measures + filter + ORDER BY alias', async () => {
    const sql = `SELECT status, DATE_TRUNC('month', created_at) AS month, COUNT(*) AS n, SUM(total) AS revenue
      FROM mxfood.orders
      WHERE status != 'cancelled'
      GROUP BY status, DATE_TRUNC('month', created_at)
      ORDER BY month`;
    expect(await detectSemanticQuery(sql, MODELS, 'duckdb')).toEqual({
      model: 'Orders',
      measures: ['Count', 'Revenue'],
      dimensions: ['Status'],
      timeGrain: 'MONTH',
      filters: [{ dimension: 'Status', operator: '!=', value: 'cancelled' }],
    });
  });

  it('measures listed before dimensions (select order is free)', async () => {
    const sql = `SELECT SUM(total) AS revenue, COUNT(*) AS n, platform
      FROM mxfood.orders GROUP BY platform`;
    expect(await detectSemanticQuery(sql, MODELS, 'duckdb')).toEqual({
      model: 'Orders', measures: ['Revenue', 'Count'], dimensions: ['Platform'],
    });
  });

  it('positional GROUP BY (GROUP BY 1, 2)', async () => {
    const sql = `SELECT status, platform, COUNT(*) AS n FROM mxfood.orders GROUP BY 1, 2`;
    expect(await detectSemanticQuery(sql, MODELS, 'duckdb')).toEqual({
      model: 'Orders', measures: ['Count'], dimensions: ['Status', 'Platform'],
    });
  });

  it('join with a DIFFERENT alias than the model declares', async () => {
    const sql = `SELECT cust.region, COUNT(DISTINCT customer_id) AS buyers
      FROM mxfood.orders
      LEFT JOIN mxfood.customers cust ON orders.customer_id = cust.id
      GROUP BY cust.region`;
    expect(await detectSemanticQuery(sql, MODELS, 'duckdb')).toEqual({
      model: 'Orders', measures: ['Buyers'], dimensions: ['Region'],
    });
  });

  it('INNER join matching a declared INNER lookup', async () => {
    const sql = `SELECT COUNT(*) AS n FROM mxfood.orders
      INNER JOIN mxfood.zones z ON orders.zone_id = z.id`;
    // Join declared but no dimension referenced → recompile drops it → gate rejects.
    // (An unused join changes row multiplicity only under to-many; still, the
    // compiler would not reproduce it, so detection must refuse.)
    expect(await detectSemanticQuery(sql, MODELS, 'duckdb')).toBeNull();
  });

  it('filters on a joined dimension via the SQL alias', async () => {
    const sql = `SELECT COUNT(*) AS n, c2.region FROM mxfood.orders
      LEFT JOIN mxfood.customers c2 ON orders.customer_id = c2.id
      WHERE c2.tier = 'gold'
      GROUP BY c2.region`;
    expect(await detectSemanticQuery(sql, MODELS, 'duckdb')).toEqual({
      model: 'Orders', measures: ['Count'], dimensions: ['Region'],
      filters: [{ dimension: 'Customer Tier', operator: '=', value: 'gold' }],
    });
  });

  it('LIMIT 1000 is treated as the default (omitted from the spec)', async () => {
    const sql = `SELECT COUNT(*) AS n FROM mxfood.orders LIMIT 1000`;
    expect(await detectSemanticQuery(sql, MODELS, 'duckdb')).toEqual({
      model: 'Orders', measures: ['Count'], dimensions: [],
    });
  });

  it('schemaless model table (events)', async () => {
    const sql = `SELECT event_name, COUNT(DISTINCT session_id) AS s FROM events GROUP BY event_name`;
    expect(await detectSemanticQuery(sql, MODELS, 'duckdb')).toEqual({
      model: 'Events', measures: ['Sessions'], dimensions: ['Event Name'],
    });
  });

  it('bigquery-style DATE_TRUNC(col, MONTH)', async () => {
    const sql = `SELECT DATE_TRUNC(created_at, MONTH) AS month, SUM(total) AS revenue
      FROM mxfood.orders GROUP BY DATE_TRUNC(created_at, MONTH)`;
    expect(await detectSemanticQuery(sql, MODELS, 'bigquery')).toEqual({
      model: 'Orders', measures: ['Revenue'], dimensions: [], timeGrain: 'MONTH',
    });
  });

  it('postgres-written SQL with IN filter', async () => {
    const sql = `SELECT status, COUNT(*) AS n FROM mxfood.orders
      WHERE status IN ('completed', 'shipped') GROUP BY status`;
    expect(await detectSemanticQuery(sql, MODELS, 'postgres')).toEqual({
      model: 'Orders', measures: ['Count'], dimensions: ['Status'],
      filters: [{ dimension: 'Status', operator: 'IN', value: ['completed', 'shipped'] }],
    });
  });
});

// ---------------------------------------------------------------------------
// 3. SQL that MUST NOT detect
// ---------------------------------------------------------------------------

describe('detectSemanticQuery — refusals', () => {
  const mustNotDetect: Array<[string, string]> = [
    ['unknown table', 'SELECT COUNT(*) FROM mxfood.payments'],
    ['bare SELECT * (no measures)', 'SELECT * FROM mxfood.orders'],
    ['non-dimension column', 'SELECT driver_id, COUNT(*) FROM mxfood.orders GROUP BY driver_id'],
    ['aggregate not declared as measure', 'SELECT AVG(total) FROM mxfood.orders'],
    ['MIN not declared (only MAX is)', 'SELECT MIN(total) FROM mxfood.orders'],
    ['wrapped aggregate', 'SELECT ROUND(SUM(total), 2) FROM mxfood.orders'],
    ['undeclared join', `SELECT COUNT(*) FROM mxfood.orders LEFT JOIN mxfood.drivers d ON orders.driver_id = d.id`],
    ['join with swapped columns', `SELECT c.region, COUNT(*) FROM mxfood.orders LEFT JOIN mxfood.customers c ON orders.id = c.customer_id GROUP BY c.region`],
    ['join type mismatch (INNER vs declared LEFT)', `SELECT c.region, COUNT(*) FROM mxfood.orders INNER JOIN mxfood.customers c ON orders.customer_id = c.id GROUP BY c.region`],
    ['DATE_TRUNC on a non-time column', `SELECT DATE_TRUNC('month', updated_at) AS m, COUNT(*) FROM mxfood.orders GROUP BY 1`],
    ['two time grains', `SELECT DATE_TRUNC('month', created_at) AS m, DATE_TRUNC('day', created_at) AS d, COUNT(*) FROM mxfood.orders GROUP BY 1, 2`],
    ['HAVING', `SELECT status, COUNT(*) AS n FROM mxfood.orders GROUP BY status HAVING COUNT(*) > 10`],
    ['OR filters', `SELECT COUNT(*) FROM mxfood.orders WHERE status = 'a' OR status = 'b'`],
    ['filter on a non-dimension column', `SELECT COUNT(*) FROM mxfood.orders WHERE total > 100`],
    [':param filter', `SELECT COUNT(*) FROM mxfood.orders WHERE status = :status`],
    ['DATE_TRUNC filter', `SELECT COUNT(*) FROM mxfood.orders WHERE DATE_TRUNC('month', created_at) = '2026-01-01'`],
    ['UNION', `SELECT COUNT(*) FROM mxfood.orders UNION ALL SELECT COUNT(*) FROM mxfood.orders`],
    ['garbage', 'not sql at all'],
  ];

  for (const [name, sql] of mustNotDetect) {
    it(name, async () => {
      expect(await detectSemanticQuery(sql, MODELS, 'duckdb')).toBeNull();
    });
  }

  it('no models → null', async () => {
    expect(await detectSemanticQuery('SELECT COUNT(*) FROM mxfood.orders', [], 'duckdb')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. Reliability gate
// ---------------------------------------------------------------------------

describe('reliability gate — recompile-and-compare', () => {
  it('rejects vocabulary-matching SQL whose GROUP BY the compiler would not reproduce', async () => {
    const sql = `SELECT status, SUM(total) AS revenue FROM mxfood.orders GROUP BY status, customer_id`;
    expect(await detectSemanticQuery(sql, MODELS, 'duckdb')).toBeNull();
  });

  it('rejects a dimension selected without its GROUP BY', async () => {
    const sql = `SELECT status, platform, SUM(total) AS revenue FROM mxfood.orders GROUP BY status`;
    expect(await detectSemanticQuery(sql, MODELS, 'duckdb')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. Dialect matrix: every runtime dialect × every spec shape
// ---------------------------------------------------------------------------

const DIALECTS = ['duckdb', 'postgres', 'bigquery', 'presto', 'sqlite', 'clickhouse'];

describe('dialect matrix — compile → SQL → parse → detect round trip', () => {
  for (const dialect of DIALECTS) {
    for (const [name, spec] of SPECS) {
      it(`${dialect}: ${name}`, async () => {
        const model = MODELS.find((m) => m.name === spec.model)!;
        const sql = irToSqlLocal(compileSemanticQuery(spec, model), dialect);
        const detected = await detectSemanticQuery(sql, MODELS, dialect);
        expect(detected).toEqual(spec);
      });
    }
  }
});
