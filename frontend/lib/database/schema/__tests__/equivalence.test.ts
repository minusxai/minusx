/**
 * Guards on the rendered schema.
 *
 * The cutover comparison — hand-written SQL vs rendered declaration — lived here while
 * the two coexisted. `POSTGRES_SCHEMA` is now rendered FROM the declaration, so
 * comparing them would compare a thing to itself. The enduring guard is the golden
 * snapshot in `../../__tests__/schema-shape.test.ts`, which was recorded from the
 * original hand-written SQL and still matches: that is the evidence the generated
 * schema builds the same database.
 *
 * What remains here is what the snapshot cannot express.
 */

import { PgliteAdapter } from '@/lib/database/adapter/pglite-adapter';
import { POSTGRES_SCHEMA } from '@/lib/database/postgres-schema';
import { renderSchema } from '@/lib/database/schema/render';
import { TABLES } from '@/lib/database/schema/tables';
import { introspectSchema, renderSchemaShape } from '@/test/harness/schema-introspect';

async function applied(sql: string): Promise<PgliteAdapter> {
  const adapter = new PgliteAdapter();
  await adapter.exec(sql);
  return adapter;
}

describe('rendered schema', () => {
  it('applies cleanly and creates every declared table', async () => {
    const adapter = await applied(POSTGRES_SCHEMA);
    const shape = await introspectSchema(adapter);

    expect(shape.map(t => t.name).sort()).toEqual(TABLES.map(t => t.name).sort());
  });

  it('is idempotent — re-applying changes nothing', async () => {
    const adapter = await applied(POSTGRES_SCHEMA);
    const first = renderSchemaShape(await introspectSchema(adapter));

    await adapter.exec(POSTGRES_SCHEMA);

    expect(renderSchemaShape(await introspectSchema(adapter))).toBe(first);
  });

  it('names every primary key <table>_pkey', async () => {
    // Upserts target the PK by name so they survive a variant that adds scoping
    // columns. An explicit CONSTRAINT clause in the renderer would break them all.
    const adapter = await applied(POSTGRES_SCHEMA);
    const { rows } = await adapter.query<{ tablename: string; conname: string }>(
      `SELECT c.relname AS tablename, con.conname
         FROM pg_constraint con
         JOIN pg_class c ON c.oid = con.conrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE con.contype = 'p' AND n.nspname = current_schema()`,
    );

    expect(rows).toHaveLength(TABLES.length);
    expect(rows.filter(r => r.conname !== `${r.tablename}_pkey`)).toEqual([]);
  });

  it('declares a scope for every table and every unique constraint', async () => {
    // Both default to the safe-looking answer if forgotten, and both fail OPEN: a
    // table nobody scoped is shared, a unique nobody scoped is global.
    for (const table of TABLES) {
      expect(table.scope, `${table.name}.scope`).toMatch(/^(shared|per-namespace|public)$/);
      for (const u of table.uniques ?? []) {
        expect(u.scope, `${table.name} UNIQUE(${u.columns.join(',')})`).toMatch(/^(scoped|global)$/);
      }
    }
  });
});

describe('the renderer round-trips through a real database', () => {
  // Rendering is only half the contract: what Postgres ends up with has to match what
  // was declared. This catches a renderer that emits syntactically valid SQL for the
  // wrong thing — a DESC that lands ASC, a partial index without its predicate.
  it('creates every declared index, with its predicate and method intact', async () => {
    const adapter = await applied(renderSchema(TABLES));

    for (const table of TABLES) {
      const { rows } = await adapter.query<{ indexname: string; indexdef: string }>(
        `SELECT indexname, indexdef FROM pg_indexes
          WHERE schemaname = current_schema() AND tablename = $1`,
        [table.name],
      );
      const byName = Object.fromEntries(rows.map(r => [r.indexname, r.indexdef]));

      for (const index of table.indexes ?? []) {
        const def = byName[index.name];
        expect(def, `${table.name}.${index.name} missing`).toBeDefined();
        if (index.where) expect(def).toContain('WHERE');
        if (index.using) expect(def).toContain(index.using);
        if (index.unique) expect(def).toContain('UNIQUE');
        for (const col of index.columns) {
          if (typeof col === 'string') expect(def).toContain(col);
          else if ('direction' in col) expect(def).toContain(`${col.column} DESC`);
        }
      }
    }
  });
});
