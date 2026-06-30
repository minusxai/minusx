import type { CsvFileInfo } from '@/lib/types';

/**
 * Merge the freshly re-imported tabs of a Google Sheet back into a static connection's file list,
 * PRESERVING the user's deletions.
 *
 * Re-import re-fetches every tab currently in the live spreadsheet. Naively replacing the spreadsheet's
 * files with that result resurrects any tab the user had deleted (the tab still exists in the sheet) —
 * the reported bug. Instead we treat the user's CURRENT files as the source of truth for *which* tabs
 * exist, and use the re-import only to REFRESH their data:
 *
 *  - a tab the user still has → replaced with its re-imported version (fresh s3_key/columns/row_count),
 *    matched by `table_name`; the file keeps its position in the list,
 *  - a kept tab with no re-imported match (e.g. renamed, or removed from the sheet) → left as-is,
 *    never dropped,
 *  - a tab the user deleted → never re-added (it isn't in `existingFiles`),
 *  - brand-new tabs added to the sheet since import → NOT auto-added (re-import refreshes existing
 *    tables; adding new tabs is an explicit import action).
 *
 * Files from other spreadsheets / CSV uploads are untouched.
 */
export function mergeReimportedSheetFiles(
  existingFiles: CsvFileInfo[],
  spreadsheetId: string,
  reimported: CsvFileInfo[],
): CsvFileInfo[] {
  const reimportedByName = new Map(reimported.map((f) => [f.table_name, f]));
  // Refresh each KEPT tab of this spreadsheet from its re-imported counterpart; preserve everything
  // else (other spreadsheets, CSVs) in place. Iterating `existingFiles` keeps original ordering.
  return existingFiles.map((f) =>
    f.spreadsheet_id === spreadsheetId ? (reimportedByName.get(f.table_name) ?? f) : f,
  );
}
