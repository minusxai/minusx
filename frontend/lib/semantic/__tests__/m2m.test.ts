/**
 * m2m compilation (Semantic_Model_v2.md §5, M3): grain-preserving dedup-bridge
 * CTE for m2m dimensions, semi-join for m2m filters — proven against real
 * DuckDB with the fixture where a naive join double-counts (order 1 carries
 * two tags), re-authoring the executed derisk scenarios as regression tests.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { DuckDBInstance } from '@duckdb/node-api';
import { compileSemanticQuery, validateSemanticQuery, SemanticCompileError } from '../compile';
import { irToSqlLocal } from '@/lib/sql/ir-to-sql';
import type { SemanticModelV2 } from '@/lib/types/semantic';
import type { SemanticQuerySpec } from '@/lib/validation/atlas-schemas';

const MODEL: SemanticModelV2 = {
  name: 'Orders',
  connection: 'wh',
  primary: { kind: 'table', table: 'orders' },
  primaryKey: ['id'],
  references: [
    {
      source: { kind: 'table', table: 'tags' },
      alias: 'tag',
      relationship: 'many_to_many',
      through: {
        source: { kind: 'table', table: 'order_tags' },
        primaryOn: [{ primaryColumn: 'id', bridgeColumn: 'order_id' }],
        referencedOn: [{ bridgeColumn: 'tag_id', referencedColumn: 'id' }],
      },
    },
    {
      source: { kind: 'table', table: 'categories' },
      alias: 'cat',
      relationship: 'many_to_many',
      through: {
        source: { kind: 'table', table: 'order_categories' },
        primaryOn: [{ primaryColumn: 'id', bridgeColumn: 'order_id' }],
        referencedOn: [{ bridgeColumn: 'category_id', referencedColumn: 'id' }],
      },
    },
  ],
  dimensions: [
    { name: 'Region', source: 'primary', column: 'region' },
    { name: 'Tag', source: 'tag', column: 'name' },
    { name: 'Tag Kind', source: 'tag', column: 'kind' },
    { name: 'Category', source: 'cat', column: 'name' },
  ],
  metrics: [
    { name: 'Order Count', type: 'aggregation', agg: 'COUNT' },
    { name: 'Revenue', type: 'aggregation', agg: 'SUM', column: 'amount' },
  ],
};

/** Composite-key m2m: the primary's grain is (id, region). */
const COMPOSITE: SemanticModelV2 = {
  name: 'OrdersComposite',
  connection: 'wh',
  primary: { kind: 'table', table: 'orders' },
  primaryKey: ['id', 'region'],
  references: [{
    source: { kind: 'table', table: 'tags' },
    alias: 'tag',
    relationship: 'many_to_many',
    through: {
      source: { kind: 'table', table: 'ot_composite' },
      primaryOn: [
        { primaryColumn: 'id', bridgeColumn: 'order_id' },
        { primaryColumn: 'region', bridgeColumn: 'order_region' },
      ],
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

const sqlFor = (s: SemanticQuerySpec, dialect = 'duckdb'): string =>
  irToSqlLocal(compileSemanticQuery(s, MODEL), dialect);

// ── Real-engine fixtures: order 1 has BOTH tags (the fan-out trap) ──────────
const FIXTURES = [
  'CREATE TABLE orders (id INT, amount DOUBLE, region TEXT)',
  "INSERT INTO orders VALUES (1, 100, 'east'), (2, 50, 'west'), (3, 25, 'east')",
  'CREATE TABLE tags (id INT, name TEXT, kind TEXT)',
  // tags 20 and 21 share the NAME 'promo' but differ in `kind` — the shape that
  // exposes a widened dedup grain when a filter column joins the projection.
  "INSERT INTO tags VALUES (10, 'vip', 'manual'), (20, 'promo', 'manual'), (21, 'promo', 'auto')",
  'CREATE TABLE order_tags (order_id INT, tag_id INT)',
  'INSERT INTO order_tags VALUES (1, 10), (1, 20), (1, 21), (2, 10), (1, 10)', // + a DUPLICATE bridge row
  // composite-key bridge: (order_id, order_region) -> tag
  'CREATE TABLE ot_composite (order_id INT, order_region TEXT, tag_id INT)',
  "INSERT INTO ot_composite VALUES (1, 'east', 10), (2, 'west', 10), (1, 'west', 20)", // last row: WRONG region, must not match
  'CREATE TABLE categories (id INT, name TEXT)',
  "INSERT INTO categories VALUES (7, 'food')",
  'CREATE TABLE order_categories (order_id INT, category_id INT)',
  'INSERT INTO order_categories VALUES (1, 7), (2, 7)',
];

let conn: Awaited<ReturnType<DuckDBInstance['connect']>>;
beforeAll(async () => {
  const inst = await DuckDBInstance.create(':memory:');
  conn = await inst.connect();
  for (const s of FIXTURES) await conn.run(s);
});

const run = async (sql: string): Promise<unknown[][]> => {
  const reader = await conn.runAndReadAll(sql);
  return reader.getRows() as unknown[][];
};

describe('m2m dimensions — dedup-bridge CTE, grain-preserving', () => {
  it('per-tag revenue is exactly right where the naive join double-counts', async () => {
    const rows = await run(sqlFor(spec({ metrics: ['Revenue'], dimensions: ['Tag'] })));
    const byTag = new Map(rows.map((r) => [r[0], Number(r[1])]));
    expect(byTag.get('vip')).toBe(150);    // orders 1 + 2, order 1 counted ONCE despite duplicate bridge row
    expect(byTag.get('promo')).toBe(100);  // order 1 only
  });

  it('DOCUMENTATION: the naive join is wrong (250) — this is why the CTE exists', async () => {
    const naive = await run(
      'SELECT SUM(orders.amount) FROM orders JOIN order_tags ON orders.id = order_tags.order_id JOIN tags ON order_tags.tag_id = tags.id',
    );
    expect(Number(naive[0][0])).toBeGreaterThan(250); // 275 with the duplicate bridge row — inflated either way
  });

  it('LEFT semantics: untagged orders appear once under a NULL group', async () => {
    const rows = await run(sqlFor(spec({ metrics: ['Revenue'], dimensions: ['Tag'] })));
    const nullRow = rows.find((r) => r[0] === null);
    expect(nullRow).toBeDefined();
    expect(Number(nullRow![1])).toBe(25);  // order 3
  });

  it('m2m dimension composes with primary dimensions', async () => {
    const rows = await run(sqlFor(spec({ metrics: ['Revenue'], dimensions: ['Region', 'Tag'] })));
    // east+vip = order 1 (100); west+vip = order 2 (50); east+promo = 100; east+NULL = 25
    const key = (r: unknown[]) => `${r[0]}|${r[1]}`;
    const m = new Map(rows.map((r) => [key(r), Number(r[2])]));
    expect(m.get('east|vip')).toBe(100);
    expect(m.get('west|vip')).toBe(50);
    expect(m.get('east|promo')).toBe(100);
    expect(m.get('east|null') ?? m.get('east|NULL') ?? Number(rows.find((r) => r[0] === 'east' && r[1] === null)?.[2])).toBe(25);
  });

  it('a filter on the GROUPED m2m alias is applied INSIDE the dedup CTE', async () => {
    const rows = await run(sqlFor(spec({
      metrics: ['Revenue'], dimensions: ['Tag'],
      filters: [{ dimension: 'Tag', operator: '=', value: 'vip' }],
    })));
    expect(rows).toHaveLength(1);
    expect(rows[0][0]).toBe('vip');
    expect(Number(rows[0][1])).toBe(150);
  });

  it('GRAIN: a filter on a DIFFERENT far column must not widen the dedup grain', async () => {
    // Two DISTINCT tag rows share name 'promo' but differ in `kind`. Projecting
    // the filter column into the CTE would keep both rows for one order and
    // double-count it inside the 'promo' group.
    const rows = await run(sqlFor(spec({
      metrics: ['Revenue'], dimensions: ['Tag'],
      filters: [{ dimension: 'Tag Kind', operator: 'IN', value: ['manual', 'auto'] }],
    })));
    const promo = rows.find((r) => r[0] === 'promo');
    expect(Number(promo![1])).toBe(100); // order 1 once, NOT 200
  });

  it('a filter on the grouped alias RESTRICTS the primary set (no NULL group when filtering)', async () => {
    const rows = await run(sqlFor(spec({
      metrics: ['Revenue'], dimensions: ['Tag'],
      filters: [{ dimension: 'Tag', operator: '=', value: 'vip' }],
    })));
    expect(rows.every((r) => r[0] !== null)).toBe(true); // untagged order 3 excluded
  });

  it('golden: renders WITH dedup CTE + LEFT join on the primary key in all three dialects', () => {
    for (const dialect of ['duckdb', 'bigquery', 'postgres']) {
      const sql = sqlFor(spec({ metrics: ['Revenue'], dimensions: ['Tag'] }), dialect);
      expect(sql).toMatch(/^WITH _m2m_tag AS \(\nSELECT DISTINCT /);
      expect(sql).toContain('LEFT JOIN _m2m_tag ON orders.id = _m2m_tag._pk0');
      expect(sql).toContain('GROUP BY _m2m_tag.name');
    }
  });
});

describe('m2m filters — semi-join, never fans out', () => {
  it('filter-only m2m compiles to a correlated EXISTS and returns the right total', async () => {
    const sql = sqlFor(spec({
      metrics: ['Revenue'],
      filters: [{ dimension: 'Tag', operator: '=', value: 'vip' }],
    }));
    expect(sql).toContain('EXISTS (SELECT 1');
    expect(sql).toContain('order_tags.order_id = orders.id'); // correlated, not an IN-list
    const rows = await run(sql);
    expect(Number(rows[0][0])).toBe(150); // orders 1 + 2, each once
  });

  it('multiple filter-only m2m references compose as independent semi-joins', async () => {
    const sql = sqlFor(spec({
      metrics: ['Revenue'],
      filters: [
        { dimension: 'Tag', operator: '=', value: 'promo' },
        { dimension: 'Category', operator: '=', value: 'food' },
      ],
    }));
    const rows = await run(sql);
    expect(Number(rows[0][0])).toBe(100); // order 1 only (promo ∩ food)
  });

  it('IN-list filters work through the semi-join', async () => {
    const rows = await run(sqlFor(spec({
      metrics: ['Order Count'],
      filters: [{ dimension: 'Tag', operator: 'IN', value: ['vip', 'promo'] }],
    })));
    expect(Number(rows[0][0])).toBe(2); // orders 1 and 2, once each
  });
});

describe('m2m validator rules', () => {
  it('rejects GROUP BY dimensions from more than one m2m reference', () => {
    const issues = validateSemanticQuery(spec({ metrics: ['Revenue'], dimensions: ['Tag', 'Category'] }), MODEL);
    expect(issues.some((i) => /at most one|one m2m/i.test(i))).toBe(true);
    expect(() => compileSemanticQuery(spec({ metrics: ['Revenue'], dimensions: ['Tag', 'Category'] }), MODEL))
      .toThrow(SemanticCompileError);
  });

  it('accepts negated m2m filters (compiled as NOT EXISTS)', () => {
    for (const operator of ['!=', 'IS NOT NULL', 'IS NULL'] as const) {
      expect(validateSemanticQuery(spec({
        metrics: ['Revenue'],
        filters: [{ dimension: 'Tag', operator, value: 'vip' }],
      }), MODEL)).toEqual([]);
    }
  });

  it('still allows negation on NON-m2m dimensions', () => {
    const issues = validateSemanticQuery(spec({
      metrics: ['Revenue'],
      filters: [{ dimension: 'Region', operator: '!=', value: 'east' }],
    }), MODEL);
    expect(issues).toEqual([]);
  });
});

describe('m2m negation — NOT EXISTS, NULL-safe', () => {
  it('"not tagged vip" excludes tagged orders and keeps untagged ones', async () => {
    const sql = sqlFor(spec({
      metrics: ['Revenue'],
      filters: [{ dimension: 'Tag', operator: '!=', value: 'vip' }],
    }));
    expect(sql).toContain('NOT EXISTS (SELECT 1');
    const rows = await run(sql);
    // orders 1 and 2 carry vip; only order 3 (25) survives — and it survives
    // BECAUSE NOT EXISTS is null-safe, unlike NOT IN over a nullable column.
    expect(Number(rows[0][0])).toBe(25);
  });

  it('IS NULL means "has no related row at all"', async () => {
    const rows = await run(sqlFor(spec({
      metrics: ['Revenue'],
      filters: [{ dimension: 'Tag', operator: 'IS NULL' }],
    })));
    expect(Number(rows[0][0])).toBe(25); // only the untagged order
  });

  it('IS NOT NULL means "has at least one related row"', async () => {
    const rows = await run(sqlFor(spec({
      metrics: ['Revenue'],
      filters: [{ dimension: 'Tag', operator: 'IS NOT NULL' }],
    })));
    expect(Number(rows[0][0])).toBe(150); // orders 1 + 2, each once
  });
});

describe('composite-key m2m', () => {
  const csql = (s2: SemanticQuerySpec, dialect = 'duckdb') =>
    irToSqlLocal(compileSemanticQuery(s2, COMPOSITE), dialect);

  it('filter correlates on EVERY key column (a partial match must not count)', async () => {
    const sql = csql(spec({
      model: 'OrdersComposite', metrics: ['Revenue'],
      filters: [{ dimension: 'Tag', operator: '=', value: 'promo' }],
    }));
    const rows = await run(sql);
    // Only (1,'west') is tagged promo, but order 1 IS 'east' — the bridge row
    // matches on order_id alone and must be rejected by the region condition.
    expect(rows[0][0]).toBe(null);
  });

  it('groups by an m2m dimension at the composite grain without fan-out', async () => {
    const rows = await run(csql(spec({
      model: 'OrdersComposite', metrics: ['Revenue'], dimensions: ['Tag'],
    })));
    const byTag = new Map(rows.map((r) => [r[0], Number(r[1])]));
    expect(byTag.get('vip')).toBe(150); // (1,east) + (2,west)
    // The (1,'west',20) bridge row matches order 1 on order_id ALONE — its
    // region is wrong, so promo must not surface as a group at all. A CTE
    // keyed on a prefix of the composite key leaks it in.
    expect(byTag.has('promo')).toBe(false);
  });

  it('golden: the dedup CTE carries EVERY key column, and the join maps them all', () => {
    const sql = csql(spec({
      model: 'OrdersComposite', metrics: ['Revenue'], dimensions: ['Tag'],
    }));
    expect(sql).toContain('ot_composite.order_id AS _pk0');
    expect(sql).toContain('ot_composite.order_region AS _pk1');
    expect(sql).toContain('ON orders.id = _m2m_tag._pk0 AND orders.region = _m2m_tag._pk1');
  });

  it('golden: correlated EXISTS names every key pair, in all three dialects', () => {
    for (const dialect of ['duckdb', 'bigquery', 'postgres']) {
      const sql = csql(spec({
        model: 'OrdersComposite', metrics: ['Revenue'],
        filters: [{ dimension: 'Tag', operator: '=', value: 'vip' }],
      }), dialect);
      expect(sql).toContain('ot_composite.order_id = orders.id');
      expect(sql).toContain('ot_composite.order_region = orders.region');
    }
  });
});

