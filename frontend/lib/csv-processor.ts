import 'server-only';

/**
 * CSV and Google Sheets processing — all logic lives here in Node.js.
 * Handles xlsx expansion, S3 uploads/deletes, and DuckDB metadata extraction.
 */

import { randomUUID } from 'crypto';
import { writeFileSync, readFileSync, unlinkSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import {
  S3Client,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { DuckDBInstance } from '@duckdb/node-api';
import * as XLSX from 'xlsx';
import {
  OBJECT_STORE_BUCKET,
  OBJECT_STORE_REGION,
  OBJECT_STORE_ACCESS_KEY_ID,
  OBJECT_STORE_SECRET_ACCESS_KEY,
  OBJECT_STORE_ENDPOINT,
  LOCAL_UPLOAD_PATH,
} from '@/lib/config';
import { createObjectStore, isLocalObjectStore } from '@/lib/object-store';
import { sanitizeTableName, ensureUniqueTableNames } from '@/lib/csv-utils';

// Re-export shared utilities so existing callers don't break
export { sanitizeTableName, ensureUniqueTableNames } from '@/lib/csv-utils';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface IncomingFile {
  filename: string;
  s3_key: string;
  schema_name?: string;
  file_format?: 'csv' | 'parquet' | 'xlsx';
  table_name?: string;
}

export interface RegisteredFile {
  table_name: string;
  schema_name: string;
  s3_key: string;
  file_format: 'csv' | 'parquet';
  filename: string;
  row_count: number;
  columns: Array<{ name: string; type: string }>;
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

/** Returns the DuckDB-readable URL/path for a stored key. */
function getStorageUrl(key: string): string {
  if (!isLocalObjectStore()) return `s3://${OBJECT_STORE_BUCKET!}/${key}`;
  return resolve(join(LOCAL_UPLOAD_PATH, key));
}

// ─── S3 client ───────────────────────────────────────────────────────────────

function makeS3(): S3Client {
  if (!OBJECT_STORE_BUCKET) throw new Error('OBJECT_STORE_BUCKET is not configured');
  return new S3Client({
    region: OBJECT_STORE_REGION,
    credentials:
      OBJECT_STORE_ACCESS_KEY_ID && OBJECT_STORE_SECRET_ACCESS_KEY
        ? { accessKeyId: OBJECT_STORE_ACCESS_KEY_ID, secretAccessKey: OBJECT_STORE_SECRET_ACCESS_KEY }
        : undefined,
    ...(OBJECT_STORE_ENDPOINT ? { endpoint: OBJECT_STORE_ENDPOINT, forcePathStyle: true } : {}),
  });
}

// ─── Table name helpers ───────────────────────────────────────────────────────
// (implementations live in lib/csv-utils.ts — re-exported above for back-compat)

// ─── xlsx expansion ───────────────────────────────────────────────────────────

/**
 * Download an xlsx from S3, expand each non-empty sheet to a CSV, upload back to S3.
 * Returns one IncomingFile record per sheet.
 */
async function getStoredFileBytes(key: string): Promise<Buffer> {
  if (isLocalObjectStore()) {
    return readFileSync(resolve(join(LOCAL_UPLOAD_PATH, key)));
  }
  const s3 = makeS3();
  const response = await s3.send(new GetObjectCommand({ Bucket: OBJECT_STORE_BUCKET!, Key: key }));
  const chunks: Uint8Array[] = [];
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function expandXlsxFromS3(
  s3Key: string,
  connectionName: string,
  companyId: number,
  mode: string,
  schemaName: string,
  createdKeys: string[],
): Promise<IncomingFile[]> {
  const buffer = await getStoredFileBytes(s3Key);
  return xlsxBytesToS3Csvs(buffer, connectionName, companyId, mode, schemaName, createdKeys);
}

/**
 * Parse xlsx bytes, convert each non-empty sheet to CSV, upload to S3.
 * Shared by both CSV uploads (xlsx file already in S3) and Google Sheets import.
 * createdKeys is a caller-owned array; each successfully stored parquet key is pushed
 * onto it so the caller can clean up on failure.
 */
async function xlsxBytesToS3Csvs(
  buffer: Buffer,
  connectionName: string,
  companyId: number,
  mode: string,
  schemaName: string,
  createdKeys: string[] = [],
): Promise<IncomingFile[]> {
  const store = createObjectStore();
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const results: IncomingFile[] = [];

  // One DuckDB instance per call — no S3 config needed (local file ops only)
  const instance = await DuckDBInstance.create(':memory:');
  const conn = await instance.connect();
  try {
    for (const sheetName of workbook.SheetNames) {
      const ws = workbook.Sheets[sheetName];
      const csvData = XLSX.utils.sheet_to_csv(ws, { blankrows: false });
      if (!csvData.trim()) continue; // skip empty sheets

      const safeName =
        sheetName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'sheet';
      const csvFilename = `${safeName}.csv`;
      const uuid = randomUUID();
      const tmpCsvPath     = join(tmpdir(), `${uuid}.csv`);
      const tmpParquetPath = join(tmpdir(), `${uuid}.parquet`);
      const storageKey = `${companyId}/csvs/${mode}/${connectionName}/${uuid}.parquet`;

      try {
        writeFileSync(tmpCsvPath, csvData, 'utf-8');
        await conn.run(
          `COPY (SELECT * FROM read_csv_auto('${tmpCsvPath}')) TO '${tmpParquetPath}' (FORMAT PARQUET, COMPRESSION ZSTD)`
        );
        const parquetBuffer = readFileSync(tmpParquetPath);
        await store.put(storageKey, parquetBuffer, 'application/octet-stream');
        // Track only after the put succeeds — caller uses this list for cleanup on failure
        createdKeys.push(storageKey);
        results.push({ filename: csvFilename, s3_key: storageKey, schema_name: schemaName, file_format: 'parquet' });
      } finally {
        try { unlinkSync(tmpCsvPath); } catch { /* ignore */ }
        try { unlinkSync(tmpParquetPath); } catch { /* ignore */ }
      }
    }
  } finally {
    conn.closeSync();
    instance.closeSync();
  }

  if (results.length === 0) throw new Error('No non-empty sheets found in xlsx file');
  return results;
}

// ─── S3 delete ────────────────────────────────────────────────────────────────

/** Delete all stored files under a connection's prefix. Returns true if any were deleted. */
export async function deleteConnectionFiles(
  companyId: number,
  mode: string,
  connectionName: string,
): Promise<boolean> {
  if (isLocalObjectStore()) {
    const dir = resolve(join(LOCAL_UPLOAD_PATH, `${companyId}/csvs/${mode}/${connectionName}`));
    try {
      rmSync(dir, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  }

  if (!OBJECT_STORE_BUCKET) return false;
  const s3 = makeS3();
  const prefix = `${companyId}/csvs/${mode}/${connectionName}/`;

  const keys: string[] = [];
  let token: string | undefined;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({ Bucket: OBJECT_STORE_BUCKET, Prefix: prefix, ContinuationToken: token }),
    );
    for (const obj of res.Contents ?? []) if (obj.Key) keys.push(obj.Key);
    token = res.NextContinuationToken;
  } while (token);

  if (keys.length === 0) return false;

  for (let i = 0; i < keys.length; i += 1000) {
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: OBJECT_STORE_BUCKET,
        Delete: { Objects: keys.slice(i, i + 1000).map(Key => ({ Key })) },
      }),
    );
  }
  return true;
}

// ─── S3 single-file delete ────────────────────────────────────────────────────

/** Delete a single stored file by key. */
export async function deleteS3File(s3Key: string): Promise<void> {
  if (isLocalObjectStore()) {
    const filePath = resolve(join(LOCAL_UPLOAD_PATH, s3Key));
    try { unlinkSync(filePath); } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
    }
    return;
  }
  if (!OBJECT_STORE_BUCKET) throw new Error('OBJECT_STORE_BUCKET is not configured');
  const s3 = makeS3();
  await s3.send(new DeleteObjectCommand({ Bucket: OBJECT_STORE_BUCKET, Key: s3Key }));
}

// ─── DuckDB metadata extraction ───────────────────────────────────────────────

async function configureDuckDBForS3(conn: Awaited<ReturnType<InstanceType<typeof DuckDBInstance>['connect']>>) {
  await conn.run('INSTALL httpfs');
  await conn.run('LOAD httpfs');
  await conn.run(`SET s3_region = '${OBJECT_STORE_REGION}'`);
  if (OBJECT_STORE_ACCESS_KEY_ID) await conn.run(`SET s3_access_key_id = '${OBJECT_STORE_ACCESS_KEY_ID}'`);
  if (OBJECT_STORE_SECRET_ACCESS_KEY) await conn.run(`SET s3_secret_access_key = '${OBJECT_STORE_SECRET_ACCESS_KEY}'`);
  if (OBJECT_STORE_ENDPOINT) {
    await conn.run(`SET s3_endpoint = '${OBJECT_STORE_ENDPOINT}'`);
    await conn.run("SET s3_url_style = 'path'");
  }
}

async function readFileMetadata(
  conn: Awaited<ReturnType<InstanceType<typeof DuckDBInstance>['connect']>>,
  s3Url: string,
  format: 'csv' | 'parquet',
): Promise<{ rowCount: number; columns: Array<{ name: string; type: string }> }> {
  const viewName = `__meta_${randomUUID().replace(/-/g, '_')}`;
  const readExpr = format === 'parquet' ? `read_parquet('${s3Url}')` : `read_csv_auto('${s3Url}')`;

  await conn.run(`CREATE OR REPLACE TEMP VIEW "${viewName}" AS SELECT * FROM ${readExpr}`);

  const countResult = await conn.run(`SELECT COUNT(*) AS cnt FROM "${viewName}"`);
  const countRows = await countResult.getRowObjectsJS() as Array<{ cnt: bigint | number }>;
  const rowCount = Number(countRows[0]?.cnt ?? 0);

  const descResult = await conn.run(`DESCRIBE "${viewName}"`);
  const descRows = await descResult.getRowObjectsJS() as Array<{ column_name: string; column_type: string }>;
  const columns = descRows.map(r => ({ name: r.column_name, type: r.column_type }));

  await conn.run(`DROP VIEW IF EXISTS "${viewName}"`);
  return { rowCount, columns };
}

// ─── CSV → Parquet conversion ─────────────────────────────────────────────────

type DuckConn = Awaited<ReturnType<InstanceType<typeof DuckDBInstance>['connect']>>;

/**
 * Convert a CSV to Parquet (same key prefix, `.parquet` extension).
 * Works with both S3 and local filesystem storage.
 * Deletes the original CSV on success.
 * Returns the new key, or null if conversion fails (original left intact).
 */
async function convertCsvToParquet(conn: DuckConn, csvKey: string): Promise<string | null> {
  const parquetKey = csvKey.replace(/\.[^.]+$/, '') + '.parquet';
  const csvUrl     = getStorageUrl(csvKey);
  const parquetUrl = getStorageUrl(parquetKey);
  try {
    if (isLocalObjectStore()) {
      mkdirSync(dirname(parquetUrl), { recursive: true });
    }
    await conn.run(
      `COPY (SELECT * FROM read_csv_auto('${csvUrl}')) TO '${parquetUrl}' (FORMAT PARQUET, COMPRESSION ZSTD)`
    );
    // Parquet written — remove the now-redundant CSV
    if (isLocalObjectStore()) {
      try { unlinkSync(csvUrl); } catch { /* ignore */ }
    } else {
      await makeS3().send(new DeleteObjectCommand({ Bucket: OBJECT_STORE_BUCKET!, Key: csvKey }));
    }
    return parquetKey;
  } catch (err) {
    console.warn(`[csv-processor] Parquet conversion failed for ${csvKey}:`, err);
    // Delete any partial parquet DuckDB may have written before failing
    if (isLocalObjectStore()) {
      try { unlinkSync(parquetUrl); } catch { /* ignore — may not exist */ }
    } else {
      try {
        await makeS3().send(new DeleteObjectCommand({ Bucket: OBJECT_STORE_BUCKET!, Key: parquetKey }));
      } catch { /* ignore */ }
    }
    return null; // keep CSV as fallback
  }
}

// ─── Main registration function ───────────────────────────────────────────────

/**
 * Process a list of files (already uploaded to S3):
 * - Expands any xlsx files into per-sheet CSVs
 * - Reads row count + column metadata for each file via DuckDB
 * - Returns enriched file records ready to store in the connection config
 *
 * Atomic guarantee: either ALL files are fully written and DuckDB-validated and
 * the full results list is returned, OR every file created during this call is
 * deleted before throwing. No orphaned files are left on disk/S3.
 */
export async function processFilesFromS3(
  companyId: number,
  mode: string,
  connectionName: string,
  incomingFiles: IncomingFile[],
): Promise<RegisteredFile[]> {
  if (!isLocalObjectStore() && !OBJECT_STORE_BUCKET) throw new Error('OBJECT_STORE_BUCKET is not configured');

  // Every key created in this call is tracked here for atomic cleanup on failure.
  const toCleanup: string[] = [];

  try {
    // Expand xlsx files into CSV sheets
    const flatFiles: IncomingFile[] = [];
    for (const file of incomingFiles) {
      const fmt = file.file_format ?? detectFileFormat(file.filename);
      if (fmt === 'xlsx') {
        toCleanup.push(file.s3_key); // original xlsx uploaded by client
        const sheets = await expandXlsxFromS3(
          file.s3_key, connectionName, companyId, mode, file.schema_name ?? 'public',
          toCleanup, // xlsxBytesToS3Csvs pushes each sheet parquet key here after a successful put
        );
        flatFiles.push(...sheets);
      } else {
        toCleanup.push(file.s3_key); // original CSV/parquet uploaded by client
        flatFiles.push({ ...file, file_format: fmt });
      }
    }

    // Auto-assign table names where not provided, ensuring uniqueness
    const noNameFiles = flatFiles.filter(f => !f.table_name).map(f => f.filename);
    const autoNames = ensureUniqueTableNames(noNameFiles);

    const explicitNames = new Set(flatFiles.filter(f => f.table_name).map(f => f.table_name!));
    for (const autoName of autoNames.values()) {
      if (explicitNames.has(autoName)) {
        throw new Error(`Table name collision: '${autoName}' conflicts with a user-supplied table name`);
      }
    }

    // Convert CSV → Parquet and extract metadata via DuckDB
    const instance = await DuckDBInstance.create(':memory:');
    const conn = await instance.connect();
    try {
      if (!isLocalObjectStore()) {
        await configureDuckDBForS3(conn);
      }

      const results: RegisteredFile[] = [];
      for (const file of flatFiles) {
        let s3Key = file.s3_key;
        let format = (file.file_format ?? 'csv') as 'csv' | 'parquet';
        const tableName = file.table_name ?? autoNames.get(file.filename) ?? sanitizeTableName(file.filename);

        // Convert CSV → Parquet for fast columnar queries; fall back to CSV on error
        if (format === 'csv') {
          const converted = await convertCsvToParquet(conn, s3Key);
          if (converted) {
            // CSV was deleted by convertCsvToParquet; swap tracking to the parquet key
            const idx = toCleanup.lastIndexOf(s3Key);
            if (idx >= 0) toCleanup[idx] = converted;
            else toCleanup.push(converted);
            s3Key = converted;
            format = 'parquet';
          }
          // conversion returned null → original CSV key stays in toCleanup
        }

        const fileUrl = getStorageUrl(s3Key);
        const { rowCount, columns } = await readFileMetadata(conn, fileUrl, format);
        results.push({
          table_name: tableName,
          schema_name: file.schema_name ?? 'public',
          s3_key: s3Key,
          file_format: format,
          filename: file.filename,
          row_count: rowCount,
          columns,
        });
      }
      return results;
    } finally {
      conn.closeSync();
      instance.closeSync();
    }
  } catch (err) {
    // Atomic rollback: remove every file created during this call before surfacing the error
    await Promise.allSettled(toCleanup.map(key => deleteS3File(key)));
    throw err;
  }
}

// ─── Google Sheets helpers ────────────────────────────────────────────────────

export function parseSpreadsheetId(url: string): string {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) throw new Error(`Cannot parse spreadsheet ID from URL: ${url}`);
  return match[1];
}

export async function downloadSpreadsheetAsXlsx(spreadsheetId: string): Promise<Buffer> {
  const exportUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=xlsx`;
  const res = await fetch(exportUrl, { signal: AbortSignal.timeout(30_000) });
  if (res.status === 404) throw new Error('Spreadsheet not found — it may be private or deleted');
  if (res.status === 401 || res.status === 403) throw new Error('Spreadsheet is not publicly accessible');
  if (!res.ok) throw new Error(`Failed to download spreadsheet: ${res.status} ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Download a Google Sheet, expand sheets to CSVs, upload all to S3. */
export async function importGoogleSheetToS3(
  spreadsheetUrl: string,
  connectionName: string,
  companyId: number,
  mode: string,
  schemaName: string,
): Promise<{ files: IncomingFile[]; spreadsheetId: string }> {
  const spreadsheetId = parseSpreadsheetId(spreadsheetUrl);
  const xlsxBuffer = await downloadSpreadsheetAsXlsx(spreadsheetId);
  const files = await xlsxBytesToS3Csvs(xlsxBuffer, connectionName, companyId, mode, schemaName);
  return { files, spreadsheetId };
}

// ─── File format detection ─────────────────────────────────────────────────────

export function detectFileFormat(filename: string): 'csv' | 'parquet' | 'xlsx' {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext === 'parquet' || ext === 'pq') return 'parquet';
  if (ext === 'xlsx') return 'xlsx';
  return 'csv';
}
