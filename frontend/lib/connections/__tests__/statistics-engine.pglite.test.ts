/**
 * High-fidelity tests for profilePostgres against a real Postgres engine (PGLite).
 *
 * Reproduces the production bug where a connection refresh on a TimescaleDB-flavored
 * Postgres wipes the cached schema to []. Root cause: profilePostgres drops every
 * table whose columns don't appear in pg_stats (empty when the role lacks SELECT
 * on the table OR when ANALYZE has never run). PGLite gives us a fresh, real
 * Postgres where we can recreate the empty-pg_stats state by simply not running
 * ANALYZE.
 */

import { PGlite } from '@electric-sql/pglite';
import { profileDatabase } from '../statistics-engine';
import type { QueryResult, SchemaEntry } from '../base';

type QueryFn = (sql: string) => Promise<QueryResult>;

/** Wrap PGLite as a connectors-shaped QueryFn (columns + types + rows). */
function pgliteQueryFn(db: PGlite): QueryFn {
  return async (sql: string) => {
    const result = await db.query<Record<string, unknown>>(sql);
    const fields = (result as { fields?: Array<{ name: string; dataTypeID: number }> }).fields ?? [];
    return {
      columns: fields.map(f => f.name),
      types: fields.map(() => 'text'),
      rows: result.rows,
    };
  };
}

const TABLES: Array<{ schema: string; table: string; columns: Array<{ name: string; type: string }> }> = [
  { schema: 's1', table: 't1', columns: [{ name: 'id', type: 'integer' }, { name: 'label', type: 'text' }] },
  { schema: 's2', table: 't2', columns: [{ name: 'id', type: 'integer' }, { name: 'value', type: 'double precision' }] },
];

function asSchemaList(): SchemaEntry[] {
  const map = new Map<string, SchemaEntry>();
  for (const { schema, table, columns } of TABLES) {
    if (!map.has(schema)) map.set(schema, { schema, tables: [] });
    map.get(schema)!.tables.push({ table, columns });
  }
  return [...map.values()];
}

describe('profilePostgres (PGLite-backed)', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await db.waitReady;
    await db.exec(`
      CREATE SCHEMA s1;
      CREATE SCHEMA s2;
      CREATE TABLE s1.t1 (id integer, label text);
      CREATE TABLE s2.t2 (id integer, value double precision);
    `);
  });

  afterAll(async () => {
    await db.close();
  });

  it('sanity: pg_stats is empty for the test schemas before any ANALYZE', async () => {
    const r = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM pg_stats WHERE schemaname IN ('s1','s2')`,
    );
    expect(r.rows[0].count).toBe('0');
  });

  it('preserves all tables when pg_stats is empty (regression: production wipe)', async () => {
    const result = await profileDatabase('postgresql', asSchemaList(), pgliteQueryFn(db));

    // Should contain both tables — currently returns [] because every table
    // is silently dropped via `continue` when pg_stats has no entries.
    const t1 = result.schema.find(s => s.schema === 's1')?.tables.find(t => t.table === 't1');
    const t2 = result.schema.find(s => s.schema === 's2')?.tables.find(t => t.table === 't2');

    expect(t1).toBeDefined();
    expect(t2).toBeDefined();
    expect(t1!.columns.map(c => c.name)).toEqual(['id', 'label']);
    expect(t2!.columns.map(c => c.name)).toEqual(['id', 'value']);
  });

  it('still enriches tables that do have pg_stats and preserves the rest', async () => {
    // Insert sample rows + ANALYZE only s1.t1 so pg_stats has entries for it.
    await db.exec(`
      INSERT INTO s1.t1 (id, label)
      SELECT g, 'label-' || (g % 5) FROM generate_series(1, 100) AS g;
      ANALYZE s1.t1;
    `);

    const result = await profileDatabase('postgresql', asSchemaList(), pgliteQueryFn(db));

    const t1 = result.schema.find(s => s.schema === 's1')?.tables.find(t => t.table === 't1');
    const t2 = result.schema.find(s => s.schema === 's2')?.tables.find(t => t.table === 't2');

    expect(t1).toBeDefined();
    expect(t2).toBeDefined();
    // s1.t1 should be enriched (label column is categorical with ~5 distinct values)
    const labelCol = t1!.columns.find(c => c.name === 'label');
    expect(labelCol?.meta?.category).toBe('categorical');
    // s2.t2 should still be present with plain columns (no meta)
    expect(t2!.columns.map(c => c.name)).toEqual(['id', 'value']);
  });

  it('tolerates pg_stats query failures without dropping tables', async () => {
    const realQueryFn = pgliteQueryFn(db);
    const queryFn: QueryFn = async (sql: string) => {
      if (/FROM pg_stats/i.test(sql)) {
        throw new Error('permission denied for view pg_stats');
      }
      return realQueryFn(sql);
    };

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await profileDatabase('postgresql', asSchemaList(), queryFn);
      const t1 = result.schema.find(s => s.schema === 's1')?.tables.find(t => t.table === 't1');
      const t2 = result.schema.find(s => s.schema === 's2')?.tables.find(t => t.table === 't2');
      expect(t1).toBeDefined();
      expect(t2).toBeDefined();
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
