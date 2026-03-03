/**
 * CSV Upload API Client
 *
 * Client functions for uploading CSV files and managing CSV connections.
 * These functions call the Next.js API proxy routes, which forward to Python.
 */

import { CsvConnectionConfig } from '@/lib/types';

export interface CsvUploadResult {
  success: boolean;
  message: string;
  config?: CsvConnectionConfig;
}

export interface CsvDeleteResult {
  success: boolean;
  message: string;
}

/**
 * Upload CSV files to create a new CSV connection or replace existing one.
 *
 * @param connectionName - Name of the connection
 * @param files - Array of File objects to upload
 * @param replaceExisting - If true, replace existing files; if false, error on existing
 * @returns Upload result with generated config
 */
export async function uploadCsvFiles(
  connectionName: string,
  files: File[],
  replaceExisting: boolean = false
): Promise<CsvUploadResult> {
  const formData = new FormData();
  formData.append('connection_name', connectionName);
  formData.append('replace_existing', replaceExisting.toString());

  for (const file of files) {
    formData.append('files', file);
  }

  try {
    const res = await fetch('/api/csv/upload', {
      method: 'POST',
      body: formData
    });

    if (!res.ok) {
      const error = await res.text();
      return {
        success: false,
        message: `Upload failed: ${error}`
      };
    }

    return await res.json();
  } catch (error) {
    return {
      success: false,
      message: `Upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * Delete CSV connection data (files and database).
 * Should be called when deleting a CSV connection.
 *
 * @param connectionName - Name of the connection
 * @returns Delete result
 */
export async function deleteCsvData(
  connectionName: string
): Promise<CsvDeleteResult> {
  try {
    const res = await fetch(`/api/csv/delete/${encodeURIComponent(connectionName)}`, {
      method: 'DELETE'
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
