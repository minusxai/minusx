/**
 * What the SQL → IR → SQL round-trip SILENTLY DESTROYS.
 *
 * These are characterization tests: they assert the loss, not the fix. Each one
 * documents a construct the IR cannot represent, which `irToSqlLocal` therefore
 * omits from its output — with no error, no warning, and a query that still runs
 * and still returns rows. Wrong rows.
 *
 * Why this matters in production: `applyNoneParams` takes a FAST PATH and returns
 * the SQL byte-identical when no parameter is None. The instant ONE param is set
 * to None, the WHOLE query round-trips, and every loss below fires at once — on a
 * query the user never edited. That is the shape of the bug this file guards.
 *
 * A FAILURE HERE IS NOT AUTOMATICALLY BAD. If the round-trip learns a construct,
 * the matching test fails because the loss stopped happening — update it to assert
 * preservation. What must never happen is a NEW loss appearing silently.
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

describe('IR round-trip — constructs silently dropped', () => {
  it('drops a RIGHT JOIN entirely — the joined table vanishes from the query', async () => {
    const out = await roundTrip('SELECT a FROM t RIGHT JOIN u ON t.id = u.id');
    expect(out).not.toMatch(/RIGHT JOIN/i);
    expect(out).not.toMatch(/\bu\b/);
    expect(out).toBe('SELECT a FROM t');
  });

  it('drops a parenthesized OR group from WHERE — the filter silently widens', async () => {
    const out = await roundTrip('SELECT a FROM t WHERE (a = 1 OR b = 2) AND c = 3');
    expect(out).not.toMatch(/OR/i);
    expect(out).toBe('SELECT a FROM t WHERE c = 3');
  });

  it('drops an aggregate FILTER (WHERE …) — COUNT returns a different number', async () => {
    const out = await roundTrip('SELECT COUNT(*) FILTER (WHERE a > 1) AS n FROM t');
    expect(out).not.toMatch(/FILTER/i);
    expect(out).toBe('SELECT COUNT(*) AS n FROM t');
  });

  it('drops a NOT (…) predicate — the WHERE clause disappears completely', async () => {
    const out = await roundTrip('SELECT a FROM t WHERE NOT (a = 1)');
    expect(out).not.toMatch(/WHERE/i);
    expect(out).toBe('SELECT a FROM t');
  });

  it('drops a COALESCE(...) IN (...) predicate — the WHERE clause disappears', async () => {
    const out = await roundTrip('SELECT a FROM t WHERE COALESCE(a, 0) IN (1, 2)');
    expect(out).not.toMatch(/WHERE/i);
    expect(out).toBe('SELECT a FROM t');
  });

  it('drops OFFSET while keeping LIMIT — pagination silently returns page 1', async () => {
    const out = await roundTrip('SELECT a FROM t LIMIT 10 OFFSET 5');
    expect(out).not.toMatch(/OFFSET/i);
    expect(out).toBe('SELECT a FROM t LIMIT 10');
  });

  it('drops NULLS LAST from ORDER BY — null placement flips to the engine default', async () => {
    const out = await roundTrip('SELECT a FROM t ORDER BY a DESC NULLS LAST');
    expect(out).not.toMatch(/NULLS/i);
    expect(out).toBe('SELECT a FROM t ORDER BY a DESC');
  });

  it('strips quotes from a quoted alias — emitting SQL that no longer parses', async () => {
    const out = await roundTrip('SELECT a AS "Weird Name" FROM t');
    expect(out).not.toContain('"');
    expect(out).toBe('SELECT a AS Weird Name FROM t');
  });
});

describe('applyNoneParams — where the losses actually reach production', () => {
  it('NO None param: returns the SQL byte-identical, so nothing can be lost', async () => {
    const sql = 'SELECT a FROM t RIGHT JOIN u ON t.id = u.id WHERE t.x = :p LIMIT 10 OFFSET 5';
    const { sql: out, params } = await applyNoneParams(sql, { p: 1 }, DIALECT);
    expect(out).toBe(sql); // untouched — the fast path never parses
    expect(params).toEqual({ p: 1 });
  });

  it('ONE None param round-trips the WHOLE query, taking the RIGHT JOIN and OFFSET with it', async () => {
    const sql = 'SELECT a FROM t RIGHT JOIN u ON t.id = u.id WHERE t.x = :p LIMIT 10 OFFSET 5';
    const { sql: out } = await applyNoneParams(sql, { p: null }, DIALECT);
    // The None filter is correctly removed — that is the feature.
    expect(out).not.toMatch(/:p\b/);
    // These are the collateral losses, on parts of the query the user never touched.
    expect(out).not.toMatch(/RIGHT JOIN/i);
    expect(out).not.toMatch(/OFFSET/i);
  });

  it('ONE None param also destroys an unrelated parenthesized OR group', async () => {
    const sql = 'SELECT a FROM t WHERE (a = 1 OR b = 2) AND c = :p';
    const { sql: out } = await applyNoneParams(sql, { p: null }, DIALECT);
    expect(out).not.toMatch(/OR/i);
  });
});
