/**
 * Catalog projection helpers — pure shape transformations from the cached
 * catalog tables into the maps `auto-context.ts` consumes.
 *
 * Rendering / sample-fetching helpers used to live here; they moved into
 * `auto-context.ts` when AutoContext consolidated to a single file. What
 * remains is the projection layer, kept here because it's the canonical
 * place to turn `CatalogTables` rows into typed maps and is potentially
 * reusable outside AutoContext.
 */
import 'server-only';

import type { ColumnMeta } from '@/lib/connections/base';
import type { CatalogTables } from '../catalog';
import { flattenCatalogColumns, type FlatColumn } from './schema';

/** Walk `catalog.column_stats.rows` into a `Map<canonicalColumnPath, ColumnMeta>`. */
export function buildStatsMap(catalog: CatalogTables): Map<string, ColumnMeta> {
  const out = new Map<string, ColumnMeta>();
  for (const r of catalog.column_stats.rows) {
    const key = `${r.connection_name}.${r.schema_name}.${r.table_name}.${r.column_name}`;
    const meta: ColumnMeta = {};
    if (typeof r.category === 'string') meta.category = r.category as ColumnMeta['category'];
    if (typeof r.n_distinct === 'number' || typeof r.n_distinct === 'bigint') meta.nDistinct = Number(r.n_distinct);
    if (typeof r.null_count === 'number' || typeof r.null_count === 'bigint') meta.nullCount = Number(r.null_count);
    if (r.min_value != null) meta.min = r.min_value as number | string;
    if (r.max_value != null) meta.max = r.max_value as number | string;
    if (typeof r.avg_value === 'number') meta.avg = r.avg_value;
    if (typeof r.min_date === 'string') meta.minDate = r.min_date;
    if (typeof r.max_date === 'string') meta.maxDate = r.max_date;
    if (typeof r.top_values === 'string') {
      try { meta.topValues = JSON.parse(r.top_values); } catch { /* ignore malformed */ }
    }
    out.set(key, meta);
  }
  return out;
}

/** Walk `catalog.tables.rows` into a `Map<canonicalTablePath, rowCount>`. */
export function buildRowCountMap(catalog: CatalogTables): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of catalog.tables.rows) {
    const id = `${r.connection_name}.${r.schema_name}.${r.table_name}`;
    if (typeof r.row_count === 'number' || typeof r.row_count === 'bigint') {
      out.set(id, Number(r.row_count));
    }
  }
  return out;
}

/** Convenience: catalog → flat schema + stats + rowCounts. */
export function catalogProjection(catalog: CatalogTables): {
  schema: FlatColumn[];
  statsByCol: Map<string, ColumnMeta>;
  rowCountByTable: Map<string, number>;
} {
  return {
    schema: flattenCatalogColumns(catalog),
    statsByCol: buildStatsMap(catalog),
    rowCountByTable: buildRowCountMap(catalog),
  };
}
