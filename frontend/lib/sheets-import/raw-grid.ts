import 'server-only';

/**
 * Raw-grid extraction — stage 1 of the agentic Sheets import (see types.ts).
 *
 * Each non-empty sheet tab becomes an untyped positional grid stored as Parquet:
 *  - columns named like the spreadsheet (`A`, `B`, … `AA`, …) plus a 1-based `row_num`,
 *    so the agent addresses cells exactly like the sheet the user is looking at;
 *  - values are canonical strings from the UNDERLYING cell values, not the display text —
 *    an accounting-formatted `-4553` shown as "(4,553)" arrives as "-4553", a percent cell
 *    shown as "33%" arrives as "0.33", date cells arrive as ISO. Only genuinely text-typed
 *    junk ("(1,234)" typed as text) reaches the SQL cleaning stage verbatim;
 *  - blank rows/columns INSIDE the used range are preserved (positions must line up with
 *    the sheet); trailing emptiness is trimmed.
 */

import { randomUUID } from 'crypto';
import { writeFileSync, readFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DuckDBInstance } from '@duckdb/node-api';
import * as XLSX from 'xlsx';
import { createObjectStore } from '@/lib/object-store';
import { sanitizeTableName, ensureUniqueTableNames } from '@/lib/csv-utils';
import type { RawGridFile } from './types';

/** 0-based column index → spreadsheet letters (0 → A, 25 → Z, 26 → AA …). */
export function columnLetter(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** Canonical string for one cell's UNDERLYING value (null for empty/error cells). */
function canonicalCellValue(cell: XLSX.CellObject | undefined): string | null {
  if (!cell || cell.v === undefined || cell.v === null) return null;
  switch (cell.t) {
    case 'n': return String(cell.v);
    case 'b': return cell.v ? 'true' : 'false';
    case 'd': {
      const d = cell.v as Date;
      const iso = d.toISOString();
      return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso;
    }
    case 'e': return null; // error cells (#REF! etc.) carry no usable value
    default:  return String(cell.v);
  }
}

export interface RawGrid {
  /** rows[r][c] = canonical value of sheet row r+1, column c (0-based → letter). */
  rows: Array<Array<string | null>>;
  n_rows: number;
  n_cols: number;
}

/**
 * Pure: worksheet → positional grid of canonical cell strings. Returns null for an
 * effectively empty sheet. Rows are 1-aligned with the sheet (index 0 = sheet row 1),
 * including any blank leading/interior rows; trailing empty rows/columns are trimmed.
 */
export function worksheetToRawGrid(ws: XLSX.WorkSheet): RawGrid | null {
  const ref = ws['!ref'];
  if (!ref) return null;
  const range = XLSX.utils.decode_range(ref);

  // Find the last row/column that actually holds a value (the declared range can overshoot).
  let lastRow = -1;
  let lastCol = -1;
  for (let r = 0; r <= range.e.r; r++) {
    for (let c = 0; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
      if (canonicalCellValue(cell) !== null) {
        if (r > lastRow) lastRow = r;
        if (c > lastCol) lastCol = c;
      }
    }
  }
  if (lastRow < 0 || lastCol < 0) return null;

  const rows: Array<Array<string | null>> = [];
  for (let r = 0; r <= lastRow; r++) {
    const row: Array<string | null> = [];
    for (let c = 0; c <= lastCol; c++) {
      row.push(canonicalCellValue(ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined));
    }
    rows.push(row);
  }
  return { rows, n_rows: lastRow + 1, n_cols: lastCol + 1 };
}

function csvCell(value: string | null): string {
  if (value === null) return '';
  // Quote everything non-empty: values are arbitrary user text (commas, quotes, newlines).
  return `"${value.replace(/"/g, '""')}"`;
}

/** Grid → CSV with a `row_num` column and spreadsheet-letter headers. */
export function rawGridToCsv(grid: RawGrid): string {
  const header = ['row_num', ...Array.from({ length: grid.n_cols }, (_, c) => columnLetter(c))];
  const lines = [header.join(',')];
  grid.rows.forEach((row, i) => {
    lines.push([String(i + 1), ...row.map(csvCell)].join(','));
  });
  return lines.join('\n');
}

/**
 * Parse xlsx bytes and store one raw-grid Parquet per non-empty tab under
 * `csvs/<mode>/<connectionName>/raw/`. Table names are sanitized tab names, uniquified.
 * `createdKeys` (caller-owned) receives every stored key for cleanup on failure.
 */
export async function extractRawGrids(
  xlsxBuffer: Buffer,
  connectionName: string,
  mode: string,
  createdKeys: string[] = [],
): Promise<RawGridFile[]> {
  const store = createObjectStore();
  const workbook = XLSX.read(xlsxBuffer, { type: 'buffer', cellDates: true });

  const tabs: Array<{ tab_name: string; grid: RawGrid }> = [];
  for (const tabName of workbook.SheetNames) {
    const grid = worksheetToRawGrid(workbook.Sheets[tabName]);
    if (grid) tabs.push({ tab_name: tabName, grid });
  }
  if (tabs.length === 0) throw new Error('No non-empty sheets found in the spreadsheet');

  const tableNames = ensureUniqueTableNames(tabs.map(t => t.tab_name));

  const instance = await DuckDBInstance.create(':memory:');
  const conn = await instance.connect();
  const results: RawGridFile[] = [];
  try {
    for (const { tab_name, grid } of tabs) {
      const uuid = randomUUID();
      const tmpCsvPath = join(tmpdir(), `${uuid}.csv`);
      const tmpParquetPath = join(tmpdir(), `${uuid}.parquet`);
      const storageKey = `csvs/${mode}/${connectionName}/raw/${uuid}.parquet`;
      try {
        writeFileSync(tmpCsvPath, rawGridToCsv(grid), 'utf-8');
        // all_varchar keeps every cell untyped text; row_num is cast back to a real integer.
        await conn.run(
          `COPY (
             SELECT CAST(row_num AS INTEGER) AS row_num, * EXCLUDE (row_num)
             FROM read_csv('${tmpCsvPath}', header = true, all_varchar = true)
           ) TO '${tmpParquetPath}' (FORMAT PARQUET, COMPRESSION ZSTD)`,
        );
        await store.put(storageKey, readFileSync(tmpParquetPath), 'application/octet-stream');
        createdKeys.push(storageKey);
        results.push({
          tab_name,
          table_name: tableNames.get(tab_name) ?? sanitizeTableName(tab_name),
          s3_key: storageKey,
          n_rows: grid.n_rows,
          n_cols: grid.n_cols,
        });
      } finally {
        try { unlinkSync(tmpCsvPath); } catch { /* ignore */ }
        try { unlinkSync(tmpParquetPath); } catch { /* ignore */ }
      }
    }
  } finally {
    conn.closeSync();
    instance.closeSync();
  }
  return results;
}
