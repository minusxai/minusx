/**
 * Transform-authoring agent loop: samples the raw grids into the prompt, asks the LLM for a
 * transforms JSON, VALIDATES every SQL by actually executing a preview, and feeds failures
 * back for bounded self-repair. The LLM is faked; DuckDB validation is real — a transform the
 * loop returns has provably run.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { rmSync } from 'fs';
import * as XLSX from 'xlsx';

const TEMP_STORE = vi.hoisted(() => {
  const { mkdtempSync } = require('fs') as typeof import('fs');
  const { tmpdir } = require('os') as typeof import('os');
  const { join: j } = require('path') as typeof import('path');
  return mkdtempSync(j(tmpdir(), 'mx-sheets-analyst-'));
});

vi.mock('server-only', () => ({}));
vi.mock('@/lib/config', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  OBJECT_STORE_BUCKET: undefined,
  LOCAL_UPLOAD_PATH: TEMP_STORE,
}));
vi.mock('@/lib/chat/run-micro-task.server', () => ({ runMicroTask: vi.fn() }));

import { runMicroTask } from '@/lib/chat/run-micro-task.server';
import { renderPrompt } from '@/orchestrator/prompts';
import { extractRawGrids } from '../raw-grid';
import { authorSheetTransforms } from '../analyst.server';
import type { RawGridFile } from '../types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

const mockLlm = vi.mocked(runMicroTask);
const USER = { userId: 1, email: 'u@example.com', mode: 'org' } as unknown as EffectiveUser;

function makeWorkbook(): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    [],
    [null, 'Zones report'],
    [null, 'zone', 'revenue'],
    [null, 'North', 100],
    [null, 'South', '(250)'],
  ]), 'Zones');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

const GOOD_SQL = `
  SELECT B AS zone,
         TRY_CAST(replace(replace(replace(C, ',', ''), '(', '-'), ')', '') AS DOUBLE) AS revenue
  FROM raw.zones WHERE row_num >= 4
`;

const goodResponse = (sql = GOOD_SQL) => JSON.stringify({
  transforms: [{
    output_table: 'zones_clean',
    source_tables: ['zones'],
    sql,
    description: 'Slices the zones table (rows 4+) and cleans accounting-format revenue.',
  }],
});

describe('authorSheetTransforms', () => {
  let grids: RawGridFile[];

  beforeAll(async () => {
    grids = await extractRawGrids(makeWorkbook(), 'static', 'org');
  });

  afterAll(() => rmSync(TEMP_STORE, { recursive: true, force: true }));
  beforeEach(() => mockLlm.mockReset());

  it('returns validated transforms with real previews', async () => {
    mockLlm.mockResolvedValueOnce(goodResponse());
    const result = await authorSheetTransforms({ rawFiles: grids, user: USER });

    expect(mockLlm).toHaveBeenCalledTimes(1);
    // The prompt carries a positional sample of every grid.
    const vars = mockLlm.mock.calls[0][1] as Record<string, string>;
    expect(vars.grids).toContain('zones');
    expect(vars.grids).toContain('Zones report'); // actual cell content sampled

    expect(result.transforms).toHaveLength(1);
    expect(result.transforms[0].output_table).toBe('zones_clean');
    expect(result.transforms[0].schema_name).toBe('public'); // defaulted
    const preview = result.previews.zones_clean;
    expect(preview.row_count).toBe(2);
    expect(preview.rows.find(r => r.zone === 'South')?.revenue).toBe(-250); // cleaning ran for real
  });

  it('parses a response wrapped in markdown fences/prose', async () => {
    mockLlm.mockResolvedValueOnce('Here you go:\n```json\n' + goodResponse() + '\n```\nDone.');
    const result = await authorSheetTransforms({ rawFiles: grids, user: USER });
    expect(result.transforms).toHaveLength(1);
  });

  it('self-repairs: a failing SQL is fed back with its error and the fix is accepted', async () => {
    mockLlm
      .mockResolvedValueOnce(goodResponse('SELECT nope FROM raw.zones'))
      .mockResolvedValueOnce(goodResponse());
    const result = await authorSheetTransforms({ rawFiles: grids, user: USER });

    expect(mockLlm).toHaveBeenCalledTimes(2);
    const retryVars = mockLlm.mock.calls[1][1] as Record<string, string>;
    expect(retryVars.errors).toMatch(/zones_clean/);
    expect(retryVars.errors).toMatch(/nope/i);
    expect(result.transforms).toHaveLength(1);
    expect(result.previews.zones_clean.row_count).toBe(2);
  });

  it('gives up after bounded attempts when nothing validates', async () => {
    mockLlm.mockResolvedValue(goodResponse('SELECT nope FROM raw.zones'));
    await expect(authorSheetTransforms({ rawFiles: grids, user: USER, maxAttempts: 2 }))
      .rejects.toThrow(/valid/i);
    expect(mockLlm).toHaveBeenCalledTimes(2);
  });

  it('the micro.sheets_import prompt templates render (brace escaping is easy to break)', () => {
    const system = renderPrompt('micro.sheets_import.system', {});
    expect(system).toContain('UNPIVOT');
    expect(system).toContain('"transforms"'); // the literal JSON shape survived {{ }} escaping
    const user = renderPrompt('micro.sheets_import.user', {
      grids: 'G', previous_transforms: '', feedback: '', errors: '',
    });
    expect(user).toContain('RAW GRIDS');
    expect(user).toContain('G');
  });

  it('passes revision context (previous transforms + user feedback) into the prompt', async () => {
    mockLlm.mockResolvedValueOnce(goodResponse());
    const previous = [{
      output_table: 'zones_clean', schema_name: 'public', source_tables: ['zones'],
      sql: GOOD_SQL, description: 'v1',
    }];
    await authorSheetTransforms({
      rawFiles: grids, user: USER,
      previousTransforms: previous,
      feedback: 'Please rename the value column to amount',
    });
    const vars = mockLlm.mock.calls[0][1] as Record<string, string>;
    expect(vars.previous_transforms).toContain('zones_clean');
    expect(vars.feedback).toContain('rename the value column');
  });
});
