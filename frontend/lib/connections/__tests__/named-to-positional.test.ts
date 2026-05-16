// Regression for: Postgres CREATE catalog enrichment failing with
// "syntax error at or near ':'" — the connector's `:paramName → $N`
// substitution greedily matched the second `:` of `::text` casts.
// All SQL connectors share this substitution path; the fix lives in
// one helper.

import { describe, it, expect } from 'vitest';
import { namedToPositional } from '../named-to-positional';

describe('namedToPositional', () => {
  it('substitutes :name → $N with collected values', () => {
    const r = namedToPositional("SELECT * FROM t WHERE x = :x AND y = :y", { x: 1, y: 'a' });
    expect(r.sql).toBe('SELECT * FROM t WHERE x = $1 AND y = $2');
    expect(r.values).toEqual([1, 'a']);
  });

  it('reuses the same positional index for repeated names', () => {
    const r = namedToPositional("SELECT :x, :x, :y", { x: 7, y: 9 });
    expect(r.sql).toBe('SELECT $1, $1, $2');
    expect(r.values).toEqual([7, 9]);
  });

  it('leaves `::cast` operators intact (regression: pg_stats query)', () => {
    // The PostgreSQL type-cast `::text` looks like `:` then `:text` to a
    // naive regex. The fix is a negative lookbehind — `(?<!:):name`.
    const r = namedToPositional("SELECT col::text FROM t", {});
    expect(r.sql).toBe('SELECT col::text FROM t');
    expect(r.values).toEqual([]);
  });

  it('handles mixed `::cast` AND real named params in the same query', () => {
    const r = namedToPositional(
      "SELECT col::text FROM t WHERE id = :id AND name::varchar = :name",
      { id: 42, name: 'foo' },
    );
    expect(r.sql).toBe('SELECT col::text FROM t WHERE id = $1 AND name::varchar = $2');
    expect(r.values).toEqual([42, 'foo']);
  });

  it("supplies `null` for params not in the params map (forgives missing keys)", () => {
    const r = namedToPositional("SELECT :missing", {});
    expect(r.sql).toBe('SELECT $1');
    expect(r.values).toEqual([null]);
  });
});
