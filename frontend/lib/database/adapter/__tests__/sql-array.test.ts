// End-to-end guard for the sqlArray() marker through a real PGLite adapter:
// `= ANY($1)` must receive a NATIVE array (not a JSON-stringified one, which both
// PGLite and node-postgres reject as "malformed array literal"), while plain array
// params still bind correctly to JSONB columns.

import { describe, it, expect, beforeAll } from 'vitest';
import { PgliteAdapter } from '../pglite-adapter';
import { sqlArray, isSqlArray } from '../types';

describe('sqlArray through PgliteAdapter', () => {
  // One PGLite cold-boot for the whole suite — each test uses a unique table name,
  // so there's no cross-test data leakage and no need to reset between tests.
  let db: PgliteAdapter;
  beforeAll(() => {
    db = new PgliteAdapter();
  });

  it('binds sqlArray() as a native array for `= ANY($1)`', async () => {
    await db.exec('CREATE TABLE t (id int)');
    await db.exec('INSERT INTO t VALUES (1),(2),(3),(589),(619),(910)');

    const res = await db.query<{ id: number }>(
      'SELECT id FROM t WHERE id = ANY($1) ORDER BY id',
      [sqlArray([589, 619, 910])],
    );
    expect(res.rows.map((r) => r.id)).toEqual([589, 619, 910]);
  });

  it('binds sqlArray() for an `$1::int[]` cast', async () => {
    await db.exec('CREATE TABLE t2 (id int)');
    await db.exec('INSERT INTO t2 VALUES (10),(20),(30)');

    const res = await db.query<{ id: number }>(
      'SELECT id FROM t2 WHERE id = ANY($1::int[]) ORDER BY id',
      [sqlArray([10, 30])],
    );
    expect(res.rows.map((r) => r.id)).toEqual([10, 30]);
  });

  it('still binds a plain array param to a JSONB column (regression)', async () => {
    await db.exec('CREATE TABLE j (data jsonb)');
    await db.query('INSERT INTO j VALUES ($1)', [[1, 2, 3]]);
    const res = await db.query<{ data: unknown }>('SELECT data FROM j');
    expect(res.rows[0].data).toEqual([1, 2, 3]);
  });

  // Regression: SqlArray must be detected via its brand, NOT `instanceof` —
  // Turbopack can duplicate the module across bundles, giving an SqlArray that
  // fails `instanceof` and leaks raw into PGLite (TypeError "src must be of type
  // string" → poisons the single connection → cascading 08P01 / empty params).
  it('binds a foreign-bundle SqlArray (branded, NOT instanceof) as a native array', async () => {
    await db.exec('CREATE TABLE tf (id int)');
    await db.exec('INSERT INTO tf VALUES (1),(2),(589),(619)');

    // Simulates an SqlArray created in a different bundle: same brand, different class.
    const foreign = { __isSqlArray: true, values: [589, 619] } as unknown as ReturnType<typeof sqlArray>;

    const res = await db.query<{ id: number }>(
      'SELECT id FROM tf WHERE id = ANY($1) ORDER BY id',
      [foreign],
    );
    expect(res.rows.map((r) => r.id)).toEqual([589, 619]);
  });
});

describe('isSqlArray (cross-bundle brand detection)', () => {
  it('detects a real SqlArray and a foreign branded one; rejects plain values', () => {
    expect(isSqlArray(sqlArray([1, 2]))).toBe(true);
    expect(isSqlArray({ __isSqlArray: true, values: [1, 2] })).toBe(true); // foreign bundle
    expect(isSqlArray([1, 2])).toBe(false);
    expect(isSqlArray({ values: [1, 2] })).toBe(false);
    expect(isSqlArray(null)).toBe(false);
    expect(isSqlArray('x')).toBe(false);
  });
});
