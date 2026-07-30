/**
 * Golden snapshot of the schema the base DDL actually produces.
 *
 * The DDL is re-applied on every boot and relies on `IF NOT EXISTS` to no-op. That
 * only holds if the statements describe exactly what is already there — and since
 * `IF NOT EXISTS` matches on NAME rather than definition, a drifted object is skipped
 * with nothing but a NOTICE. This pins the result so any refactor of the DDL that
 * changes the resulting schema has to be deliberate.
 *
 * It is also the guard for the declarative-schema work: a hand-authored declaration
 * has to render to this same shape.
 */

import { PgliteAdapter } from '@/lib/database/adapter/pglite-adapter';
import { POSTGRES_SCHEMA } from '@/lib/database/postgres-schema';
import { introspectSchema, renderSchemaShape } from '@/test/harness/schema-introspect';

async function applySchema(sql: string): Promise<PgliteAdapter> {
  const adapter = new PgliteAdapter();
  await adapter.exec(sql);
  return adapter;
}

describe('base schema shape', () => {
  it('matches the recorded shape', async () => {
    const adapter = await applySchema(POSTGRES_SCHEMA);
    expect(renderSchemaShape(await introspectSchema(adapter))).toMatchSnapshot();
  });

  it('is idempotent — re-applying changes nothing', async () => {
    const adapter = await applySchema(POSTGRES_SCHEMA);
    const first = renderSchemaShape(await introspectSchema(adapter));

    await adapter.exec(POSTGRES_SCHEMA);
    const second = renderSchemaShape(await introspectSchema(adapter));

    expect(second).toBe(first);
  });
});
