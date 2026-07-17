import { describe, expect, it } from 'vitest';
import type { SpreadsheetSource } from '@/lib/types';
import {
  MAX_SPREADSHEET_COLUMNS,
  MAX_SPREADSHEET_ROWS,
  getSpreadsheetExecution,
  runSpreadsheetSource,
} from '../materialize';

const source = (overrides: Partial<SpreadsheetSource> = {}): SpreadsheetSource => ({
  version: 1,
  columns: [
    { name: 'name', type: 'auto' },
    { name: 'amount', type: 'auto' },
    { name: 'active', type: 'auto' },
    { name: 'day', type: 'auto' },
  ],
  rows: [
    ['Ada', '12.5', 'true', '2026-07-15'],
    ['Lin', null, 'false', '2026-07-16'],
  ],
  ...overrides,
});

describe('runSpreadsheetSource', () => {
  it('normalizes rows and infers/coerces values into QueryResult', () => {
    const result = runSpreadsheetSource(source({ rows: [['Ada', '12.5', 'true', '2026-07-15'], ['Lin']] }));
    expect(result).toEqual({
      ok: true,
      data: {
        columns: ['name', 'amount', 'active', 'day'],
        types: ['VARCHAR', 'DOUBLE', 'BOOLEAN', 'DATE'],
        rows: [
          { name: 'Ada', amount: 12.5, active: true, day: '2026-07-15' },
          { name: 'Lin', amount: null, active: null, day: null },
        ],
        finalQuery: expect.stringMatching(/^spreadsheet:/),
        id: expect.any(String),
      },
    });
  });

  it('honors explicit type overrides and reports every coercion error', () => {
    const result = runSpreadsheetSource(source({
      columns: [
        { name: 'number', type: 'number' },
        { name: 'boolean', type: 'boolean' },
        { name: 'date', type: 'date' },
        { name: 'text', type: 'text' },
      ],
      rows: [['nope', 'yes', '31/31/2026', '12']],
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map(error => error.code)).toEqual([
        'invalid_number', 'invalid_boolean', 'invalid_date',
      ]);
      expect(result.errors.map(error => [error.row, error.column])).toEqual([[1, 0], [1, 1], [1, 2]]);
    }
  });

  it('rejects empty and duplicate headers', () => {
    const result = runSpreadsheetSource(source({
      columns: [
        { name: ' ', type: 'auto' },
        { name: 'Name', type: 'auto' },
        { name: 'name', type: 'auto' },
      ],
      rows: [],
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.map(error => error.code)).toEqual(['empty_header', 'duplicate_header', 'duplicate_header']);
  });

  it('enforces row and column limits atomically', () => {
    const tooManyRows = source({ rows: Array.from({ length: MAX_SPREADSHEET_ROWS + 1 }, () => []) });
    const tooManyColumns = source({
      columns: Array.from({ length: MAX_SPREADSHEET_COLUMNS + 1 }, (_, i) => ({ name: `c${i}`, type: 'auto' as const })),
      rows: [],
    });
    expect(runSpreadsheetSource(tooManyRows)).toMatchObject({ ok: false, errors: [{ code: 'row_limit' }] });
    expect(runSpreadsheetSource(tooManyColumns)).toMatchObject({ ok: false, errors: [{ code: 'column_limit' }] });
  });

  it('accepts caller-specific limits for reusable spreadsheet surfaces', () => {
    const result = runSpreadsheetSource(source({
      columns: [{ name: 'a', type: 'auto' }, { name: 'b', type: 'auto' }],
      rows: [['1', '2'], ['3', '4']],
    }), { maxRows: 1, maxColumns: 1 });
    expect(result).toMatchObject({
      ok: false,
      errors: [{ code: 'row_limit' }, { code: 'column_limit' }],
    });
  });

  it('rejects row cells outside the declared columns rather than dropping data', () => {
    const result = runSpreadsheetSource(source({
      columns: [{ name: 'only', type: 'auto' }],
      rows: [['kept', 'would be lost']],
    }));
    expect(result).toMatchObject({ ok: false, errors: [{ code: 'row_width', row: 1, column: 1 }] });
  });

  it('uses stable, content-addressed execution identities', () => {
    const a = getSpreadsheetExecution(source());
    const b = getSpreadsheetExecution(JSON.parse(JSON.stringify(source())));
    const changed = getSpreadsheetExecution(source({ rows: [['different']] }));
    expect(a).toEqual(b);
    expect(a.query).toMatch(/^spreadsheet:/);
    expect(a.id).not.toBe(changed.id);
  });
});
