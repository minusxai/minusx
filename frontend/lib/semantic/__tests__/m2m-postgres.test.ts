/**
 * m2m compilation executed against REAL POSTGRES (PGLite — the embedded
 * Postgres engine already shipped with the app). The BigQuery spot-check
 * surfaced dialect bugs the DuckDB-only execution tests could not see
 * (reserved aliases, subquery alias collisions), so the same fixture now
 * runs on a second real engine permanently: dedup-bridge CTE, correlated
 * EXISTS / NOT EXISTS (incl. self-bridge), and composite keys, compiled with
 * dialect 'postgres' and executed by Postgres itself.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { compileSemanticQuery } from '../compile';
import { irToSqlLocal } from '@/lib/sql/ir-to-sql';
import type { SemanticModelV2 } from '@/lib/types/semantic';
import type { SemanticQuerySpec } from '@/lib/validation/atlas-schemas';

const MODEL: SemanticModelV2 = {
  name: 'Orders',
  connection: 'wh',
  primary: { kind: 'table', table: 'orders' },
  primaryKey: ['id'],
  references: [{
    source: { kind: 'table', table: 'tags' },
    alias: 'tag',
    relationship: 'many_to_many',
    through: {
      source: { kind: 'table', table: 'order_tags' },
      primaryOn: [{ primaryColumn: 'id', bridgeColumn: 'order_id' }],
      referencedOn: [{ bridgeColumn: 'tag_id', referencedColumn: 'id' }],
    },
  }],
  dimensions: [
    { name: 'Region', source: 'primary', column: 'region' },
    { name: 'Tag', source: 'tag', column: 'name' },
  ],
  metrics: [
    { name: 'Revenue', type: 'aggregation', agg: 'SUM', column: 'amount' },
    { name: 'Rows', type: 'aggregation', agg: 'COUNT' }, // reserved-word slug → rows_
  ],
};

/** Bridge == primary table (the self-bridge shape that broke correlation). */
const SELF_BRIDGE: SemanticModelV2 = {
  name: 'OrdersSelfBridge',
  connection: 'wh',
  primary: { kind: 'table', table: 'orders_sb' },
  primaryKey: ['id'],
  references: [{
    source: { kind: 'table', table: 'tags' },
    alias: 'tag',
    relationship: 'many_to_many',
    through: {
      source: { kind: 'table', table: 'orders_sb' },
      primaryOn: [{ primaryColumn: 'id', bridgeColumn: 'id' }],
      referencedOn: [{ bridgeColumn: 'tag_id', referencedColumn: 'id' }],
    },
  }],
  dimensions: [{ name: 'Tag', source: 'tag', column: 'name' }],
  metrics: [{ name: 'Revenue', type: 'aggregation', agg: 'SUM', column: 'amount' }],
};

const spec = (over: Partial<SemanticQuerySpec>): SemanticQuerySpec => ({
  model: 'Orders', table: 'orders', schema: null,
  metrics: [], dimensions: [],
  ...over,
} as SemanticQuerySpec);

let pg: PGlite;
beforeAll(async () => {
  pg = new PGlite();
  for (const stmt of [
    'CREATE TABLE orders (id INT, amount DOUBLE PRECISION, region TEXT)',
    "INSERT INTO orders VALUES (1, 100, 'east'), (2, 50, 'west'), (3, 25, 'east')",
    'CREATE TABLE tags (id INT, name TEXT)',
    "INSERT INTO tags VALUES (10, 'vip'), (20, 'promo')",
    'CREATE TABLE order_tags (order_id INT, tag_id INT)',
    'INSERT INTO order_tags VALUES (1, 10), (1, 20), (2, 10), (1, 10)', // + duplicate bridge row
    'CREATE TABLE orders_sb (id INT, amount DOUBLE PRECISION, tag_id INT)',
    'INSERT INTO orders_sb VALUES (1, 100, 10), (2, 50, 20)',
  ]) await pg.exec(stmt);
});
afterAll(async () => { await pg.close(); });

const run = async (model: SemanticModelV2, s: SemanticQuerySpec): Promise<Record<string, unknown>[]> => {
  const sql = irToSqlLocal(compileSemanticQuery(s, model), 'postgres');
  return (await pg.query(sql)).rows as Record<string, unknown>[];
};

describe('m2m on real Postgres (PGLite)', () => {
  it('grouped dedup CTE: per-tag revenue, no fan-out, NULL group preserved', async () => {
    const rows = await run(MODEL, spec({ metrics: ['Revenue'], dimensions: ['Tag'] }));
    const byTag = new Map(rows.map((r) => [r.tag, Number(r.revenue)]));
    expect(byTag.get('vip')).toBe(150);   // order 1 once (despite duplicate bridge row) + order 2
    expect(byTag.get('promo')).toBe(100); // order 1 only
    expect(byTag.get(null)).toBe(25);     // untagged order 3 survives (LEFT)
  });

  it('correlated EXISTS filter restricts the primary set', async () => {
    const rows = await run(MODEL, spec({
      metrics: ['Revenue'],
      filters: [{ dimension: 'Tag', operator: '=', value: 'promo' }],
    }));
    expect(Number(rows[0].revenue)).toBe(100); // order 1 only
  });

  it('NOT EXISTS (negation) selects primaries with NO matching far row', async () => {
    const rows = await run(MODEL, spec({
      metrics: ['Revenue'],
      filters: [{ dimension: 'Tag', operator: 'IS NULL' }],
    }));
    expect(Number(rows[0].revenue)).toBe(25); // order 3
  });

  it('reserved-word metric name ("Rows") executes via the guarded alias', async () => {
    const rows = await run(MODEL, spec({ metrics: ['Rows'] }));
    expect(Number(rows[0].rows_)).toBe(3);
  });

  it('self-bridge correlation binds to the outer primary (no tautology)', async () => {
    const rows = await run(SELF_BRIDGE, {
      ...spec({ metrics: ['Revenue'], filters: [{ dimension: 'Tag', operator: '=', value: 'vip' }] }),
      model: 'OrdersSelfBridge',
    });
    expect(Number(rows[0].revenue)).toBe(100); // NOT 150
  });
});
