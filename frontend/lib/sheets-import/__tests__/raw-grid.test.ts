/**
 * Raw-grid extraction — every sheet tab becomes an untyped positional grid the agent can query
 * like the spreadsheet itself: columns `A`, `B`, … plus 1-based `row_num`, values as canonical
 * strings taken from the UNDERLYING cell values (an accounting-formatted -4553 arrives as
 * "-4553", a percent-formatted 5% as "0.05", a date header as ISO) — so most cleaning reduces
 * to TRY_CAST, and only genuinely text-typed junk ("(4,553)" typed as text) needs SQL cleaning.
 *
 * Real XLSX + real DuckDB + a temp local object store — no mocks of the things under test.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { rmSync } from 'fs';
import { join } from 'path';
import * as XLSX from 'xlsx';
import { DuckDBInstance } from '@duckdb/node-api';

const TEMP_STORE = vi.hoisted(() => {
  const { mkdtempSync } = require('fs') as typeof import('fs');
  const { tmpdir } = require('os') as typeof import('os');
  const { join: j } = require('path') as typeof import('path');
  return mkdtempSync(j(tmpdir(), 'mx-sheets-import-'));
});

vi.mock('server-only', () => ({}));
vi.mock('@/lib/config', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  OBJECT_STORE_BUCKET: undefined, // → isLocalObjectStore() = true
  LOCAL_UPLOAD_PATH: TEMP_STORE,
}));

import { extractRawGrids } from '../raw-grid';

// ── Fixture: a workbook mirroring the real-world P&L crosstab ────────────────────────────────
// Offset table (starts at B3), title banner, stacked-ish headers, underlying-negative numbers
// displayed in accounting format, percent-formatted ratios, text dashes, text-typed "(1,234)",
// a second clean tab, and an empty tab.
function makePnlWorkbook(): Buffer {
  const aoa: unknown[][] = [
    [],
    [],
    [null, 'SUN Group - Consolidated P&L'],
    [null, "USD '000", 'YTD May-25', 'YTD May-26', 'YTD Budget May-26', 'Budget FY26'],
    [null, 'Revenue', 13048, 17295, 16434, 47657],
    [null, 'COGS', -4553, -7030, -6318, -15944],
    [null, 'Gross Profit Margin', 0.33, 0.29, 0.3, 0.29],
    [null, 'Interest exp', '-', '(1,234)', null, '-'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Accounting/percent formats on the numeric cells — must NOT affect the extracted value.
  for (const addr of ['C6', 'D6', 'E6', 'F6']) if (ws[addr]) ws[addr].z = '#,##0;(#,##0)';
  for (const addr of ['C7', 'D7', 'E7', 'F7']) if (ws[addr]) ws[addr].z = '0%';

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'L1 Consol');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['zone', 'revenue'],
    ['North', 100],
    ['South', 250],
  ]), 'Zones');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), 'Empty Tab');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

async function queryGrid(s3Key: string, sql: (view: string) => string): Promise<Array<Record<string, unknown>>> {
  const instance = await DuckDBInstance.create(':memory:');
  const conn = await instance.connect();
  try {
    await conn.run(`CREATE VIEW g AS SELECT * FROM read_parquet('${join(TEMP_STORE, s3Key)}')`);
    const res = await conn.run(sql('g'));
    return await res.getRowObjectsJS() as Array<Record<string, unknown>>;
  } finally {
    conn.closeSync();
    instance.closeSync();
  }
}

describe('extractRawGrids', () => {
  let grids: Awaited<ReturnType<typeof extractRawGrids>>;

  beforeAll(async () => {
    grids = await extractRawGrids(makePnlWorkbook(), 'static', 'org');
  });

  afterAll(() => rmSync(TEMP_STORE, { recursive: true, force: true }));

  it('produces one grid per non-empty tab, with sheet-like table names', () => {
    expect(grids.map(g => g.table_name)).toEqual(['l1_consol', 'zones']);
    expect(grids[0].tab_name).toBe('L1 Consol');
  });

  it('names columns like the spreadsheet (A, B, …) with a 1-based row_num', async () => {
    const rows = await queryGrid(grids[0].s3_key, v => `DESCRIBE ${v}`);
    const names = rows.map(r => r.column_name);
    expect(names[0]).toBe('row_num');
    expect(names.slice(1)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    expect(rows[0].column_type).toContain('INT');    // row_num is numeric
    expect(rows[1].column_type).toBe('VARCHAR');     // cells are untyped text
  });

  it('preserves cell positions — the title banner sits at row 3 column B', async () => {
    const rows = await queryGrid(grids[0].s3_key, v => `SELECT B FROM ${v} WHERE row_num = 3`);
    expect(rows[0].B).toBe('SUN Group - Consolidated P&L');
    // rows 1-2 exist and are empty, so row numbers line up with the sheet the user sees
    const empty = await queryGrid(grids[0].s3_key, v => `SELECT count(*)::INT AS c FROM ${v} WHERE row_num <= 2 AND B IS NULL`);
    expect(empty[0].c).toBe(2);
  });

  it('extracts UNDERLYING values: accounting negatives and percents arrive as clean numbers', async () => {
    const rows = await queryGrid(grids[0].s3_key, v => `SELECT C, D FROM ${v} WHERE row_num IN (6, 7) ORDER BY row_num`);
    expect(rows[0].C).toBe('-4553');   // displayed "(4,553)" — underlying value wins
    expect(rows[1].C).toBe('0.33');    // displayed "33%" — underlying fraction wins
  });

  it('keeps text-typed junk verbatim for the SQL cleaning stage', async () => {
    const rows = await queryGrid(grids[0].s3_key, v => `SELECT C, D, E FROM ${v} WHERE row_num = 8`);
    expect(rows[0].C).toBe('-');        // text dash stays a dash
    expect(rows[0].D).toBe('(1,234)');  // text-typed accounting number stays for regex cleaning
    expect(rows[0].E).toBeNull();       // empty cell is NULL
  });

  it('records grid dimensions', () => {
    expect(grids[0].n_rows).toBe(8);
    expect(grids[0].n_cols).toBe(6);
    expect(grids[1].n_rows).toBe(3);
    expect(grids[1].n_cols).toBe(2);
  });
});
