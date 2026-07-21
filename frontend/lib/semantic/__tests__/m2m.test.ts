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
  measures: [
    { name: 'Order Count', agg: 'COUNT' },
    { name: 'Revenue', agg: 'SUM', column: 'amount' },
  ],
};

const spec = (over: Partial<SemanticQuerySpec>): SemanticQuerySpec => ({
  model: 'Orders', table: 'orders', schema: null,
  measures: [], dimensions: [],
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
    const rows = await run(sqlFor(spec({ measures: ['Revenue'], dimensions: ['Tag'] })));
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
    const rows = await run(sqlFor(spec({ measures: ['Revenue'], dimensions: ['Tag'] })));
    const nullRow = rows.find((r) => r[0] === null);
    expect(nullRow).toBeDefined();
    expect(Number(nullRow![1])).toBe(25);  // order 3
  });

  it('m2m dimension composes with primary dimensions', async () => {
    const rows = await run(sqlFor(spec({ measures: ['Revenue'], dimensions: ['Region', 'Tag'] })));
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
      measures: ['Revenue'], dimensions: ['Tag'],
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
      measures: ['Revenue'], dimensions: ['Tag'],
      filters: [{ dimension: 'Tag Kind', operator: 'IN', value: ['manual', 'auto'] }],
    })));
    const promo = rows.find((r) => r[0] === 'promo');
    expect(Number(promo![1])).toBe(100); // order 1 once, NOT 200
  });

  it('a filter on the grouped alias RESTRICTS the primary set (no NULL group when filtering)', async () => {
    const rows = await run(sqlFor(spec({
      measures: ['Revenue'], dimensions: ['Tag'],
      filters: [{ dimension: 'Tag', operator: '=', value: 'vip' }],
    })));
    expect(rows.every((r) => r[0] !== null)).toBe(true); // untagged order 3 excluded
  });

  it('golden: renders WITH dedup CTE + LEFT join on the primary key in all three dialects', () => {
    for (const dialect of ['duckdb', 'bigquery', 'postgres']) {
      const sql = sqlFor(spec({ measures: ['Revenue'], dimensions: ['Tag'] }), dialect);
      expect(sql).toMatch(/^WITH _m2m_tag AS \(\nSELECT DISTINCT /);
      expect(sql).toContain('LEFT JOIN _m2m_tag ON orders.id = _m2m_tag._pk');
      expect(sql).toContain('GROUP BY _m2m_tag.name');
    }
  });
});

describe('m2m filters — semi-join, never fans out', () => {
  it('filter-only m2m compiles to pk IN (bridge subquery) and returns the right total', async () => {
    const sql = sqlFor(spec({
      measures: ['Revenue'],
      filters: [{ dimension: 'Tag', operator: '=', value: 'vip' }],
    }));
    expect(sql).toContain('orders.id IN (SELECT');
    const rows = await run(sql);
    expect(Number(rows[0][0])).toBe(150); // orders 1 + 2, each once
  });

  it('multiple filter-only m2m references compose as independent semi-joins', async () => {
    const sql = sqlFor(spec({
      measures: ['Revenue'],
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
      measures: ['Order Count'],
      filters: [{ dimension: 'Tag', operator: 'IN', value: ['vip', 'promo'] }],
    })));
    expect(Number(rows[0][0])).toBe(2); // orders 1 and 2, once each
  });
});

describe('m2m validator rules', () => {
  it('rejects GROUP BY dimensions from more than one m2m reference', () => {
    const issues = validateSemanticQuery(spec({ measures: ['Revenue'], dimensions: ['Tag', 'Category'] }), MODEL);
    expect(issues.some((i) => /at most one|one m2m/i.test(i))).toBe(true);
    expect(() => compileSemanticQuery(spec({ measures: ['Revenue'], dimensions: ['Tag', 'Category'] }), MODEL))
      .toThrow(SemanticCompileError);
  });

  it('rejects negated m2m filters with a pointing error', () => {
    for (const operator of ['!=', 'IS NOT NULL', 'IS NULL'] as const) {
      const issues = validateSemanticQuery(spec({
        measures: ['Revenue'],
        filters: [{ dimension: 'Tag', operator, value: 'vip' }],
      }), MODEL);
      expect(issues.some((i) => /positive membership|negat/i.test(i))).toBe(true);
    }
  });

  it('still allows negation on NON-m2m dimensions', () => {
    const issues = validateSemanticQuery(spec({
      measures: ['Revenue'],
      filters: [{ dimension: 'Region', operator: '!=', value: 'east' }],
    }), MODEL);
    expect(issues).toEqual([]);
  });
});
