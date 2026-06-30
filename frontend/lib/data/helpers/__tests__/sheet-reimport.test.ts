import { describe, it, expect } from 'vitest';
import { mergeReimportedSheetFiles } from '@/lib/data/helpers/sheet-reimport';
import type { CsvFileInfo } from '@/lib/types';

// Minimal CsvFileInfo factory — only the fields the merge cares about.
function sheetFile(table_name: string, spreadsheet_id: string, s3_key: string, row_count = 0): CsvFileInfo {
  return {
    filename: `${table_name}.csv`,
    table_name,
    schema_name: 'public',
    s3_key,
    file_format: 'csv',
    row_count,
    columns: [],
    source_type: 'google_sheets',
    spreadsheet_url: 'https://docs.google.com/spreadsheets/d/SHEET',
    spreadsheet_id,
  };
}
function csvFile(table_name: string, s3_key: string): CsvFileInfo {
  return { filename: `${table_name}.csv`, table_name, schema_name: 'public', s3_key, file_format: 'csv', row_count: 0, columns: [], source_type: 'csv' };
}

describe('mergeReimportedSheetFiles — re-import preserves deletions', () => {
  it('does NOT resurrect a deleted tab (the reported bug)', () => {
    // User deleted companies_2, so it is no longer in existingFiles…
    const existing = [sheetFile('companies_1', 'A', 'old1')];
    // …but the live sheet still has both tabs, so re-import returns both.
    const reimported = [sheetFile('companies_1', 'A', 'fresh1', 17), sheetFile('companies_2', 'A', 'fresh2', 32)];

    const merged = mergeReimportedSheetFiles(existing, 'A', reimported);

    expect(merged.map((f) => f.table_name)).toEqual(['companies_1']); // companies_2 NOT back
  });

  it('refreshes a kept tab with its re-imported data (fresh s3_key / row_count)', () => {
    const existing = [sheetFile('companies_1', 'A', 'old1', 5)];
    const reimported = [sheetFile('companies_1', 'A', 'fresh1', 17)];

    const merged = mergeReimportedSheetFiles(existing, 'A', reimported);

    expect(merged[0].s3_key).toBe('fresh1');
    expect(merged[0].row_count).toBe(17);
  });

  it('keeps a tab that has no re-imported match (renamed / removed from sheet) instead of dropping it', () => {
    const existing = [sheetFile('renamed_firms', 'A', 'old1', 9)];
    const reimported = [sheetFile('companies_1', 'A', 'fresh1', 17)]; // no table_name match

    const merged = mergeReimportedSheetFiles(existing, 'A', reimported);

    expect(merged).toHaveLength(1);
    expect(merged[0].table_name).toBe('renamed_firms');
    expect(merged[0].s3_key).toBe('old1'); // untouched, not dropped
  });

  it('does NOT auto-add brand-new tabs that were never imported', () => {
    const existing = [sheetFile('companies_1', 'A', 'old1')];
    const reimported = [sheetFile('companies_1', 'A', 'fresh1'), sheetFile('brand_new_tab', 'A', 'freshNew')];

    const merged = mergeReimportedSheetFiles(existing, 'A', reimported);

    expect(merged.map((f) => f.table_name)).toEqual(['companies_1']);
  });

  it('leaves files from other spreadsheets and CSV uploads untouched, preserving order', () => {
    const existing = [
      csvFile('orders', 's3-orders'),
      sheetFile('companies_1', 'A', 'old1'),
      sheetFile('other_tab', 'B', 'oldB'),
    ];
    const reimported = [sheetFile('companies_1', 'A', 'fresh1')];

    const merged = mergeReimportedSheetFiles(existing, 'A', reimported);

    expect(merged.map((f) => `${f.table_name}:${f.s3_key}`)).toEqual([
      'orders:s3-orders',      // CSV untouched
      'companies_1:fresh1',    // refreshed in place
      'other_tab:oldB',        // spreadsheet B untouched
    ]);
  });
});
