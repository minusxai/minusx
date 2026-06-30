import type { DatabaseSchema, CsvFileInfo } from '@/lib/types';

/**
 * Reconcile a STATIC connection's cached `content.schema` against its `config.files` (the source of
 * truth for which tables exist), dropping any table no longer present.
 *
 * Why: a static connection's schema is DERIVED from `config.files`. When the user deletes (or renames)
 * a table, `config.files` is updated but the cached enriched `content.schema` is kept as-is and only
 * a slow, non-blocking background re-introspection is scheduled — so the deleted table lingers in the
 * Table View AND the agent's schema (the reported bug). Pruning the cached schema at save time makes
 * the deletion reflect immediately and deterministically; the background refresh still runs to
 * re-enrich and pick up any additions.
 *
 * Tables are matched by `schema_name.table_name` (the same keys `csv-connector.getSchema` builds the
 * schema from, so they line up). Schemas left with no tables are dropped. No-op for live-DB
 * connections (no `config.files`) or a missing schema — returns the input unchanged.
 */
export function pruneConnectionSchemaToFiles(
  schema: DatabaseSchema | undefined,
  files: CsvFileInfo[] | undefined,
): DatabaseSchema | undefined {
  if (!schema?.schemas || !Array.isArray(files)) return schema;
  const allowed = new Set(files.map((f) => `${f.schema_name}.${f.table_name}`));
  return {
    ...schema,
    schemas: schema.schemas
      .map((s) => ({ ...s, tables: (s.tables ?? []).filter((t) => allowed.has(`${s.schema}.${t.table}`)) }))
      .filter((s) => s.tables.length > 0),
  };
}
