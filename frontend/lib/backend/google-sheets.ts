/**
 * Google Sheets API Client
 *
 * Client functions for importing Google Sheets and managing Google Sheets connections.
 * These functions call the Python backend's Google Sheets endpoints.
 */

import { BACKEND_URL } from '@/lib/constants';
import { CsvFileInfo } from '@/lib/types';

export interface GoogleSheetsImportConfig {
  spreadsheet_url: string;
  spreadsheet_id: string;
  generated_db_path: string;
  files: CsvFileInfo[];
}

export interface GoogleSheetsImportResult {
  success: boolean;
  message: string;
  config?: GoogleSheetsImportConfig;
}

export interface GoogleSheetsDeleteResult {
  success: boolean;
  message: string;
}

/**
 * Import a public Google Sheet and create a DuckDB database.
 *
 * @param connectionName - Name of the connection
 * @param spreadsheetUrl - Public Google Sheets URL
 * @param companyId - Company ID for multi-tenant isolation
 * @param mode - Mode for isolation (org, tutorial, etc.)
 * @param replaceExisting - If true, replace existing data; if false, error on existing
 * @returns Import result with generated config
 */
export async function importGoogleSheets(
  connectionName: string,
  spreadsheetUrl: string,
  companyId: number,
  mode: string,
  replaceExisting: boolean = false
): Promise<GoogleSheetsImportResult> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/google-sheets/import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-company-id': companyId.toString(),
        'x-mode': mode
      },
      body: JSON.stringify({
        connection_name: connectionName,
        spreadsheet_url: spreadsheetUrl,
        replace_existing: replaceExisting
      })
    });

    if (!res.ok) {
      const error = await res.text();
      return {
        success: false,
        message: `Import failed: ${error}`
      };
    }

    return await res.json();
  } catch (error) {
    return {
      success: false,
      message: `Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * Delete Google Sheets connection data (files and database).
 * Should be called when deleting a Google Sheets connection.
 *
 * @param connectionName - Name of the connection
 * @param companyId - Company ID
 * @param mode - Mode for isolation
 * @returns Delete result
 */
export async function deleteGoogleSheetsData(
  connectionName: string,
  companyId: number,
  mode: string
): Promise<GoogleSheetsDeleteResult> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/google-sheets/delete/${encodeURIComponent(connectionName)}`, {
      method: 'DELETE',
      headers: {
        'x-company-id': companyId.toString(),
        'x-mode': mode
      }
    });

    if (!res.ok) {
      const error = await res.text();
      return {
        success: false,
        message: `Delete failed: ${error}`
      };
    }

    return await res.json();
  } catch (error) {
    return {
      success: false,
      message: `Delete failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}
