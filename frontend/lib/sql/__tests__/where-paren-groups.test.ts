/**
 * Parenthesized WHERE groups must survive the SQL → IR → SQL round-trip.
 *
 * They used to vanish silently: `parseFilterExpression` dispatched on `and`/`or`,
 * a `paren` node matched neither, and `parseSingleCondition` returned null — so
 * `WHERE (x = 1 OR y = 2) AND c = 3` regenerated as `WHERE c = 3`. No error, no
 * warning, a query that still runs and returns MORE ROWS than it should.
 *
 * Production reaches this whenever a query round-trips: `applyNoneParams` the
 * moment any parameter is None, and view resolution for any query mentioning
 * `_views.`. A filter silently widening is the worst failure mode this layer has.
 */
import { describe, it, expect } from 'vitest';
import { parseSqlToIrLocal } from '@/lib/sql/sql-to-ir';
import { irToSqlLocal } from '@/lib/sql/ir-to-sql';
import { applyNoneParams } from '@/lib/sql/none-params';

const DIALECT = 'postgres';

async function roundTrip(sql: string): Promise<string> {
  const ir = await parseSqlToIrLocal(sql, DIALECT);
  return irToSqlLocal(ir as never, DIALECT).replace(/\s+/g, ' ').trim();
}

describe('parenthesized WHERE groups survive the IR round-trip', () => {
  it('keeps an OR group ANDed with another predicate', async () => {
    const out = await roundTrip('SELECT a FROM t WHERE (x = 1 OR y = 2) AND c = 3');
    expect(out).toMatch(/\bOR\b/);
    expect(out).toMatch(/x = 1/);
    expect(out).toMatch(/y = 2/);
    expect(out).toMatch(/c = 3/);
    // Precedence must be preserved — the OR has to stay grouped, or ANDing
    // rebinds it and the filter means something different.
    expect(out).toMatch(/\(\s*x = 1 OR y = 2\s*\)\s*AND\s*c = 3/);
  });

  it('keeps a lone parenthesized AND group', async () => {
    const out = await roundTrip('SELECT a FROM t WHERE (a = 1 AND b = 2)');
    expect(out).toMatch(/a = 1/);
    expect(out).toMatch(/b = 2/);
  });

  it('keeps an OR group on the right-hand side of an AND', async () => {
    const out = await roundTrip('SELECT a FROM t WHERE c = 3 AND (x = 1 OR y = 2)');
    expect(out).toMatch(/\bOR\b/);
    expect(out).toMatch(/c = 3/);
    expect(out).toMatch(/\(\s*x = 1 OR y = 2\s*\)/);
  });

  it('keeps nested groups', async () => {
    const out = await roundTrip('SELECT a FROM t WHERE (x = 1 OR (y = 2 AND z = 3)) AND c = 4');
    expect(out).toMatch(/x = 1/);
    expect(out).toMatch(/y = 2/);
    expect(out).toMatch(/z = 3/);
    expect(out).toMatch(/c = 4/);
    expect(out).toMatch(/\bOR\b/);
  });

  it('applyNoneParams removes only the None filter, leaving the OR group intact', async () => {
    const sql = 'SELECT a FROM t WHERE (x = 1 OR y = 2) AND c = :p';
    const { sql: out } = await applyNoneParams(sql, { p: null }, DIALECT);
    expect(out).not.toMatch(/:p\b/);      // the None filter is gone — that is the feature
    expect(out).toMatch(/\bOR\b/);        // the untouched group survives
    expect(out).toMatch(/x = 1/);
    expect(out).toMatch(/y = 2/);
  });

  it('applyNoneParams leaves a fully-valued query byte-identical (fast path)', async () => {
    const sql = 'SELECT a FROM t WHERE (x = 1 OR y = 2) AND c = :p';
    const { sql: out } = await applyNoneParams(sql, { p: 3 }, DIALECT);
    expect(out).toBe(sql);
  });
});
