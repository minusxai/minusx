/**
 * View resolution — a query that reads `_views.<view>` is rewritten in IR land
 * to inline the view's SQL as a CTE. Views may read other views (resolved
 * recursively, topologically ordered); cycles and unknown views are hard errors.
 *
 * Correctness here is proven by EXECUTION against a real in-memory DuckDB (the
 * same discipline as the semantic compile-execute suite): a resolved query must
 * not merely look right, it must bind and return the right rows.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { resolveViewsInSql, extractViewRefs, validateViews, ViewResolutionError, type HydratedView } from '../resolve';
import type { ViewDef } from '@/lib/types';

const DDL = `
CREATE SCHEMA mxfood;
CREATE TABLE mxfood.orders (id BIGINT, zone_id BIGINT, total DOUBLE, status VARCHAR, created_at TIMESTAMP);
CREATE TABLE mxfood.zones (id BIGINT, zone_name VARCHAR);
INSERT INTO mxfood.orders VALUES
  (1, 10, 100.0, 'completed', TIMESTAMP '2024-01-05'),
  (2, 10, 50.0,  'completed', TIMESTAMP '2024-01-06'),
  (3, 20, 70.0,  'cancelled', TIMESTAMP '2024-02-01'),
  (4, 20, 30.0,  'completed', TIMESTAMP '2024-02-02');
INSERT INTO mxfood.zones VALUES (10, 'North'), (20, 'South');
`;

const view = (name: string, sql: string): HydratedView => ({ name, connection: 'warehouse', sql });

/** revenue per zone — the multi-table join the semantic layer can't express. */
const ZONE_REVENUE = view('zone_revenue', `
  SELECT z.zone_name, o.status, SUM(o.total) AS revenue, COUNT(*) AS orders
  FROM mxfood.orders o
  JOIN mxfood.zones z ON o.zone_id = z.id
  GROUP BY z.zone_name, o.status
`);

/** a view ON a view */
const COMPLETED_ZONE_REVENUE = view('completed_zone_revenue', `
  SELECT zone_name, revenue FROM _views.zone_revenue WHERE status = 'completed'
`);

const VIEWS = [ZONE_REVENUE, COMPLETED_ZONE_REVENUE];

describe('extractViewRefs', () => {
  it('finds view references, ignoring ordinary tables', async () => {
    expect(await extractViewRefs('SELECT * FROM _views.zone_revenue', 'duckdb')).toEqual(['zone_revenue']);
    expect(await extractViewRefs('SELECT * FROM mxfood.orders', 'duckdb')).toEqual([]);
  });

  it('finds views referenced in joins', async () => {
    const refs = await extractViewRefs(
      'SELECT * FROM mxfood.orders o JOIN _views.zone_revenue r ON o.status = r.status',
      'duckdb',
    );
    expect(refs).toEqual(['zone_revenue']);
  });
});

describe('resolveViewsInSql — no-op paths', () => {
  it('returns SQL untouched when it references no views (byte-identical)', async () => {
    const sql = 'SELECT * FROM mxfood.orders WHERE status = \'completed\'';
    expect(await resolveViewsInSql(sql, 'duckdb', VIEWS)).toBe(sql);
  });

  it('leaves exotic/unparseable SQL alone when it references no views', async () => {
    const sql = "SELECT * FROM `analytics.events_*` WHERE _TABLE_SUFFIX BETWEEN '1' AND '2'";
    expect(await resolveViewsInSql(sql, 'bigquery', VIEWS)).toBe(sql);
  });
});

describe('resolveViewsInSql — errors', () => {
  it('unknown view is a hard error', async () => {
    await expect(resolveViewsInSql('SELECT * FROM _views.nope', 'duckdb', VIEWS))
      .rejects.toThrow(ViewResolutionError);
  });

  it('cycles are detected, not stack-overflowed', async () => {
    const a = view('a', 'SELECT * FROM _views.b');
    const b = view('b', 'SELECT * FROM _views.a');
    await expect(resolveViewsInSql('SELECT * FROM _views.a', 'duckdb', [a, b]))
      .rejects.toThrow(/circular/i);
  });

  it('a self-referencing view is a cycle', async () => {
    const self = view('self', 'SELECT * FROM _views.self');
    await expect(resolveViewsInSql('SELECT * FROM _views.self', 'duckdb', [self]))
      .rejects.toThrow(/circular/i);
  });
});

describe('resolveViewsInSql — executes correctly (real DuckDB)', () => {
  let db: DuckDBConnection;

  beforeAll(async () => {
    const instance = await DuckDBInstance.create(':memory:');
    db = await instance.connect();
    await db.run(DDL);
  });
  afterAll(() => db?.closeSync());

  const run = async (sql: string) => {
    const resolved = await resolveViewsInSql(sql, 'duckdb', VIEWS);
    return (await db.runAndReadAll(resolved)).getRows();
  };

  it('a plain view read returns the view\'s rows', async () => {
    const rows = await run('SELECT zone_name, revenue FROM _views.zone_revenue ORDER BY zone_name, revenue');
    expect(rows).toEqual([
      ['North', 150],
      ['South', 30],
      ['South', 70],
    ]);
  });

  it('a view can be filtered, grouped and aggregated like a table', async () => {
    const rows = await run(`
      SELECT zone_name, SUM(revenue) AS r FROM _views.zone_revenue
      WHERE status = 'completed' GROUP BY zone_name ORDER BY zone_name
    `);
    expect(rows).toEqual([['North', 150], ['South', 30]]);
  });

  it('a view JOINed against a real table binds correctly', async () => {
    const rows = await run(`
      SELECT r.zone_name, r.revenue
      FROM _views.zone_revenue r
      JOIN mxfood.zones z ON r.zone_name = z.zone_name
      WHERE r.status = 'completed' ORDER BY r.zone_name
    `);
    expect(rows).toEqual([['North', 150], ['South', 30]]);
  });

  it('view-on-view resolves transitively (both CTEs emitted, ordered)', async () => {
    const rows = await run('SELECT zone_name, revenue FROM _views.completed_zone_revenue ORDER BY zone_name');
    expect(rows).toEqual([['North', 150], ['South', 30]]);
  });

  it('two views in one query each resolve once', async () => {
    const resolved = await resolveViewsInSql(
      `SELECT a.zone_name FROM _views.zone_revenue a
       JOIN _views.completed_zone_revenue b ON a.zone_name = b.zone_name`,
      'duckdb', VIEWS,
    );
    // zone_revenue is needed by BOTH the query and completed_zone_revenue — emitted once.
    expect(resolved.match(/_views_zone_revenue AS \(/g)?.length).toBe(1);
    const rows = (await db.runAndReadAll(resolved)).getRows();
    expect(rows.length).toBeGreaterThan(0);
  });

  it('the user\'s own CTEs survive alongside view CTEs', async () => {
    const rows = await run(`
      WITH big AS (SELECT * FROM _views.zone_revenue WHERE revenue > 50)
      SELECT zone_name FROM big ORDER BY zone_name
    `);
    expect(rows).toEqual([['North'], ['South']]);
  });
});

describe('column whitelist — projection is REAL enforcement', () => {
  let db: DuckDBConnection;
  beforeAll(async () => {
    const instance = await DuckDBInstance.create(':memory:');
    db = await instance.connect();
    await db.run(DDL);
  });
  afterAll(() => db?.closeSync());

  // zone_revenue exposes zone_name, status, revenue, orders — hide the money.
  const RESTRICTED = { ...ZONE_REVENUE, whitelistedColumns: ['zone_name', 'orders'] };

  it('projects the view to its whitelisted columns only', async () => {
    const sql = await resolveViewsInSql('SELECT * FROM _views.zone_revenue', 'duckdb', [RESTRICTED]);
    const reader = await db.runAndReadAll(sql);
    expect(reader.columnNames().sort()).toEqual(['orders', 'zone_name']);
  });

  it('a deselected column genuinely does not exist — even if a query names it', async () => {
    const sql = await resolveViewsInSql(
      'SELECT zone_name, revenue FROM _views.zone_revenue', 'duckdb', [RESTRICTED],
    );
    // The engine itself rejects it: the column is gone, not merely hidden.
    await expect(db.runAndReadAll(sql)).rejects.toThrow(/revenue/i);
  });

  it('no whitelist = every column exposed', async () => {
    const sql = await resolveViewsInSql('SELECT * FROM _views.zone_revenue', 'duckdb', [ZONE_REVENUE]);
    const reader = await db.runAndReadAll(sql);
    expect(reader.columnNames()).toEqual(expect.arrayContaining(['zone_name', 'status', 'revenue', 'orders']));
  });
});

describe('validateViews', () => {
  const own = [view('revenue', 'SELECT 1')];

  it('accepts a well-formed view', () => {
    expect(validateViews(own, [])).toEqual([]);
  });

  it('rejects bad identifiers (the name goes into SQL)', () => {
    expect(validateViews([view('has space', 'SELECT 1')], []).length).toBeGreaterThan(0);
    expect(validateViews([view('1leading', 'SELECT 1')], []).length).toBeGreaterThan(0);
    expect(validateViews([view('', 'SELECT 1')], []).length).toBeGreaterThan(0);
  });

  it('rejects empty SQL', () => {
    expect(validateViews([view('ok', '   ')], []).length).toBeGreaterThan(0);
  });

  it('rejects duplicates within the version', () => {
    expect(validateViews([view('dup', 'SELECT 1'), view('dup', 'SELECT 2')], []).length).toBeGreaterThan(0);
  });

  it('rejects shadowing an INHERITED view (no silent overrides)', () => {
    const errors = validateViews(own, [view('revenue', 'SELECT 2')]);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/inherited/i);
  });

  it('scopes collisions by connection — same name on a different engine is fine', () => {
    const other: ViewDef = { ...view('revenue', 'SELECT 2'), connection: 'other' };
    expect(validateViews(own, [other])).toEqual([]);
  });
});
