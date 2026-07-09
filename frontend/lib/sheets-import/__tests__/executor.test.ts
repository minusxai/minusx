/**
 * Transform executor — runs agent-authored DuckDB SQL over the raw grids: previews (bounded,
 * for agent validation + the review UI) and materialization (Parquet + RegisteredFile, ready
 * to register on the static connection). Exercises the REAL cleaning pattern end-to-end: slice
 * an offset crosstab out of a grid, UNPIVOT the period columns, clean text-typed accounting
 * junk, TRY_CAST — the exact pipeline the agent writes for a sheet like the SUN Group P&L.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import * as XLSX from 'xlsx';

const TEMP_STORE = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { mkdtempSync } = require('fs') as typeof import('fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { tmpdir } = require('os') as typeof import('os');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join: j } = require('path') as typeof import('path');
  return mkdtempSync(j(tmpdir(), 'mx-sheets-exec-'));
});

vi.mock('server-only', () => ({}));
vi.mock('@/lib/config', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  OBJECT_STORE_BUCKET: undefined, // → isLocalObjectStore() = true
  LOCAL_UPLOAD_PATH: TEMP_STORE,
}));

import { extractRawGrids } from '../raw-grid';
import { previewTransform, materializeTransforms } from '../executor';
import type { RawGridFile, SheetTransform } from '../types';

function makePnlWorkbook(): Buffer {
  const aoa: unknown[][] = [
    [],
    [],
    [null, 'SUN Group - Consolidated P&L'],
    [null, "USD '000", 'YTD May-25', 'YTD May-26', 'YTD Budget May-26'],
    [null, 'Revenue', 13048, 17295, 16434],
    [null, 'COGS', -4553, -7030, -6318],
    [null, 'Interest exp', '-', '(1,234)', null],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'L1 Consol');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

// The kind of SQL the agent writes: slice B5:E7, unpivot periods, clean values.
const MELT_SQL = `
  WITH src AS (
    SELECT B AS line_item, C AS "ytd_may_25", D AS "ytd_may_26", E AS "ytd_budget_may_26"
    FROM raw.l1_consol
    WHERE row_num BETWEEN 5 AND 7
  ),
  long AS (
    UNPIVOT src ON "ytd_may_25", "ytd_may_26", "ytd_budget_may_26" INTO NAME period VALUE raw_value
  )
  SELECT
    line_item,
    period,
    TRY_CAST(replace(replace(replace(raw_value, ',', ''), '(', '-'), ')', '') AS DOUBLE) AS value
  FROM long
`;

describe('sheets-import executor', () => {
  let grids: RawGridFile[];

  beforeAll(async () => {
    grids = await extractRawGrids(makePnlWorkbook(), 'static', 'org');
  });

  afterAll(() => rmSync(TEMP_STORE, { recursive: true, force: true }));

  const transform = (): SheetTransform => ({
    output_table: 'pnl_long',
    schema_name: 'public',
    source_tables: ['l1_consol'],
    sql: MELT_SQL,
    description: 'Unpivots the P&L crosstab (B5:E7) into line_item/period/value.',
  });

  it('previews a melt transform with cleaned, typed values', async () => {
    const preview = await previewTransform(grids, transform(), 50);
    expect(preview.columns.map(c => c.name)).toEqual(['line_item', 'period', 'value']);
    expect(preview.columns[2].type).toBe('DOUBLE');
    // 3 line items × 3 periods, minus the one NULL cell UNPIVOT drops
    expect(preview.row_count).toBe(8);

    const byKey = new Map(preview.rows.map(r => [`${r.line_item}|${r.period}`, r.value]));
    expect(byKey.get('Revenue|ytd_may_25')).toBe(13048);
    expect(byKey.get('COGS|ytd_may_25')).toBe(-4553);          // underlying negative
    expect(byKey.get('Interest exp|ytd_may_26')).toBe(-1234);  // text "(1,234)" cleaned by SQL
    expect(byKey.get('Interest exp|ytd_may_25')).toBeNull();   // "-" → TRY_CAST → NULL
  });

  it('bounds the preview rows but reports the full row count', async () => {
    const preview = await previewTransform(grids, transform(), 3);
    expect(preview.rows.length).toBe(3);
    expect(preview.row_count).toBe(8);
  });

  it('surfaces SQL errors as thrown errors (agent self-repair loop input)', async () => {
    await expect(previewTransform(grids, { ...transform(), sql: 'SELECT nope FROM raw.l1_consol' }, 10))
      .rejects.toThrow(/nope/i);
  });

  it('materializes transforms to Parquet and returns RegisteredFile metadata', async () => {
    const files = await materializeTransforms('org', 'static', grids, [transform()]);
    expect(files).toHaveLength(1);
    expect(files[0].table_name).toBe('pnl_long');
    expect(files[0].schema_name).toBe('public');
    expect(files[0].file_format).toBe('parquet');
    expect(files[0].row_count).toBe(8);
    expect(files[0].columns.map(c => c.name)).toEqual(['line_item', 'period', 'value']);
    expect(existsSync(join(TEMP_STORE, files[0].s3_key))).toBe(true);
  });

  it('materialization is atomic — a failing transform cleans up already-written outputs', async () => {
    const bad: SheetTransform = { ...transform(), output_table: 'boom', sql: 'SELECT nope FROM raw.l1_consol' };
    await expect(materializeTransforms('org', 'static', grids, [transform(), bad])).rejects.toThrow();
    // No orphaned parquet beyond the one from the previous (successful) test call
    const { readdirSync } = await import('fs');
    const dir = join(TEMP_STORE, 'csvs/org/static');
    const parquets = readdirSync(dir).filter(f => f.endsWith('.parquet'));
    expect(parquets.length).toBe(1);
  });
});
