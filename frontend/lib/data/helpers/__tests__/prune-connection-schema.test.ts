import { describe, it, expect } from 'vitest';
import { pruneConnectionSchemaToFiles } from '@/lib/data/helpers/prune-connection-schema';
import type { DatabaseSchema, CsvFileInfo } from '@/lib/types';

function file(schema_name: string, table_name: string): CsvFileInfo {
  return { filename: `${table_name}.csv`, table_name, schema_name, s3_key: `s3-${table_name}`, file_format: 'csv', row_count: 0, columns: [], source_type: 'csv' };
}
const schema = (): DatabaseSchema => ({
  updated_at: '2026-01-01T00:00:00.000Z',
  schemas: [
    { schema: 'csv_test', tables: [
      { table: 'companies_1', columns: [{ name: 'id', type: 'INT' }] },
      { table: 'csv_delete_test', columns: [{ name: 'id', type: 'INT' }] },
    ] },
    { schema: 'mxfood', tables: [{ table: 'orders', columns: [{ name: 'id', type: 'INT' }] }] },
  ],
});

describe('pruneConnectionSchemaToFiles', () => {
  it('drops a table no longer in config.files (the deleted table)', () => {
    // config.files no longer has csv_test.csv_delete_test (user deleted it).
    const files = [file('csv_test', 'companies_1'), file('mxfood', 'orders')];
    const pruned = pruneConnectionSchemaToFiles(schema(), files)!;
    const tables = pruned.schemas.flatMap((s) => s.tables.map((t) => `${s.schema}.${t.table}`));
    expect(tables).toEqual(['csv_test.companies_1', 'mxfood.orders']);
    expect(tables).not.toContain('csv_test.csv_delete_test');
  });

  it('keeps surviving tables WITH their enriched columns intact', () => {
    const files = [file('csv_test', 'companies_1'), file('mxfood', 'orders')];
    const pruned = pruneConnectionSchemaToFiles(schema(), files)!;
    const companies = pruned.schemas.find((s) => s.schema === 'csv_test')!.tables[0];
    expect(companies.table).toBe('companies_1');
    expect(companies.columns).toEqual([{ name: 'id', type: 'INT' }]); // not stripped
    expect(pruned.updated_at).toBe('2026-01-01T00:00:00.000Z');
  });

  it('drops a schema/dataset that loses all its tables', () => {
    const files = [file('mxfood', 'orders')]; // entire csv_test dataset deleted
    const pruned = pruneConnectionSchemaToFiles(schema(), files)!;
    expect(pruned.schemas.map((s) => s.schema)).toEqual(['mxfood']);
  });

  it('does NOT add tables that exist in files but not yet in the cached schema (left to refresh)', () => {
    const files = [file('csv_test', 'companies_1'), file('csv_test', 'csv_delete_test'), file('mxfood', 'orders'), file('csv_test', 'brand_new')];
    const pruned = pruneConnectionSchemaToFiles(schema(), files)!;
    const tables = pruned.schemas.flatMap((s) => s.tables.map((t) => t.table));
    expect(tables).not.toContain('brand_new');
  });

  it('is a no-op for a live-DB connection (no config.files)', () => {
    const s = schema();
    expect(pruneConnectionSchemaToFiles(s, undefined)).toBe(s);
  });

  it('is a no-op when there is no cached schema', () => {
    expect(pruneConnectionSchemaToFiles(undefined, [file('csv_test', 'x')])).toBeUndefined();
  });
});
