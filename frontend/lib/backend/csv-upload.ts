/**
 * CSV / Remote-file Upload Client
 *
 * Upload flow:
 *  1. For each file: GET presigned S3 URL from /api/object-store/upload-url
 *  2. PUT file directly to S3 (bypasses backend)
 *  3. POST file metadata (s3_key, filename, schema_name, file_format) to /api/csv/register
 *  4. Backend reads column/type metadata from S3 and returns the final config
 */

import { CsvConnectionConfig } from '@/lib/types';

export interface FileWithSchema {
  file: File;
  schemaName: string;   // DuckDB schema, e.g. "public" or "mxfood"
  tableName?: string;   // Optional override for table name; auto-generated from filename if absent
}

export interface CsvUploadResult {
  success: boolean;
  message: string;
  config?: CsvConnectionConfig;
}

export interface CsvDeleteResult {
  success: boolean;
  message: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getContentType(file: File): string {
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'parquet' || ext === 'pq') return 'application/octet-stream';
  return 'text/csv';
}

function getFileFormat(filename: string): 'csv' | 'parquet' {
  const ext = filename.split('.').pop()?.toLowerCase();
  return ext === 'parquet' || ext === 'pq' ? 'parquet' : 'csv';
}

async function getPresignedUrl(
  file: File,
  connectionName: string,
): Promise<{ uploadUrl: string; publicUrl: string; s3Key: string }> {
  const params = new URLSearchParams({
    filename: file.name,
    contentType: getContentType(file),
    keyType: 'csvs',
    connectionName,
  });
  const res = await fetch(`/api/object-store/upload-url?${params}`);
  if (!res.ok) throw new Error(`Failed to get upload URL: ${await res.text()}`);
  return res.json();
}

async function putFileToS3(file: File, uploadUrl: string): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': getContentType(file) },
    body: file,
  });
  if (!res.ok) {
    throw new Error(`S3 upload failed for ${file.name}: ${res.status} ${res.statusText}`);
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Upload CSV/Parquet files to S3 and register them with the backend.
 *
 * Each file can have its own schema name. The backend reads column + row
 * metadata from S3 at registration time and returns the full config.
 */
export async function uploadCsvFilesS3(
  connectionName: string,
  filesWithSchema: FileWithSchema[],
  replaceExisting: boolean = false,
): Promise<CsvUploadResult> {
  try {
    // Step 1 & 2: upload each file to S3
    const fileRecords: {
      filename: string;
      s3_key: string;
      schema_name: string;
      file_format: 'csv' | 'parquet';
      table_name?: string;
    }[] = [];

    for (const { file, schemaName, tableName } of filesWithSchema) {
      const { uploadUrl, s3Key } = await getPresignedUrl(file, connectionName);
      await putFileToS3(file, uploadUrl);
      const record: {
        filename: string;
        s3_key: string;
        schema_name: string;
        file_format: 'csv' | 'parquet';
        table_name?: string;
      } = {
        filename: file.name,
        s3_key: s3Key,
        schema_name: schemaName || 'public',
        file_format: getFileFormat(file.name),
      };
      if (tableName) record.table_name = tableName;
      fileRecords.push(record);
    }

    // Step 3: register with backend (reads metadata from S3)
    const res = await fetch('/api/csv/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        connection_name: connectionName,
        files: fileRecords,
        replace_existing: replaceExisting,
      }),
    });

    if (!res.ok) {
      return { success: false, message: `Registration failed: ${await res.text()}` };
    }

    return res.json();
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Upload failed',
    };
  }
}

/**
 * Notify backend to invalidate the cached connector for a connection.
 * The connection document deletion is handled separately by Next.js FilesAPI.
 */
export async function deleteCsvData(
  connectionName: string,
): Promise<CsvDeleteResult> {
  try {
    const res = await fetch(`/api/csv/delete/${encodeURIComponent(connectionName)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      return { success: false, message: `Delete failed: ${await res.text()}` };
    }
    return res.json();
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Delete failed',
    };
  }
}
