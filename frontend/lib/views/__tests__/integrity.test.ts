/**
 * View integrity — the security boundary and the dependency graph, which are the
 * same mechanism.
 *
 * A view may read anything the DEFINING context's PARENT offers (so it can
 * curate an aggregate of a table this context deliberately hides from users) —
 * and not one table more (so a child admin can never punch through the whitelist
 * chain the org set above them).
 *
 * `reads` is computed from the SQL at the context-SAVE boundary, never trusted
 * from the client — the view dialog, the raw JSON editor and the agent's EditFile
 * all write through the same gate. Every later check is then a cheap set
 * comparison: a parent narrowing its whitelist DISABLES the dependent view
 * (loudly) rather than silently escalating it.
 */
import { describe, it, expect } from 'vitest';
import { computeViewReads, checkViewAvailability, findViewDependents, findViewCycle } from '../integrity';
import type { DatabaseWithSchema, ViewDef } from '@/lib/types';

const view = (name: string, sql: string, extra: Partial<ViewDef> = {}): ViewDef =>
  ({ name, connection: 'warehouse', sql, ...extra });

/** What the parent offers this context. */
const OFFERED: DatabaseWithSchema[] = [{
  databaseName: 'warehouse',
  schemas: [{
    schema: 'mxfood',
    tables: [
      { table: 'orders', columns: [] },
      { table: 'zones', columns: [] },
    ],
  }],
}];

describe('computeViewReads', () => {
  it('records the tables a view reads', async () => {
    const reads = await computeViewReads(
      'SELECT z.zone_name, SUM(o.total) FROM mxfood.orders o JOIN mxfood.zones z ON o.zone_id = z.id GROUP BY 1',
      'duckdb',
    );
    expect(reads.tables).toEqual(expect.arrayContaining([
      { schema: 'mxfood', table: 'orders' },
      { schema: 'mxfood', table: 'zones' },
    ]));
    expect(reads.views).toEqual([]);
  });

  it('records views a view reads (the dependency edge)', async () => {
    const reads = await computeViewReads('SELECT * FROM _views.zone_revenue WHERE revenue > 0', 'duckdb');
    expect(reads.views).toEqual(['zone_revenue']);
    expect(reads.tables).toEqual([]);
  });

  it('allows valid filters that are unsupported by the GUI', async () => {
    const reads = await computeViewReads(
      "SELECT * FROM mxfood.orders WHERE company NOT IN ('internal', 'test')",
      'duckdb',
    );
    expect(reads.tables).toEqual([{ schema: 'mxfood', table: 'orders' }]);
    expect(reads.views).toEqual([]);
  });

  it('sees through the author\'s own CTEs (no hiding a table in a WITH)', async () => {
    const reads = await computeViewReads(
      'WITH x AS (SELECT * FROM mxfood.payroll) SELECT * FROM x',
      'duckdb',
    );
    expect(reads.tables).toEqual([{ schema: 'mxfood', table: 'payroll' }]);
  });
});

describe('checkViewAvailability — the whitelist chain is a real boundary', () => {
  const zoneRevenue = view('zone_revenue',
    'SELECT z.zone_name, o.total FROM mxfood.orders o JOIN mxfood.zones z ON o.zone_id = z.id',
    { reads: { tables: [{ schema: 'mxfood', table: 'orders' }, { schema: 'mxfood', table: 'zones' }], views: [] } });

  it('allows a table the parent OFFERS but this context did not whitelist', () => {
    // The curation case: /org/sales hides `orders` from users but still aggregates it.
    expect(checkViewAvailability(zoneRevenue, OFFERED, [])).toBeNull();
  });

  it('BLOCKS a table the parent does not offer at all (no escalation)', () => {
    const payroll = view('payroll_summary', 'SELECT * FROM mxfood.payroll',
      { reads: { tables: [{ schema: 'mxfood', table: 'payroll' }], views: [] } });
    const problem = checkViewAvailability(payroll, OFFERED, []);
    expect(problem).toMatch(/payroll/);
    expect(problem).toMatch(/not offered|not available/i);
  });

  it('DISABLES a view when the parent later narrows its whitelist', () => {
    const narrowed: DatabaseWithSchema[] = [{
      databaseName: 'warehouse',
      schemas: [{ schema: 'mxfood', tables: [{ table: 'zones', columns: [] }] }], // orders pulled
    }];
    expect(checkViewAvailability(zoneRevenue, narrowed, [])).toMatch(/orders/);
  });

  it('a view that reads another VISIBLE view is fine', () => {
    const derived = view('top_zones', 'SELECT * FROM _views.zone_revenue',
      { reads: { tables: [], views: ['zone_revenue'] } });
    expect(checkViewAvailability(derived, OFFERED, [zoneRevenue])).toBeNull();
  });

  it('does NOT disable views when the connection schema is UNKNOWN (availability != policy)', () => {
    // A transient introspection failure must not nuke every view in the workspace.
    const payroll = view('payroll_summary', 'SELECT * FROM mxfood.payroll',
      { reads: { tables: [{ schema: 'mxfood', table: 'payroll' }], views: [] } });
    expect(checkViewAvailability(payroll, [], [])).toBeNull();
    // ...but a missing view DEPENDENCY is still caught, schema or not.
    const derived = view('top', 'SELECT * FROM _views.gone', { reads: { tables: [], views: ['gone'] } });
    expect(checkViewAvailability(derived, [], [])).toMatch(/gone/);
  });

  it('a view whose dependency has vanished is disabled', () => {
    const derived = view('top_zones', 'SELECT * FROM _views.zone_revenue',
      { reads: { tables: [], views: ['zone_revenue'] } });
    expect(checkViewAvailability(derived, OFFERED, [])).toMatch(/zone_revenue/);
  });
});

describe('unknown schema: fail OPEN on load, fail CLOSED on save', () => {
  const readsPayroll = view('x', 'SELECT * FROM mxfood.payroll',
    { reads: { tables: [{ schema: 'mxfood', table: 'payroll' }], views: [] } });

  it('LOAD (default): unknown schema does not disable a view (transient blip must not nuke everything)', () => {
    expect(checkViewAvailability(readsPayroll, [], [])).toBeNull();
  });

  it('SAVE (strict): unknown schema REFUSES a table read — saving is interactive and retryable', () => {
    const problem = checkViewAvailability(readsPayroll, [], [], { strictUnknownSchema: true });
    expect(problem).toMatch(/could not be verified|verify/i);
  });

  it('SAVE (strict): a VIEW-only read is still fine when schema is unknown (no table to verify)', () => {
    const base = view('z', 'SELECT 1', { reads: { tables: [], views: [] } });
    const derived = view('y', 'SELECT * FROM _views.z', { reads: { tables: [], views: ['z'] } });
    expect(checkViewAvailability(derived, [], [base, derived], { strictUnknownSchema: true })).toBeNull();
  });
});

describe('findViewCycle — cycles are caught at save, not just at query time', () => {
  const withReads = (name: string, views: string[]): ViewDef =>
    ({ name, connection: 'warehouse', sql: '', reads: { tables: [], views } });

  it('detects a two-view cycle', () => {
    const cycle = findViewCycle([withReads('a', ['b']), withReads('b', ['a'])]);
    expect(cycle).toBeTruthy();
    expect(cycle).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('detects a self-referencing cycle (which findViewDependents misses)', () => {
    expect(findViewCycle([withReads('self', ['self'])])).toBeTruthy();
  });

  it('detects a longer cycle a→b→c→a', () => {
    expect(findViewCycle([withReads('a', ['b']), withReads('b', ['c']), withReads('c', ['a'])])).toBeTruthy();
  });

  it('a DAG has no cycle', () => {
    expect(findViewCycle([withReads('a', ['b']), withReads('b', ['c']), withReads('c', [])])).toBeNull();
  });

  it('a missing dependency is not a cycle (handled by availability check)', () => {
    expect(findViewCycle([withReads('a', ['gone'])])).toBeNull();
  });
});

describe('findViewDependents — who breaks if I delete this?', () => {
  const a = view('zone_revenue', 'SELECT 1', { reads: { tables: [], views: [] } });
  const b = view('top_zones', 'SELECT * FROM _views.zone_revenue', { reads: { tables: [], views: ['zone_revenue'] } });
  const c = view('best_zone', 'SELECT * FROM _views.top_zones', { reads: { tables: [], views: ['top_zones'] } });

  it('finds direct and TRANSITIVE dependents', () => {
    expect(findViewDependents('zone_revenue', [a, b, c]).sort()).toEqual(['best_zone', 'top_zones']);
  });

  it('a view nothing depends on is free to delete', () => {
    expect(findViewDependents('best_zone', [a, b, c])).toEqual([]);
  });
});
