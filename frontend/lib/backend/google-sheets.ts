/**
 * Client-safe Google Sheets functions.
 * deleteGoogleSheetsData (server-only) lives in google-sheets.server.ts.
 */

import { CsvFileInfo } from '@/lib/types';

export interface GoogleSheetsImportConfig {
  spreadsheet_url: string;
  spreadsheet_id: string;
  schema_name?: string;
  files: any[];
}

export interface GoogleSheetsImportResult {
  success: boolean;
  message: string;
  config?: GoogleSheetsImportConfig;
}

export interface GoogleSheetsReimportResult {
  success: boolean;
  message: string;
  files?: CsvFileInfo[];
}

export async function importGoogleSheets(
  connectionName: string,
  spreadsheetUrl: string,
  _companyId: number,
  _mode: string,
  replaceExisting: boolean = false,
  schemaName: string = 'public',
): Promise<GoogleSheetsImportResult> {
  try {
    const res = await fetch('/api/google-sheets/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        connection_name: connectionName,
        spreadsheet_url: spreadsheetUrl,
        replace_existing: replaceExisting,
        schema_name: schemaName,
      })
    });

    if (!res.ok) {
      try {
        const body = await res.json();
        return { success: false, message: body.message ?? body.error?.message ?? 'Import failed — please try again' };
      } catch {
        return { success: false, message: 'Import failed — please try again' };
      }
    }

    return await res.json();
  } catch (error) {
    return { success: false, message: `Import failed: ${error instanceof Error ? error.message : 'Unknown error'}` };
  }
}

/**
 * Re-import a Google Sheet into the static connection.
 * Deletes old S3 files for this spreadsheet_id and fetches fresh data.
 */
export async function reimportGoogleSheets(
  spreadsheetId: string,
  spreadsheetUrl: string,
  schemaName: string,
  oldS3Keys: string[],
): Promise<GoogleSheetsReimportResult> {
  try {
    const res = await fetch('/api/google-sheets/reimport', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spreadsheet_id: spreadsheetId,
        spreadsheet_url: spreadsheetUrl,
        schema_name: schemaName,
        old_s3_keys: oldS3Keys,
      }),
    });

    if (!res.ok) {
      try {
        const body = await res.json();
        return { success: false, message: body.message ?? body.error?.message ?? 'Re-import failed — please try again' };
      } catch {
        return { success: false, message: 'Re-import failed — please try again' };
      }
    }

    return await res.json();
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : 'Re-import failed' };
  }
}
