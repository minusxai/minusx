/**
 * Post-import adjustment — "Adjust with agent" on an already-imported spreadsheet group:
 *  - prepare: re-download the live sheet, re-extract raw grids, and preview the STORED
 *    transforms against fresh data (no LLM). Transforms the live sheet broke go to `dropped`
 *    with their error so the user sees exactly what no longer runs.
 *  - discard: delete transient raw grids when the user cancels the wizard (prefix-guarded).
 * The download is mocked; grids, SQL execution, and storage are real.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import * as XLSX from 'xlsx';

const TEMP_STORE = vi.hoisted(() => {
  const { mkdtempSync } = require('fs') as typeof import('fs');
  const { tmpdir } = require('os') as typeof import('os');
  const { join: j } = require('path') as typeof import('path');
  return mkdtempSync(j(tmpdir(), 'mx-sheets-adjust-'));
});

vi.mock('server-only', () => ({}));
vi.mock('@/lib/config', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  OBJECT_STORE_BUCKET: undefined,
  LOCAL_UPLOAD_PATH: TEMP_STORE,
}));
vi.mock('@/lib/csv-processor', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  downloadSpreadsheetAsXlsx: vi.fn(),
}));

import { downloadSpreadsheetAsXlsx } from '@/lib/csv-processor';
import { prepareSheetAdjustment, discardRawGrids } from '../service.server';
import type { SheetTransform } from '../types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

const mockDownload = vi.mocked(downloadSpreadsheetAsXlsx);
const USER = { userId: 1, email: 'u@example.com', mode: 'org' } as unknown as EffectiveUser;
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/abc123DEF/edit';

function makeWorkbook(): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    [null, 'zone', 'revenue'],
    [null, 'North', 100],
    [null, 'South', '(250)'],
    [null, 'East', 75],
  ]), 'Zones');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

const storedTransform = (over: Partial<SheetTransform> = {}): SheetTransform => ({
  output_table: 'zones_clean',
  schema_name: 'finance',
  source_tables: ['zones'],
  sql: `SELECT B AS zone,
               TRY_CAST(replace(replace(replace(C, ',', ''), '(', '-'), ')', '') AS DOUBLE) AS revenue
        FROM raw.zones WHERE row_num >= 2`,
  description: 'Cleans zones.',
  ...over,
});

describe('prepareSheetAdjustment', () => {
  beforeEach(() => {
    mockDownload.mockReset().mockResolvedValue(makeWorkbook());
  });

  afterAll(() => rmSync(TEMP_STORE, { recursive: true, force: true }));

  it('re-extracts raw grids from the live sheet and previews the STORED transforms without an LLM call', async () => {
    const result = await prepareSheetAdjustment({
      spreadsheetUrl: SHEET_URL,
      transforms: [storedTransform()],
      connectionName: 'static',
      user: USER,
    });

    expect(mockDownload).toHaveBeenCalledWith('abc123DEF');
    expect(result.spreadsheet_id).toBe('abc123DEF');
    expect(result.raw_files).toHaveLength(1);
    expect(result.transforms).toHaveLength(1);
    expect(result.transforms[0].schema_name).toBe('finance'); // stored transform passed through untouched
    // Preview reflects the LIVE sheet (3 data rows now).
    expect(result.previews.zones_clean.row_count).toBe(3);
    expect(result.dropped).toHaveLength(0);
  });

  it('moves transforms the live sheet broke into dropped (with the error), keeping the working ones', async () => {
    const broken = storedTransform({ output_table: 'gone', sql: 'SELECT Z FROM raw.no_such_table' });
    const result = await prepareSheetAdjustment({
      spreadsheetUrl: SHEET_URL,
      transforms: [storedTransform(), broken],
      connectionName: 'static',
      user: USER,
    });

    expect(result.transforms.map((t) => t.output_table)).toEqual(['zones_clean']);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0]).toContain('gone');
  });
});

describe('discardRawGrids', () => {
  beforeEach(() => {
    mockDownload.mockReset().mockResolvedValue(makeWorkbook());
  });

  it('deletes raw grids under the connection prefix', async () => {
    const prepared = await prepareSheetAdjustment({
      spreadsheetUrl: SHEET_URL, transforms: [storedTransform()], connectionName: 'static', user: USER,
    });
    const rawKey = prepared.raw_files[0].s3_key;
    expect(existsSync(join(TEMP_STORE, rawKey))).toBe(true);

    await discardRawGrids({ rawFiles: prepared.raw_files, connectionName: 'static', user: USER });
    expect(existsSync(join(TEMP_STORE, rawKey))).toBe(false);
  });

  it('refuses keys outside the connection prefix', async () => {
    await expect(discardRawGrids({
      rawFiles: [{ tab_name: 'x', table_name: 'x', s3_key: 'csvs/org/OTHER/raw/x.parquet', n_rows: 1, n_cols: 1 }],
      connectionName: 'static',
      user: USER,
    })).rejects.toThrow(/prefix/i);
  });
});
