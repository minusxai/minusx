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
 *  - a tab present in BOTH the live sheet and `config.files` → its DATA fields
 *    (s3_key/columns/row_count/file_format) are refreshed from the re-import, matched by `filename`
 *    (the stable per-tab identity — derived from the sheet tab name, unchanged by a table rename),
 *    while the user's `table_name`/`schema_name` (renames) and its list position are preserved,
 *  - a tab the user deleted → never re-added (it isn't in `existingFiles`),
 *  - a tab removed from the live sheet → dropped (the source is gone; it's not in `reimported`),
 *  - a brand-new tab added to the sheet since import → NOT auto-added (re-import refreshes existing
 *    tables; adding new tabs is an explicit import action).
 *
 * Net: the group becomes exactly the live tabs the user still wants — `config.files ∩ live sheet`,
 * by filename — refreshed and rename-preserving. Files from other spreadsheets / CSV uploads are
 * untouched and keep their position.
 */
export function mergeReimportedSheetFiles(
  existingFiles: CsvFileInfo[],
  spreadsheetId: string,
  reimported: CsvFileInfo[],
): CsvFileInfo[] {
  const freshByFilename = new Map(reimported.map((f) => [f.filename, f]));
  const out: CsvFileInfo[] = [];
  // Iterate `existingFiles` so order is preserved, deleted tabs stay gone (not present here), and
  // other spreadsheets / CSVs pass through untouched.
  for (const f of existingFiles) {
    if (f.spreadsheet_id !== spreadsheetId) { out.push(f); continue; }
    const fresh = freshByFilename.get(f.filename);
    if (!fresh) continue; // removed from the live sheet → drop (source gone)
    // Refresh only the data fields; preserve the user's table/schema names + source metadata.
    out.push({ ...f, s3_key: fresh.s3_key, columns: fresh.columns, row_count: fresh.row_count, file_format: fresh.file_format });
  }
  return out;
}
