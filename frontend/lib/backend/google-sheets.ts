/**
 * Client-safe Google Sheets functions.
 * deleteGoogleSheetsData (server-only) lives in google-sheets.server.ts.
 */

export interface GoogleSheetsImportConfig {
  spreadsheet_url: string;
  spreadsheet_id: string;
  generated_db_path: string;
  files: any[];
}

export interface GoogleSheetsImportResult {
  success: boolean;
  message: string;
  config?: GoogleSheetsImportConfig;
}

export async function importGoogleSheets(
  connectionName: string,
  spreadsheetUrl: string,
  _companyId: number,
  _mode: string,
  replaceExisting: boolean = false
): Promise<GoogleSheetsImportResult> {
  try {
    const res = await fetch('/api/google-sheets/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        connection_name: connectionName,
        spreadsheet_url: spreadsheetUrl,
        replace_existing: replaceExisting
      })
    });

    if (!res.ok) {
      const error = await res.text();
      return { success: false, message: `Import failed: ${error}` };
    }

    return await res.json();
  } catch (error) {
    return { success: false, message: `Import failed: ${error instanceof Error ? error.message : 'Unknown error'}` };
  }
}
