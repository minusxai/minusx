import 'server-only';

import type { ConnectionInfo } from '../../types';
import { getCatalogStore, type CatalogTables } from '../catalog';

/**
 * One column flattened out of the catalog. Used by AutoContext's filter
 * decision (estimate output size, optionally pick relevant tables) and as
 * the foundation for downstream stages.
 */
export interface FlatColumn {
  connection: string;
  schema: string;
  table: string;
  column: string;
  type: string;
}

/**
 * Pure projection of `catalog.columns.rows` into a flat list. Kept
 * separate from `getSchema` so it can be unit-tested without
 * `getCatalogStore` (which builds the DuckDB-backed catalog).
 */
export function flattenCatalogColumns(catalog: CatalogTables): FlatColumn[] {
  return catalog.columns.rows.map((r) => ({
    connection: r.connection_name as string,
    schema: r.schema_name as string,
    table: r.table_name as string,
    column: r.column_name as string,
    type: r.data_type as string,
  }));
}

/**
 * Read (and lazily build) the catalog for `connections` and return its
 * flat column list. Cached at the catalog layer — first call for a
 * `(datasetKey, cacheKey)` pair pays for the catalog build (including
 * any dialect profiling); subsequent calls return the cached projection
 * in microseconds.
 */
export async function getSchema(
  connections: ConnectionInfo[] | undefined,
  datasetKey?: string,
  cacheKey: string = 'default',
): Promise<FlatColumn[]> {
  const { catalog } = await getCatalogStore(connections, cacheKey, undefined, datasetKey);
  return flattenCatalogColumns(catalog);
}
