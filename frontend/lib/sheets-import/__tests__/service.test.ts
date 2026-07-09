/**
 * The agentic-import service — the server orchestration the API routes call:
 *  - analyze: download spreadsheet → raw grids → agent authors transforms (previews included);
 *  - revise: re-run the agent with the current transforms + user feedback;
 *  - confirm: materialize the accepted transforms and return connection-ready CsvFileInfo
 *    records (transform attached, so resync can re-run the same cleaning), raw grids cleaned up.
 *
 * The download + LLM are mocked; grids, SQL validation, and materialization are real.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import * as XLSX from 'xlsx';

const TEMP_STORE = vi.hoisted(() => {
  const { mkdtempSync } = require('fs') as typeof import('fs');
  const { tmpdir } = require('os') as typeof import('os');
  const { join: j } = require('path') as typeof import('path');
  return mkdtempSync(j(tmpdir(), 'mx-sheets-service-'));
});

vi.mock('server-only', () => ({}));
vi.mock('@/lib/config', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  OBJECT_STORE_BUCKET: undefined,
  LOCAL_UPLOAD_PATH: TEMP_STORE,
}));
vi.mock('@/lib/chat/run-micro-task.server', () => ({ runMicroTask: vi.fn() }));
vi.mock('@/lib/csv-processor', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  downloadSpreadsheetAsXlsx: vi.fn(),
}));

import { runMicroTask } from '@/lib/chat/run-micro-task.server';
import { downloadSpreadsheetAsXlsx } from '@/lib/csv-processor';
import { analyzeSpreadsheet, reviseSheetTransforms, confirmSheetImport } from '../service.server';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

const mockLlm = vi.mocked(runMicroTask);
const mockDownload = vi.mocked(downloadSpreadsheetAsXlsx);
const USER = { userId: 1, email: 'u@example.com', mode: 'org' } as unknown as EffectiveUser;
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/abc123DEF/edit';

function makeWorkbook(): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    [null, 'zone', 'revenue'],
    [null, 'North', 100],
    [null, 'South', '(250)'],
  ]), 'Zones');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

const GOOD_SQL = `
  SELECT B AS zone,
         TRY_CAST(replace(replace(replace(C, ',', ''), '(', '-'), ')', '') AS DOUBLE) AS revenue
  FROM raw.zones WHERE row_num >= 2
`;
const llmResponse = () => JSON.stringify({
  transforms: [{ output_table: 'zones_clean', source_tables: ['zones'], sql: GOOD_SQL, description: 'Cleans zones.' }],
});

describe('sheets-import service', () => {
  beforeEach(() => {
    mockLlm.mockReset();
    mockDownload.mockReset().mockResolvedValue(makeWorkbook());
  });

  afterAll(() => rmSync(TEMP_STORE, { recursive: true, force: true }));

  it('analyze: downloads the sheet, extracts raw grids, and returns validated transforms + previews', async () => {
    mockLlm.mockResolvedValueOnce(llmResponse());
    const result = await analyzeSpreadsheet({ spreadsheetUrl: SHEET_URL, connectionName: 'static', user: USER });

    expect(mockDownload).toHaveBeenCalledWith('abc123DEF');
    expect(result.spreadsheet_id).toBe('abc123DEF');
    expect(result.raw_files).toHaveLength(1);
    expect(result.raw_files[0].table_name).toBe('zones');
    expect(result.transforms).toHaveLength(1);
    expect(result.previews.zones_clean.row_count).toBe(2);
  });

  it('revise: re-runs the agent with previous transforms + feedback', async () => {
    mockLlm.mockResolvedValueOnce(llmResponse());
    const analyzed = await (async () => {
      mockLlm.mockReset().mockResolvedValueOnce(llmResponse());
      return analyzeSpreadsheet({ spreadsheetUrl: SHEET_URL, connectionName: 'static', user: USER });
    })();

    mockLlm.mockReset().mockResolvedValueOnce(llmResponse());
    const revised = await reviseSheetTransforms({
      rawFiles: analyzed.raw_files,
      transforms: analyzed.transforms,
      feedback: 'rename revenue to amount',
      connectionName: 'static',
      user: USER,
    });
    const vars = mockLlm.mock.calls[0][1] as Record<string, string>;
    expect(vars.feedback).toContain('rename revenue');
    expect(vars.previous_transforms).toContain('zones_clean');
    expect(revised.transforms).toHaveLength(1);
  });

  it('confirm: materializes accepted transforms into connection-ready files and cleans up raw grids', async () => {
    mockLlm.mockResolvedValueOnce(llmResponse());
    const analyzed = await analyzeSpreadsheet({ spreadsheetUrl: SHEET_URL, connectionName: 'static', user: USER });
    const rawKey = analyzed.raw_files[0].s3_key;
    expect(existsSync(join(TEMP_STORE, rawKey))).toBe(true);

    const files = await confirmSheetImport({
      spreadsheetUrl: SHEET_URL,
      rawFiles: analyzed.raw_files,
      transforms: analyzed.transforms,
      connectionName: 'static',
      user: USER,
    });

    expect(files).toHaveLength(1);
    expect(files[0].table_name).toBe('zones_clean');
    expect(files[0].row_count).toBe(2);
    // Connection-ready: source metadata + the transform itself ride on the file record,
    // so the resync handler can re-run the exact same cleaning.
    expect(files[0].source_type).toBe('google_sheets');
    expect(files[0].spreadsheet_id).toBe('abc123DEF');
    expect(files[0].transform?.sql).toContain('raw.zones');
    expect(existsSync(join(TEMP_STORE, files[0].s3_key))).toBe(true);
    // Raw grids are transient — cleaned up after materialization.
    expect(existsSync(join(TEMP_STORE, rawKey))).toBe(false);
  });

  it('rejects raw-file keys outside the connection prefix (no path smuggling through revise/confirm)', async () => {
    mockLlm.mockResolvedValue(llmResponse());
    const analyzed = await analyzeSpreadsheet({ spreadsheetUrl: SHEET_URL, connectionName: 'static', user: USER });
    const smuggled = [{ ...analyzed.raw_files[0], s3_key: 'csvs/org/OTHER_CONN/raw/x.parquet' }];
    await expect(confirmSheetImport({
      spreadsheetUrl: SHEET_URL, rawFiles: smuggled, transforms: analyzed.transforms,
      connectionName: 'static', user: USER,
    })).rejects.toThrow(/prefix/i);
  });
});
