import type { CsvFileInfo } from '@/lib/types';

/**
 * Merge the freshly re-imported tabs of a Google Sheet back into a static connection's file list,
 * PRESERVING the user's deletions and renames. Shared by the manual "Re-import" button
 * (StaticConnectionConfig) and the scheduled auto-sync job (sheets-sync-handler) — both re-fetch every
 * live tab and must not resurrect tabs the user removed.
 *
 * Re-import re-fetches every tab currently in the live spreadsheet. Naively replacing the spreadsheet's
 * files with that result resurrects any tab the user had deleted (the tab still exists in the sheet) —
 * the reported bug. Instead the user's CURRENT files are the source of truth for *which* tabs exist;
 * the re-import only REFRESHES their data:
 *
 *  - a tab the user still has → its DATA fields (s3_key/columns/row_count/file_format) are refreshed
 *    from the re-import, matched by `filename` (the stable per-tab identity — derived from the sheet
 *    tab name, unchanged by a table rename), while the user's `table_name`/`schema_name` (renames) and
 *    its position are preserved,
 *  - a kept tab with no re-imported match (removed from the sheet) → left as-is, never dropped,
 *  - a tab the user deleted → never re-added (it isn't in `existingFiles`),
 *  - a brand-new tab added to the sheet since import → NOT auto-added (re-import refreshes existing
 *    tables; adding new tabs is an explicit import action).
 *
 * Files from other spreadsheets / CSV uploads are untouched.
 */
export function mergeReimportedSheetFiles(
  existingFiles: CsvFileInfo[],
  spreadsheetId: string,
  reimported: CsvFileInfo[],
): CsvFileInfo[] {
  const freshByFilename = new Map(reimported.map((f) => [f.filename, f]));
  // Iterate `existingFiles` so deleted tabs stay gone, kept tabs keep their order, and other
  // spreadsheets / CSVs pass through untouched.
  return existingFiles.map((f) => {
    if (f.spreadsheet_id !== spreadsheetId) return f;
    const fresh = freshByFilename.get(f.filename);
    if (!fresh) return f; // kept tab no longer in the sheet → leave its existing data in place
    // Refresh only the data fields; preserve the user's table/schema names + source metadata.
    return {
      ...f,
      s3_key: fresh.s3_key,
      columns: fresh.columns,
      row_count: fresh.row_count,
      file_format: fresh.file_format,
    };
  });
}
