import { describe, it, expect } from 'vitest';
import { mergeReimportedSheetFiles } from '@/lib/data/helpers/sheet-reimport';
import type { CsvFileInfo } from '@/lib/types';

// Minimal CsvFileInfo factory. `filename` is the stable per-tab identity (derived from the sheet tab
// name); `table_name` is what the user sees/renames. They can differ after a rename.
function sheetFile(
  opts: { filename: string; table_name?: string; spreadsheet_id: string; s3_key: string; row_count?: number },
): CsvFileInfo {
  return {
    filename: opts.filename,
    table_name: opts.table_name ?? opts.filename.replace(/\.csv$/, ''),
    schema_name: 'public',
    s3_key: opts.s3_key,
    file_format: 'csv',
    row_count: opts.row_count ?? 0,
    columns: [],
    source_type: 'google_sheets',
    spreadsheet_url: 'https://docs.google.com/spreadsheets/d/SHEET',
    spreadsheet_id: opts.spreadsheet_id,
  };
}
function csvFile(table_name: string, s3_key: string): CsvFileInfo {
  return { filename: `${table_name}.csv`, table_name, schema_name: 'public', s3_key, file_format: 'csv', row_count: 0, columns: [], source_type: 'csv' };
}

describe('mergeReimportedSheetFiles — re-import preserves deletions + renames', () => {
  it('does NOT resurrect a deleted tab (the reported bug)', () => {
    // User deleted companies_2, so it is no longer in existingFiles…
    const existing = [sheetFile({ filename: 'companies_1.csv', spreadsheet_id: 'A', s3_key: 'old1' })];
    // …but the live sheet still has both tabs, so re-import returns both.
    const reimported = [
      sheetFile({ filename: 'companies_1.csv', spreadsheet_id: 'A', s3_key: 'fresh1', row_count: 17 }),
      sheetFile({ filename: 'companies_2.csv', spreadsheet_id: 'A', s3_key: 'fresh2', row_count: 32 }),
    ];

    const merged = mergeReimportedSheetFiles(existing, 'A', reimported);

    expect(merged.map((f) => f.filename)).toEqual(['companies_1.csv']); // companies_2 NOT back
  });

  it('refreshes a kept tab with its re-imported data (fresh s3_key / row_count)', () => {
    const existing = [sheetFile({ filename: 'companies_1.csv', spreadsheet_id: 'A', s3_key: 'old1', row_count: 5 })];
    const reimported = [sheetFile({ filename: 'companies_1.csv', spreadsheet_id: 'A', s3_key: 'fresh1', row_count: 17 })];

    const merged = mergeReimportedSheetFiles(existing, 'A', reimported);

    expect(merged[0].s3_key).toBe('fresh1');
    expect(merged[0].row_count).toBe(17);
  });

  it('preserves a user RENAME while still refreshing that tab (matched by stable filename)', () => {
    // User renamed the table to "firms"; the underlying tab filename is unchanged.
    const existing = [sheetFile({ filename: 'companies_1.csv', table_name: 'firms', spreadsheet_id: 'A', s3_key: 'old1', row_count: 5 })];
    const reimported = [sheetFile({ filename: 'companies_1.csv', table_name: 'companies_1', spreadsheet_id: 'A', s3_key: 'fresh1', row_count: 17 })];

    const merged = mergeReimportedSheetFiles(existing, 'A', reimported);

    expect(merged[0].table_name).toBe('firms');  // rename preserved
    expect(merged[0].s3_key).toBe('fresh1');      // …and data refreshed
    expect(merged[0].row_count).toBe(17);
  });

  it('drops a tab that was removed from the live sheet (source gone), keeping the still-present ones', () => {
    const existing = [
      sheetFile({ filename: 'gone_tab.csv', spreadsheet_id: 'A', s3_key: 'old_gone', row_count: 9 }),
      sheetFile({ filename: 'companies_1.csv', spreadsheet_id: 'A', s3_key: 'old1' }),
    ];
    const reimported = [sheetFile({ filename: 'companies_1.csv', spreadsheet_id: 'A', s3_key: 'fresh1' })];

    const merged = mergeReimportedSheetFiles(existing, 'A', reimported);

    expect(merged.map((f) => f.filename)).toEqual(['companies_1.csv']); // gone_tab dropped (gone from sheet)
    expect(merged[0].s3_key).toBe('fresh1');
  });

  it('does NOT auto-add brand-new tabs that were never imported', () => {
    const existing = [sheetFile({ filename: 'companies_1.csv', spreadsheet_id: 'A', s3_key: 'old1' })];
    const reimported = [
      sheetFile({ filename: 'companies_1.csv', spreadsheet_id: 'A', s3_key: 'fresh1' }),
      sheetFile({ filename: 'brand_new_tab.csv', spreadsheet_id: 'A', s3_key: 'freshNew' }),
    ];

    const merged = mergeReimportedSheetFiles(existing, 'A', reimported);

    expect(merged.map((f) => f.filename)).toEqual(['companies_1.csv']);
  });

  it('leaves files from other spreadsheets and CSV uploads untouched, preserving order', () => {
    const existing = [
      csvFile('orders', 's3-orders'),
      sheetFile({ filename: 'companies_1.csv', spreadsheet_id: 'A', s3_key: 'old1' }),
      sheetFile({ filename: 'other_tab.csv', spreadsheet_id: 'B', s3_key: 'oldB' }),
    ];
    const reimported = [sheetFile({ filename: 'companies_1.csv', spreadsheet_id: 'A', s3_key: 'fresh1' })];

    const merged = mergeReimportedSheetFiles(existing, 'A', reimported);

    expect(merged.map((f) => `${f.filename}:${f.s3_key}`)).toEqual([
      'orders.csv:s3-orders',     // CSV untouched
      'companies_1.csv:fresh1',   // refreshed in place
      'other_tab.csv:oldB',       // spreadsheet B untouched
    ]);
  });
});
