/**
 * Tests for csv-processor.ts
 *
 * Pure functions: covered directly.
 * S3 + DuckDB paths: covered via mocks — no real infrastructure needed.
 */

jest.mock('server-only', () => ({}));
// Mock fs so DuckDB's COPY TO (which is a no-op in tests) doesn't block readFileSync
jest.mock('fs', () => ({
  writeFileSync: jest.fn(),
  readFileSync: jest.fn().mockReturnValue(Buffer.from('mock-parquet')),
  unlinkSync: jest.fn(),
}));
jest.mock('@duckdb/node-api', () => ({ DuckDBInstance: { create: jest.fn() } }));
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(),
  GetObjectCommand: jest.fn(),
  PutObjectCommand: jest.fn(),
  ListObjectsV2Command: jest.fn(),
  DeleteObjectsCommand: jest.fn(),
}));
jest.mock('@/lib/config', () => ({
  OBJECT_STORE_BUCKET: 'test-bucket',
  OBJECT_STORE_REGION: 'us-east-1',
  OBJECT_STORE_ACCESS_KEY_ID: 'test-key',
  OBJECT_STORE_SECRET_ACCESS_KEY: 'test-secret',
  OBJECT_STORE_ENDPOINT: undefined,
}));

import { S3Client } from '@aws-sdk/client-s3';
import { DuckDBInstance } from '@duckdb/node-api';
import * as XLSX from 'xlsx';
import {
  sanitizeTableName,
  ensureUniqueTableNames,
  detectFileFormat,
  parseSpreadsheetId,
  processFilesFromS3,
  deleteConnectionFiles,
  importGoogleSheetToS3,
} from '../csv-processor';

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeXlsxBuffer(sheets: Record<string, string[][]>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [name, data] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), name);
  }
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

async function* makeStream(buf: Buffer): AsyncIterable<Uint8Array> {
  yield new Uint8Array(buf);
}

// ─── Shared mock setup ────────────────────────────────────────────────────────

let mockSend: jest.Mock;
let mockConnRun: jest.Mock;
let mockCloseSync: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();

  // S3 mock — default: all sends succeed
  mockSend = jest.fn().mockResolvedValue({});
  (S3Client as jest.Mock).mockImplementation(() => ({ send: mockSend }));

  // DuckDB mock — COUNT returns 5 rows, DESCRIBE returns two columns
  mockConnRun = jest.fn().mockImplementation(async (sql: string) => {
    if (sql.includes('COUNT(*)')) return { getRowObjectsJS: async () => [{ cnt: BigInt(5) }] };
    if (sql.startsWith('DESCRIBE')) return {
      getRowObjectsJS: async () => [
        { column_name: 'id', column_type: 'INTEGER' },
        { column_name: 'name', column_type: 'VARCHAR' },
      ],
    };
    return {};
  });
  mockCloseSync = jest.fn();
  (DuckDBInstance.create as jest.Mock).mockResolvedValue({
    connect: jest.fn().mockResolvedValue({ run: mockConnRun, closeSync: mockCloseSync }),
  });
});

// ─── sanitizeTableName ────────────────────────────────────────────────────────

describe('sanitizeTableName', () => {
  it('strips extension', () => expect(sanitizeTableName('orders.csv')).toBe('orders'));
  it('lowercases and replaces spaces', () => expect(sanitizeTableName('My Orders.csv')).toBe('my_orders'));
  it('replaces hyphens', () => expect(sanitizeTableName('sales-data.parquet')).toBe('sales_data'));
  it('prefixes t_ when starts with digit', () => expect(sanitizeTableName('2024.csv')).toBe('t_2024'));
  it('strips leading/trailing underscores', () => expect(sanitizeTableName('__data__.csv')).toBe('data'));
  it('truncates to 63 chars', () => expect(sanitizeTableName('a'.repeat(80) + '.csv').length).toBeLessThanOrEqual(63));
  it('falls back to "table" for empty result', () => expect(sanitizeTableName('!@#$.csv')).toBe('table'));
  it('strips special characters', () => expect(sanitizeTableName('order$ (2024).csv')).toBe('order_2024'));
});

// ─── ensureUniqueTableNames ───────────────────────────────────────────────────

describe('ensureUniqueTableNames', () => {
  it('assigns names from filenames', () => {
    const map = ensureUniqueTableNames(['orders.csv', 'users.csv']);
    expect(map.get('orders.csv')).toBe('orders');
    expect(map.get('users.csv')).toBe('users');
  });

  it('deduplicates with numeric suffix', () => {
    const map = ensureUniqueTableNames(['data.csv', 'data.parquet']);
    expect(map.get('data.csv')).toBe('data');
    expect(map.get('data.parquet')).toBe('data_2');
  });

  it('handles three-way collision', () => {
    const map = ensureUniqueTableNames(['x.csv', 'x.parquet', 'x.xlsx']);
    expect(map.get('x.csv')).toBe('x');
    expect(map.get('x.parquet')).toBe('x_2');
    expect(map.get('x.xlsx')).toBe('x_3');
  });

  it('returns empty map for empty input', () => expect(ensureUniqueTableNames([]).size).toBe(0));
});

// ─── detectFileFormat ─────────────────────────────────────────────────────────

describe('detectFileFormat', () => {
  it('detects parquet', () => expect(detectFileFormat('data.parquet')).toBe('parquet'));
  it('detects .pq alias', () => expect(detectFileFormat('data.pq')).toBe('parquet'));
  it('detects xlsx', () => expect(detectFileFormat('data.xlsx')).toBe('xlsx'));
  it('detects xlsx case-insensitively', () => expect(detectFileFormat('DATA.XLSX')).toBe('xlsx'));
  it('defaults to csv', () => expect(detectFileFormat('data.csv')).toBe('csv'));
  it('defaults csv for unknown extension', () => expect(detectFileFormat('data.tsv')).toBe('csv'));
});

// ─── parseSpreadsheetId ───────────────────────────────────────────────────────

describe('parseSpreadsheetId', () => {
  it('extracts ID from share URL', () => {
    expect(parseSpreadsheetId('https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5/edit#gid=0')).toBe('1BxiMVs0XRA5');
  });

  it('extracts ID from export URL', () => {
    expect(parseSpreadsheetId('https://docs.google.com/spreadsheets/d/abc-123_XYZ/export?format=csv')).toBe('abc-123_XYZ');
  });

  it('throws on unrecognised URL', () => {
    expect(() => parseSpreadsheetId('https://example.com/foo')).toThrow('Cannot parse spreadsheet ID');
  });
});

// ─── processFilesFromS3 ───────────────────────────────────────────────────────

describe('processFilesFromS3', () => {
  it('extracts metadata for a CSV file', async () => {
    const result = await processFilesFromS3(1, 'org', 'myconn', [{
      filename: 'orders.csv',
      s3_key: '1/csvs/org/myconn/orders.csv',
      schema_name: 'public',
      file_format: 'csv',
    }]);

    expect(result).toHaveLength(1);
    expect(result[0].table_name).toBe('orders');
    expect(result[0].schema_name).toBe('public');
    expect(result[0].file_format).toBe('csv');
    expect(result[0].row_count).toBe(5);
    expect(result[0].columns).toEqual([
      { name: 'id', type: 'INTEGER' },
      { name: 'name', type: 'VARCHAR' },
    ]);
  });

  it('uses read_parquet for parquet files', async () => {
    await processFilesFromS3(1, 'org', 'myconn', [{
      filename: 'orders.parquet',
      s3_key: '1/csvs/org/myconn/orders.parquet',
      file_format: 'parquet',
    }]);

    const createViewCall = mockConnRun.mock.calls.find(
      ([sql]: [string]) => sql.includes('CREATE OR REPLACE TEMP VIEW'),
    );
    expect(createViewCall[0]).toContain('read_parquet(');
  });

  it('uses read_csv_auto for csv files', async () => {
    await processFilesFromS3(1, 'org', 'myconn', [{
      filename: 'orders.csv',
      s3_key: '1/csvs/org/myconn/orders.csv',
      file_format: 'csv',
    }]);

    const createViewCall = mockConnRun.mock.calls.find(
      ([sql]: [string]) => sql.includes('CREATE OR REPLACE TEMP VIEW'),
    );
    expect(createViewCall[0]).toContain('read_csv_auto(');
  });

  it('auto-generates table name from filename when not provided', async () => {
    const result = await processFilesFromS3(1, 'org', 'myconn', [{
      filename: 'My Sales Data.csv',
      s3_key: '1/csvs/org/myconn/file.csv',
    }]);

    expect(result[0].table_name).toBe('my_sales_data');
  });

  it('respects explicit table_name', async () => {
    const result = await processFilesFromS3(1, 'org', 'myconn', [{
      filename: 'orders.csv',
      s3_key: '1/csvs/org/myconn/orders.csv',
      table_name: 'custom_name',
    }]);

    expect(result[0].table_name).toBe('custom_name');
  });

  it('defaults schema_name to "public" when not provided', async () => {
    const result = await processFilesFromS3(1, 'org', 'myconn', [{
      filename: 'orders.csv',
      s3_key: '1/csvs/org/myconn/orders.csv',
    }]);

    expect(result[0].schema_name).toBe('public');
  });

  it('respects explicit schema_name', async () => {
    const result = await processFilesFromS3(1, 'org', 'myconn', [{
      filename: 'orders.csv',
      s3_key: '1/csvs/org/myconn/orders.csv',
      schema_name: 'sales',
    }]);

    expect(result[0].schema_name).toBe('sales');
  });

  it('expands xlsx into one record per non-empty sheet', async () => {
    const xlsxBuf = makeXlsxBuffer({
      Sales: [['id', 'amount'], ['1', '100']],
      Users: [['name', 'email'], ['Alice', 'a@b.com']],
    });
    mockSend
      .mockResolvedValueOnce({ Body: makeStream(xlsxBuf) }) // GET xlsx from S3
      .mockResolvedValue({});                                // PUT each Parquet

    const result = await processFilesFromS3(1, 'org', 'myconn', [{
      filename: 'workbook.xlsx',
      s3_key: '1/csvs/org/myconn/workbook.xlsx',
      schema_name: 'public',
      file_format: 'xlsx',
    }]);

    expect(result).toHaveLength(2);
    expect(result.map(r => r.table_name)).toEqual(expect.arrayContaining(['sales', 'users']));
    expect(result.every(r => r.file_format === 'parquet')).toBe(true);
  });

  it('skips empty sheets in xlsx', async () => {
    const xlsxBuf = makeXlsxBuffer({
      Populated: [['id'], ['1']],
      Empty: [],
    });
    mockSend
      .mockResolvedValueOnce({ Body: makeStream(xlsxBuf) })
      .mockResolvedValue({});

    const result = await processFilesFromS3(1, 'org', 'myconn', [{
      filename: 'wb.xlsx',
      s3_key: '1/csvs/org/myconn/wb.xlsx',
      file_format: 'xlsx',
    }]);

    expect(result).toHaveLength(1);
    expect(result[0].table_name).toBe('populated');
  });

  it('throws when all xlsx sheets are empty', async () => {
    const xlsxBuf = makeXlsxBuffer({ Empty: [] });
    mockSend.mockResolvedValueOnce({ Body: makeStream(xlsxBuf) });

    await expect(
      processFilesFromS3(1, 'org', 'myconn', [{
        filename: 'empty.xlsx',
        s3_key: '1/csvs/org/myconn/empty.xlsx',
        file_format: 'xlsx',
      }]),
    ).rejects.toThrow('No non-empty sheets found');
  });

  it('auto-assigns unique names when filenames collide', async () => {
    const result = await processFilesFromS3(1, 'org', 'myconn', [
      { filename: 'data.csv', s3_key: 'k1' },
      { filename: 'data.parquet', s3_key: 'k2' },
    ]);

    const names = result.map(r => r.table_name);
    expect(names).toContain('data');
    expect(names).toContain('data_2');
  });

  it('throws on collision between user-supplied and auto-generated table names', async () => {
    await expect(
      processFilesFromS3(1, 'org', 'myconn', [
        { filename: 'orders.csv', s3_key: 'k1', table_name: 'orders' }, // explicit
        { filename: 'orders.parquet', s3_key: 'k2' },                   // auto → also 'orders'
      ]),
    ).rejects.toThrow('collision');
  });

  it('passes s3_key through to result unchanged', async () => {
    const result = await processFilesFromS3(1, 'org', 'myconn', [{
      filename: 'orders.csv',
      s3_key: '1/csvs/org/myconn/abc-def.csv',
    }]);

    expect(result[0].s3_key).toBe('1/csvs/org/myconn/abc-def.csv');
  });

  it('handles multiple files in one call', async () => {
    const result = await processFilesFromS3(1, 'org', 'myconn', [
      { filename: 'orders.csv', s3_key: 'k1', schema_name: 'sales' },
      { filename: 'users.csv', s3_key: 'k2', schema_name: 'auth' },
    ]);

    expect(result).toHaveLength(2);
    expect(result[0].schema_name).toBe('sales');
    expect(result[1].schema_name).toBe('auth');
  });

  it('closes the DuckDB connection in the finally block', async () => {
    await processFilesFromS3(1, 'org', 'myconn', [{
      filename: 'orders.csv',
      s3_key: 'k1',
    }]);

    expect(mockCloseSync).toHaveBeenCalledTimes(1);
  });

  it('still closes DuckDB connection when metadata extraction fails', async () => {
    mockConnRun.mockRejectedValueOnce(new Error('DuckDB exploded'));

    await expect(
      processFilesFromS3(1, 'org', 'myconn', [{ filename: 'bad.csv', s3_key: 'k1' }]),
    ).rejects.toThrow('DuckDB exploded');

    expect(mockCloseSync).toHaveBeenCalledTimes(1);
  });
});

// ─── deleteConnectionFiles ────────────────────────────────────────────────────

describe('deleteConnectionFiles', () => {
  it('deletes all objects under the connection prefix and returns true', async () => {
    mockSend
      .mockResolvedValueOnce({
        Contents: [{ Key: '1/csvs/org/myconn/a.csv' }, { Key: '1/csvs/org/myconn/b.parquet' }],
        NextContinuationToken: undefined,
      })
      .mockResolvedValue({}); // delete call

    const result = await deleteConnectionFiles(1, 'org', 'myconn');

    expect(result).toBe(true);
    // Second send call should be the DeleteObjectsCommand
    const deleteCall = mockSend.mock.calls[1];
    expect(deleteCall).toBeDefined();
  });

  it('returns false when no objects exist under the prefix', async () => {
    mockSend.mockResolvedValueOnce({ Contents: [], NextContinuationToken: undefined });

    const result = await deleteConnectionFiles(1, 'org', 'myconn');

    expect(result).toBe(false);
  });

  it('paginates through multiple list pages before deleting', async () => {
    mockSend
      .mockResolvedValueOnce({
        Contents: [{ Key: '1/csvs/org/conn/a.csv' }],
        NextContinuationToken: 'token-1',
      })
      .mockResolvedValueOnce({
        Contents: [{ Key: '1/csvs/org/conn/b.csv' }],
        NextContinuationToken: undefined,
      })
      .mockResolvedValue({}); // delete call

    await deleteConnectionFiles(1, 'org', 'conn');

    // 2 list calls + 1 delete call
    expect(mockSend).toHaveBeenCalledTimes(3);
  });
});

// ─── importGoogleSheetToS3 ────────────────────────────────────────────────────

describe('importGoogleSheetToS3', () => {
  const SHEET_URL = 'https://docs.google.com/spreadsheets/d/sheet123/edit';

  beforeEach(() => {
    // Reset global fetch for each test
    global.fetch = jest.fn();
  });

  it('downloads the sheet, uploads CSVs and returns files + spreadsheetId', async () => {
    const xlsxBuf = makeXlsxBuffer({
      Orders: [['id', 'total'], ['1', '99']],
    });
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => xlsxBuf.buffer.slice(xlsxBuf.byteOffset, xlsxBuf.byteOffset + xlsxBuf.byteLength),
    });

    const { files, spreadsheetId } = await importGoogleSheetToS3(
      SHEET_URL, 'myconn', 1, 'org', 'public',
    );

    expect(spreadsheetId).toBe('sheet123');
    expect(files).toHaveLength(1);
    expect(files[0].file_format).toBe('parquet');
    expect(files[0].schema_name).toBe('public');
    // S3 PUT was called to upload the Parquet
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('expands multi-sheet workbook into multiple files', async () => {
    const xlsxBuf = makeXlsxBuffer({
      Orders: [['id'], ['1']],
      Users: [['name'], ['Alice']],
    });
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => xlsxBuf.buffer.slice(xlsxBuf.byteOffset, xlsxBuf.byteOffset + xlsxBuf.byteLength),
    });

    const { files } = await importGoogleSheetToS3(SHEET_URL, 'conn', 1, 'org', 'public');

    expect(files).toHaveLength(2);
  });

  it('throws when spreadsheet is not publicly accessible (403)', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 403, statusText: 'Forbidden' });

    await expect(
      importGoogleSheetToS3(SHEET_URL, 'conn', 1, 'org', 'public'),
    ).rejects.toThrow('not publicly accessible');
  });

  it('throws when spreadsheet is not found (404)', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' });

    await expect(
      importGoogleSheetToS3(SHEET_URL, 'conn', 1, 'org', 'public'),
    ).rejects.toThrow('not found');
  });

  it('throws on other HTTP errors', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 500, statusText: 'Server Error' });

    await expect(
      importGoogleSheetToS3(SHEET_URL, 'conn', 1, 'org', 'public'),
    ).rejects.toThrow('Failed to download spreadsheet');
  });
});
