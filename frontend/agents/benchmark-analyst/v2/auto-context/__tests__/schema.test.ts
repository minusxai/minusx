/**
 * Tests for schema.ts — the flat-schema projection over the catalog.
 *
 * `flattenCatalogColumns` is pure (no DB, no async). It projects the
 * `catalog.columns` rows into `FlatColumn[]` and is the cheap on-ramp the
 * filter step uses to decide whether to filter on the user question.
 */

import { describe, it, expect } from 'vitest';
import { flattenCatalogColumns } from '../schema';
import type { CatalogTables } from '../../catalog';

function makeCatalog(columnsRows: Record<string, unknown>[]): CatalogTables {
  const empty = { columns: [], types: [], rows: [] };
  return {
    connections: empty,
    schemas: empty,
    tables: empty,
    columns: {
      columns: ['connection_name', 'schema_name', 'table_name', 'column_name', 'data_type'],
      types: ['VARCHAR', 'VARCHAR', 'VARCHAR', 'VARCHAR', 'VARCHAR'],
      rows: columnsRows,
    },
    indexes: empty,
    column_stats: empty,
    sample_rows: empty,
    sample_notes: empty,
  };
}

describe('flattenCatalogColumns', () => {
  it('projects catalog.columns rows into a flat FlatColumn list', () => {
    const catalog = makeCatalog([
      { connection_name: 'db', schema_name: 'public', table_name: 'users', column_name: 'id', data_type: 'INTEGER' },
      { connection_name: 'db', schema_name: 'public', table_name: 'users', column_name: 'email', data_type: 'VARCHAR' },
      { connection_name: 'db', schema_name: 'public', table_name: 'orders', column_name: 'total', data_type: 'NUMERIC' },
    ]);

    expect(flattenCatalogColumns(catalog)).toEqual([
      { connection: 'db', schema: 'public', table: 'users', column: 'id', type: 'INTEGER' },
      { connection: 'db', schema: 'public', table: 'users', column: 'email', type: 'VARCHAR' },
      { connection: 'db', schema: 'public', table: 'orders', column: 'total', type: 'NUMERIC' },
    ]);
  });

  it('preserves the order of catalog.columns.rows', () => {
    const catalog = makeCatalog([
      { connection_name: 'db', schema_name: 's', table_name: 't', column_name: 'a', data_type: 'X' },
      { connection_name: 'db', schema_name: 's', table_name: 't', column_name: 'b', data_type: 'Y' },
    ]);

    const out = flattenCatalogColumns(catalog);
    expect(out.map((c) => c.column)).toEqual(['a', 'b']);
  });

  it('returns an empty array when no columns are present', () => {
    expect(flattenCatalogColumns(makeCatalog([]))).toEqual([]);
  });

  it('handles multiple connections + schemas in the same catalog', () => {
    const catalog = makeCatalog([
      { connection_name: 'primary', schema_name: 'public', table_name: 'users', column_name: 'id', data_type: 'INTEGER' },
      { connection_name: 'archive', schema_name: 'historic', table_name: 'logs', column_name: 'ts', data_type: 'TIMESTAMP' },
    ]);

    const out = flattenCatalogColumns(catalog);
    expect(out).toHaveLength(2);
    expect(out[0].connection).toBe('primary');
    expect(out[1].connection).toBe('archive');
    expect(out[1].schema).toBe('historic');
  });
});
