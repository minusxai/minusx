// End-to-end guard for the sqlArray() marker through a real PGLite adapter:
// `= ANY($1)` must receive a NATIVE array (not a JSON-stringified one, which both
// PGLite and node-postgres reject as "malformed array literal"), while plain array
// params still bind correctly to JSONB columns.

import { describe, it, expect } from 'vitest';
import { PgliteAdapter } from '../pglite-adapter';
import { sqlArray } from '../types';

describe('sqlArray through PgliteAdapter', () => {
  it('binds sqlArray() as a native array for `= ANY($1)`', async () => {
    const db = new PgliteAdapter();
    await db.exec('CREATE TABLE t (id int)');
    await db.exec('INSERT INTO t VALUES (1),(2),(3),(589),(619),(910)');

    const res = await db.query<{ id: number }>(
      'SELECT id FROM t WHERE id = ANY($1) ORDER BY id',
      [sqlArray([589, 619, 910])],
    );
    expect(res.rows.map((r) => r.id)).toEqual([589, 619, 910]);
  });

  it('binds sqlArray() for an `$1::int[]` cast', async () => {
    const db = new PgliteAdapter();
    await db.exec('CREATE TABLE t2 (id int)');
    await db.exec('INSERT INTO t2 VALUES (10),(20),(30)');

    const res = await db.query<{ id: number }>(
      'SELECT id FROM t2 WHERE id = ANY($1::int[]) ORDER BY id',
      [sqlArray([10, 30])],
    );
    expect(res.rows.map((r) => r.id)).toEqual([10, 30]);
  });

  it('still binds a plain array param to a JSONB column (regression)', async () => {
    const db = new PgliteAdapter();
    await db.exec('CREATE TABLE j (data jsonb)');
    await db.query('INSERT INTO j VALUES ($1)', [[1, 2, 3]]);
    const res = await db.query<{ data: unknown }>('SELECT data FROM j');
    expect(res.rows[0].data).toEqual([1, 2, 3]);
  });
});
