/**
 * The declaration must describe the SAME database the shipped DDL builds.
 *
 * Comparing SQL text would prove nothing — two spellings of the same table are equal,
 * and `IF NOT EXISTS` means a statement that differs from what is deployed is skipped
 * silently. So both are applied to real databases and the resulting CATALOGS are
 * compared: columns, defaults, nullability, constraints, indexes, triggers.
 *
 * This is what makes the cutover checkable. Until every table is converted, it runs
 * per-table against the corresponding slice of the shipped schema.
 */

import { PgliteAdapter } from '@/lib/database/adapter/pglite-adapter';
import { POSTGRES_SCHEMA } from '@/lib/database/postgres-schema';
import { renderSchema } from '@/lib/database/schema/render';
import { TABLES } from '@/lib/database/schema/tables';
import type { Table } from '@/lib/database/schema/types';
import { introspectSchema, renderSchemaShape, type TableShape } from '@/test/harness/schema-introspect';

/**
 * Apply the shipped DDL, then keep only the tables under test. Slicing the STATEMENTS
 * instead would need a dependency-aware filter; applying everything and comparing the
 * relevant tables is exact and needs no such judgement.
 */
async function shippedShapes(names: string[]): Promise<TableShape[]> {
  const adapter = new PgliteAdapter();
  await adapter.exec(POSTGRES_SCHEMA);
  const all = await introspectSchema(adapter);
  return all.filter(t => names.includes(t.name));
}

async function declaredShapes(tables: readonly Table[]): Promise<TableShape[]> {
  const adapter = new PgliteAdapter();
  await adapter.exec(renderSchema(tables));
  const all = await introspectSchema(adapter);
  return all.filter(t => tables.some(d => d.name === t.name));
}

describe('declared schema vs shipped DDL', () => {
  const names = TABLES.map(t => t.name);

  it.each(TABLES.map(t => t.name))('renders %s identically', async (name) => {
    const [shipped] = await shippedShapes([name]);
    const [declared] = await declaredShapes(TABLES.filter(t => t.name === name));

    expect(renderSchemaShape([declared])).toBe(renderSchemaShape([shipped]));
  });

  it('renders every converted table identically in one pass', async () => {
    expect(renderSchemaShape(await declaredShapes(TABLES)))
      .toBe(renderSchemaShape(await shippedShapes(names)));
  });

  it('is idempotent — re-applying the rendered DDL changes nothing', async () => {
    const adapter = new PgliteAdapter();
    const sql = renderSchema(TABLES);
    await adapter.exec(sql);
    const first = renderSchemaShape(await introspectSchema(adapter));

    await adapter.exec(sql);

    expect(renderSchemaShape(await introspectSchema(adapter))).toBe(first);
  });
});

describe('the declaration models everything the DDL says', () => {
  // The failure this guards against: an index form the model cannot express falls
  // through to raw passthrough, round-trips unchanged, and is therefore invisible to
  // both the transform and this test. Counting is how you notice.
  it('declares every index the shipped DDL creates for a converted table', async () => {
    const shipped = await shippedShapes(TABLES.map(t => t.name));

    for (const table of shipped) {
      const declared = TABLES.find(t => t.name === table.name)!;
      // Indexes Postgres creates implicitly for PK/UNIQUE constraints are not declared.
      const constraintIndexes = table.constraints
        .filter(c => c.type === 'p' || c.type === 'u')
        .map(c => c.name);
      const explicit = table.indexes.filter(i => !constraintIndexes.includes(i.name));

      expect(explicit.map(i => i.name).sort())
        .toEqual([...(declared.indexes ?? []).map(i => i.name)].sort());
    }
  });
});
