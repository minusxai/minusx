import 'server-only';

/**
 * CSV and Google Sheets processing — all logic lives here in Node.js.
 * Handles xlsx expansion, S3 uploads/deletes, and DuckDB metadata extraction.
 */

import { randomUUID } from 'crypto';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { DuckDBInstance } from '@duckdb/node-api';
import * as XLSX from 'xlsx';
import {
  OBJECT_STORE_BUCKET,
  OBJECT_STORE_REGION,
  OBJECT_STORE_ACCESS_KEY_ID,
  OBJECT_STORE_SECRET_ACCESS_KEY,
  OBJECT_STORE_ENDPOINT,
} from '@/lib/config';

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

export function sanitizeTableName(filename: string): string {
  let name = filename.replace(/\.[^.]+$/, ''); // strip extension
  name = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (/^\d/.test(name)) name = 't_' + name;
  name = name.slice(0, 63);
  return name || 'table';
}

function ensureUniqueTableNames(filenames: string[]): Map<string, string> {
  const result = new Map<string, string>();
  const used = new Set<string>();
  for (const filename of filenames) {
    const base = sanitizeTableName(filename);
    let name = base;
    let counter = 2;
    while (used.has(name)) name = `${base}_${counter++}`;
    result.set(filename, name);
    used.add(name);
  }
  return result;
}

// ─── xlsx expansion ───────────────────────────────────────────────────────────

/**
 * Download an xlsx from S3, expand each non-empty sheet to a CSV, upload back to S3.
 * Returns one IncomingFile record per sheet.
 */
async function expandXlsxFromS3(
  s3Key: string,
  connectionName: string,
  companyId: number,
  mode: string,
  schemaName: string,
): Promise<IncomingFile[]> {
  const s3 = makeS3();
  const response = await s3.send(new GetObjectCommand({ Bucket: OBJECT_STORE_BUCKET!, Key: s3Key }));
  const chunks: Uint8Array[] = [];
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
  const buffer = Buffer.concat(chunks);
  return xlsxBytesToS3Csvs(buffer, connectionName, companyId, mode, schemaName);
}

/**
 * Parse xlsx bytes, convert each non-empty sheet to CSV, upload to S3.
 * Shared by both CSV uploads (xlsx file already in S3) and Google Sheets import.
 */
async function xlsxBytesToS3Csvs(
  buffer: Buffer,
  connectionName: string,
  companyId: number,
  mode: string,
  schemaName: string,
): Promise<IncomingFile[]> {
  const s3 = makeS3();
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const results: IncomingFile[] = [];

  for (const sheetName of workbook.SheetNames) {
    const ws = workbook.Sheets[sheetName];
    const csvData = XLSX.utils.sheet_to_csv(ws, { blankrows: false });
    if (!csvData.trim()) continue; // skip empty sheets

    const safeName =
      sheetName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'sheet';
    const csvFilename = `${safeName}.csv`;
    const newKey = `${companyId}/csvs/${mode}/${connectionName}/${randomUUID()}_${csvFilename}`;

    await s3.send(
      new PutObjectCommand({
        Bucket: OBJECT_STORE_BUCKET!,
        Key: newKey,
        Body: Buffer.from(csvData, 'utf-8'),
        ContentType: 'text/csv',
      }),
    );

    results.push({ filename: csvFilename, s3_key: newKey, schema_name: schemaName, file_format: 'csv' });
  }

  if (results.length === 0) throw new Error('No non-empty sheets found in xlsx file');
  return results;
}

// ─── S3 delete ────────────────────────────────────────────────────────────────

/** Delete all S3 objects under a connection's prefix. Returns true if any were deleted. */
export async function deleteConnectionFiles(
  companyId: number,
  mode: string,
  connectionName: string,
): Promise<boolean> {
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

// ─── Main registration function ───────────────────────────────────────────────

/**
 * Process a list of files (already uploaded to S3):
 * - Expands any xlsx files into per-sheet CSVs
 * - Reads row count + column metadata for each file via DuckDB
 * - Returns enriched file records ready to store in the connection config
 */
export async function processFilesFromS3(
  companyId: number,
  mode: string,
  connectionName: string,
  incomingFiles: IncomingFile[],
): Promise<RegisteredFile[]> {
  if (!OBJECT_STORE_BUCKET) throw new Error('OBJECT_STORE_BUCKET is not configured');

  // Expand xlsx files into CSV sheets
  const flatFiles: IncomingFile[] = [];
  for (const file of incomingFiles) {
    const fmt = file.file_format ?? detectFileFormat(file.filename);
    if (fmt === 'xlsx') {
      const sheets = await expandXlsxFromS3(
        file.s3_key, connectionName, companyId, mode, file.schema_name ?? 'public',
      );
      flatFiles.push(...sheets);
    } else {
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

  // Extract metadata via DuckDB
  const instance = await DuckDBInstance.create(':memory:');
  const conn = await instance.connect();
  try {
    await configureDuckDBForS3(conn);

    const results: RegisteredFile[] = [];
    for (const file of flatFiles) {
      const format = (file.file_format ?? 'csv') as 'csv' | 'parquet';
      const tableName = file.table_name ?? autoNames.get(file.filename) ?? sanitizeTableName(file.filename);
      const s3Url = `s3://${OBJECT_STORE_BUCKET}/${file.s3_key}`;

      const { rowCount, columns } = await readFileMetadata(conn, s3Url, format);
      results.push({
        table_name: tableName,
        schema_name: file.schema_name ?? 'public',
        s3_key: file.s3_key,
        file_format: format,
        filename: file.filename,
        row_count: rowCount,
        columns,
      });
    }
    return results;
  } finally {
    conn.closeSync();
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
