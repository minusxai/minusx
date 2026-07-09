/**
 * Client-safe Google Sheets functions.
 * deleteGoogleSheetsData (server-only) lives in google-sheets.server.ts.
 */

import { CsvFileInfo } from '@/lib/types';
import type { RawGridFile, SheetTransform, TransformPreview } from '@/lib/sheets-import/types';

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

// ─── Agentic import (analyze → review → confirm; see lib/sheets-import) ───────


export interface SheetAnalysisResult {
  spreadsheet_id: string;
  raw_files: RawGridFile[];
  transforms: SheetTransform[];
  previews: Record<string, TransformPreview>;
  dropped: string[];
}

export interface SheetRevisionResult {
  transforms: SheetTransform[];
  previews: Record<string, TransformPreview>;
  dropped: string[];
}

async function postJson<T>(url: string, body: unknown, failMessage: string): Promise<{ success: true; data: T } | { success: false; message: string }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { success: false, message: json.message ?? json.error?.message ?? json.error ?? failMessage };
    }
    return { success: true, data: json.data as T };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : failMessage };
  }
}

/** Step 1: the agent inspects the sheet and proposes validated transforms (with previews). */
export function analyzeGoogleSheet(connectionName: string, spreadsheetUrl: string) {
  return postJson<SheetAnalysisResult>('/api/google-sheets/analyze', {
    connection_name: connectionName,
    spreadsheet_url: spreadsheetUrl,
  }, 'Analysis failed — please try again');
}

/** Step 2 (repeatable): revise the proposed transforms with the user's feedback. */
export function reviseGoogleSheetTransforms(
  connectionName: string,
  rawFiles: RawGridFile[],
  transforms: SheetTransform[],
  feedback: string,
) {
  return postJson<SheetRevisionResult>('/api/google-sheets/revise', {
    connection_name: connectionName,
    raw_files: rawFiles,
    transforms,
    feedback,
  }, 'Revision failed — please try again');
}

/** Step 3: materialize the accepted transforms into connection tables. */
export function confirmGoogleSheetImport(
  connectionName: string,
  spreadsheetUrl: string,
  rawFiles: RawGridFile[],
  transforms: SheetTransform[],
) {
  return postJson<{ files: CsvFileInfo[]; spreadsheet_url: string; spreadsheet_id: string }>('/api/google-sheets/confirm', {
    connection_name: connectionName,
    spreadsheet_url: spreadsheetUrl,
    raw_files: rawFiles,
    transforms,
  }, 'Import failed — please try again');
}
