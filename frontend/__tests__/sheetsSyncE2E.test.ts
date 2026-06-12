/**
 * Google Sheets auto-sync (sheets_sync job) through the real cron route.
 * `@/lib/csv-processor` is mocked — no network/S3/DuckDB involved.
 */

import { POST as cronPostHandler } from '@/app/api/jobs/cron/route';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { DocumentDB } from '@/lib/database/documents-db';
import { JobRunsDB } from '@/lib/database/job-runs-db';
import type { ConnectionContent, CsvFileInfo, RunFileContent } from '@/lib/types';
import { NextRequest } from 'next/server';

// ─── DB mock ──────────────────────────────────────────────────────────────────
vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

const TEST_DB_PATH = getTestDbPath('sheets_sync_e2e');

// ─── csv-processor mock ──────────────────────────────────────────────────────
const { mockImportGoogleSheetToS3, mockProcessFilesFromS3, mockDeleteS3File } = vi.hoisted(() => ({
  mockImportGoogleSheetToS3: vi.fn(),
  mockProcessFilesFromS3: vi.fn(),
  mockDeleteS3File: vi.fn(),
}));

vi.mock('@/lib/csv-processor', () => ({
  importGoogleSheetToS3: mockImportGoogleSheetToS3,
  processFilesFromS3: mockProcessFilesFromS3,
  deleteS3File: mockDeleteS3File,
  deleteConnectionFiles: vi.fn(),
}));

// ─── Node connector mock (connection save live-tests + loader introspection) ──
vi.mock('@/lib/connections', () => ({
  getNodeConnector: vi.fn().mockReturnValue({
    query: vi.fn().mockResolvedValue({ columns: [], types: [], rows: [], finalQuery: '' }),
    testConnection: vi.fn().mockResolvedValue({ success: true, message: 'ok' }),
    getSchema: vi.fn().mockResolvedValue([]),
  }),
}));

// ─── Org config mock (cron route loads it for message delivery) ──────────────
vi.mock('@/lib/data/configs.server', () => ({
  getConfigsForMode: vi.fn().mockResolvedValue({ config: {} }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TEST_CRON_SECRET = 'test-cron-secret';

function makeCronRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/jobs/cron', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${TEST_CRON_SECRET}`,
    },
    body: JSON.stringify({}),
  });
}

const SHEET_URL_1 = 'https://docs.google.com/spreadsheets/d/SS1/edit';
const SHEET_URL_2 = 'https://docs.google.com/spreadsheets/d/SS2/edit';

function sheetFile(overrides: Partial<CsvFileInfo>): CsvFileInfo {
  return {
    filename: 'Sheet1.csv',
    table_name: 'sheet1',
    schema_name: 'gs',
    s3_key: 'old/key',
    file_format: 'parquet',
    row_count: 10,
    columns: [{ name: 'a', type: 'VARCHAR' }],
    source_type: 'google_sheets',
    spreadsheet_url: SHEET_URL_1,
    spreadsheet_id: 'SS1',
    ...overrides,
  };
}

const CSV_UPLOAD_FILE: CsvFileInfo = {
  filename: 'upload.csv',
  table_name: 'upload',
  schema_name: 'public',
  s3_key: 'csv/upload.parquet',
  file_format: 'parquet',
  row_count: 3,
  columns: [{ name: 'x', type: 'BIGINT' }],
  source_type: 'csv',
};

function baseConnectionContent(): ConnectionContent {
  return {
    id: 'sheets_synced',
    name: 'sheets_synced',
    type: 'csv',
    config: {
      files: [
        CSV_UPLOAD_FILE,
        sheetFile({ filename: 'Orders.csv', table_name: 'orders_renamed', s3_key: 'old/orders' }),
        sheetFile({ filename: 'Customers.csv', table_name: 'customers', s3_key: 'old/customers' }),
      ],
    },
    autoSync: { cron: '* * * * *', timezone: 'UTC' },
    schema: { databases: [] } as any,  // stale cached schema, replaced on sync
  } as ConnectionContent;
}

async function getConnection(id: number): Promise<ConnectionContent> {
  const file = await DocumentDB.getById(id);
  return file!.content as ConnectionContent;
}

/** Default happy-path mock: reimport of SS1 returns two fresh files. */
function mockSuccessfulReimport() {
  mockImportGoogleSheetToS3.mockImplementation(async (url: string) => {
    const id = url.includes('SS2') ? 'SS2' : 'SS1';
    return {
      spreadsheetId: id,
      files: [
        { filename: 'Orders.csv', s3_key: `new/${id}/orders`, schema_name: 'gs', file_format: 'csv' },
        { filename: 'Customers.csv', s3_key: `new/${id}/customers`, schema_name: 'gs', file_format: 'csv' },
      ],
    };
  });
  mockProcessFilesFromS3.mockImplementation(async (_mode: string, _conn: string, incoming: any[]) =>
    incoming.map((f: any) => ({
      filename: f.filename,
      table_name: f.filename.replace('.csv', '').toLowerCase(),
      schema_name: f.schema_name,
      s3_key: f.s3_key.replace(/\.csv$/, '') + '.parquet',
      file_format: 'parquet' as const,
      row_count: 42,
      columns: [{ name: 'a', type: 'VARCHAR' }],
    }))
  );
  mockDeleteS3File.mockResolvedValue(undefined);
}

// ─── Test data IDs (set in customInit) ────────────────────────────────────────
let syncedConnId: number;
let plainConnId: number;

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('Google Sheets Auto-Sync E2E', () => {
  setupTestDb(TEST_DB_PATH, {
    customInit: async () => {
      syncedConnId = await DocumentDB.create(
        'sheets_synced', '/org/database/sheets_synced', 'connection', baseConnectionContent(), [], undefined, false
      );
      // A sheets connection with NO autoSync — must never be picked up by cron
      const plain = baseConnectionContent() as ConnectionContent & { id: string; name: string };
      delete (plain as any).autoSync;
      plain.name = 'plain_sheets';
      plain.id = 'plain_sheets';
      plainConnId = await DocumentDB.create(
        'plain_sheets', '/org/database/plain_sheets', 'connection', plain, [], undefined, false
      );
      await JobRunsDB.ensureTable();
    },
  });

  beforeEach(() => {
    process.env.CRON_SECRET = TEST_CRON_SECRET;
    mockImportGoogleSheetToS3.mockReset();
    mockProcessFilesFromS3.mockReset();
    mockDeleteS3File.mockReset();
    mockSuccessfulReimport();
  });

  it('syncs a due connection: replaces sheet files, preserves renames and CSV uploads', async () => {
    const res = await cronPostHandler(makeCronRequest());
    expect(res.status).toBe(200);

    const runs = await JobRunsDB.getByJobId(String(syncedConnId), 'sheets_sync');
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('SUCCESS');
    expect(runs[0].source).toBe('cron');

    const conn = await getConnection(syncedConnId);
    const files = conn.config.files as CsvFileInfo[];

    // CSV upload untouched
    expect(files.find((f) => f.s3_key === 'csv/upload.parquet')).toEqual(CSV_UPLOAD_FILE);

    // Sheet files replaced with new S3 keys
    const sheetFiles = files.filter((f) => f.source_type === 'google_sheets');
    expect(sheetFiles).toHaveLength(2);
    expect(sheetFiles.map((f) => f.s3_key).sort()).toEqual([
      'new/SS1/customers.parquet',
      'new/SS1/orders.parquet',
    ]);
    // Source metadata reattached
    for (const f of sheetFiles) {
      expect(f.spreadsheet_id).toBe('SS1');
      expect(f.spreadsheet_url).toBe(SHEET_URL_1);
      expect(f.source_type).toBe('google_sheets');
    }

    // User's table rename preserved by filename match (Orders.csv was "orders_renamed")
    const orders = sheetFiles.find((f) => f.filename === 'Orders.csv')!;
    expect(orders.table_name).toBe('orders_renamed');
    // Un-renamed table takes the fresh name
    const customers = sheetFiles.find((f) => f.filename === 'Customers.csv')!;
    expect(customers.table_name).toBe('customers');

    // Sync bookkeeping
    expect(conn.lastSyncedAt).toBeTruthy();
    expect(conn.lastSyncError).toBeUndefined();
    // saveFile re-introspects on save, so the stale placeholder must be gone
    expect((conn.schema as any)?.databases).toBeUndefined();
    if (conn.schema) expect(conn.schema.updated_at).toBeTruthy();
    // autoSync schedule preserved
    expect(conn.autoSync?.cron).toBe('* * * * *');

    // Old S3 keys deleted after successful import
    const deletedKeys = mockDeleteS3File.mock.calls.map((c) => c[0]).sort();
    expect(deletedKeys).toEqual(['old/customers', 'old/orders']);

    // Run file records per-spreadsheet results
    const runFile = await DocumentDB.getById(runs[0].output_file_id!);
    const content = runFile!.content as RunFileContent;
    expect(content.job_type).toBe('sheets_sync');
    expect(content.status).toBe('success');
    expect((content.output as any).results).toHaveLength(1);
    expect((content.output as any).results[0].status).toBe('success');
  });

  it('never picks up a connection without autoSync', async () => {
    await cronPostHandler(makeCronRequest());
    const runs = await JobRunsDB.getByJobId(String(plainConnId), 'sheets_sync');
    expect(runs).toHaveLength(0);
    // And its content is untouched
    const conn = await getConnection(plainConnId);
    expect(conn.lastSyncedAt).toBeUndefined();
    expect((conn.config.files as CsvFileInfo[]).map((f) => f.s3_key)).toContain('old/orders');
  });

  it('skips when the cron schedule is not due (last fire >1h ago)', async () => {
    const safeHour = (new Date().getHours() - 2 + 24) % 24;
    const content = baseConnectionContent();
    content.autoSync = { cron: `0 ${safeHour} * * *`, timezone: 'UTC' };
    await DocumentDB.update(syncedConnId, 'sheets_synced', '/org/database/sheets_synced', content, [], 'test-edit');

    await cronPostHandler(makeCronRequest());
    const runs = await JobRunsDB.getByJobId(String(syncedConnId), 'sheets_sync');
    expect(runs).toHaveLength(0);
    expect(mockImportGoogleSheetToS3).not.toHaveBeenCalled();
  });

  it('deduplicates: second cron call within the same window does not sync twice', async () => {
    await cronPostHandler(makeCronRequest());
    await cronPostHandler(makeCronRequest());

    const runs = await JobRunsDB.getByJobId(String(syncedConnId), 'sheets_sync');
    expect(runs).toHaveLength(1);
    expect(mockImportGoogleSheetToS3).toHaveBeenCalledTimes(1);
  });

  it('on fetch failure keeps old files, records lastSyncError, marks run FAILURE', async () => {
    mockImportGoogleSheetToS3.mockRejectedValue(new Error('Spreadsheet is not publicly accessible'));

    await cronPostHandler(makeCronRequest());

    const runs = await JobRunsDB.getByJobId(String(syncedConnId), 'sheets_sync');
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('FAILURE');

    const conn = await getConnection(syncedConnId);
    const files = conn.config.files as CsvFileInfo[];
    // Old data fully intact — stale beats broken
    expect(files.map((f) => f.s3_key).sort()).toEqual(['csv/upload.parquet', 'old/customers', 'old/orders']);
    expect(conn.lastSyncError).toContain('not publicly accessible');
    expect(conn.lastSyncedAt).toBeUndefined();
    // No deletions when nothing was imported
    expect(mockDeleteS3File).not.toHaveBeenCalled();
  });

  it('partial failure across two spreadsheets: good group updated, bad group kept, run FAILURE', async () => {
    // Add a second spreadsheet group to the connection
    const content = baseConnectionContent();
    (content.config.files as CsvFileInfo[]).push(
      sheetFile({ filename: 'Leads.csv', table_name: 'leads', s3_key: 'old/leads', spreadsheet_id: 'SS2', spreadsheet_url: SHEET_URL_2 })
    );
    await DocumentDB.update(syncedConnId, 'sheets_synced', '/org/database/sheets_synced', content, [], 'test-edit');

    mockImportGoogleSheetToS3.mockImplementation(async (url: string) => {
      if (url.includes('SS2')) throw new Error('Spreadsheet not found — it may be private or deleted');
      return {
        spreadsheetId: 'SS1',
        files: [{ filename: 'Orders.csv', s3_key: 'new/SS1/orders.csv', schema_name: 'gs', file_format: 'csv' }],
      };
    });

    await cronPostHandler(makeCronRequest());

    const runs = await JobRunsDB.getByJobId(String(syncedConnId), 'sheets_sync');
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('FAILURE');

    const conn = await getConnection(syncedConnId);
    const files = conn.config.files as CsvFileInfo[];

    // SS1 group replaced (Customers tab disappeared from the sheet → dropped)
    const ss1 = files.filter((f) => f.spreadsheet_id === 'SS1');
    expect(ss1).toHaveLength(1);
    expect(ss1[0].s3_key).toBe('new/SS1/orders.parquet');
    expect(ss1[0].table_name).toBe('orders_renamed');

    // SS2 group untouched
    const ss2 = files.filter((f) => f.spreadsheet_id === 'SS2');
    expect(ss2).toHaveLength(1);
    expect(ss2[0].s3_key).toBe('old/leads');

    // Successful sync still recorded, error names the failing sheet
    expect(conn.lastSyncedAt).toBeTruthy();
    expect(conn.lastSyncError).toContain('not found');

    // Run file shows one success + one error
    const runFile = await DocumentDB.getById(runs[0].output_file_id!);
    const output = (runFile!.content as RunFileContent).output as any;
    const statuses = output.results.map((r: any) => r.status).sort();
    expect(statuses).toEqual(['error', 'success']);
  });
});
