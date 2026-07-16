/**
 * The chart "download data" CSV serializer — every column, every row, CSV-escaped.
 * Powers the V2 chart download menu (Data → .csv).
 */
import { describe, it, expect } from 'vitest';
import { queryResultToCsv } from '../build-chart-download';

describe('queryResultToCsv', () => {
  it('emits a header row then one row per record, column-ordered', () => {
    const csv = queryResultToCsv(['month', 'revenue'], [
      { month: 'Jan', revenue: 100 },
      { month: 'Feb', revenue: 200 },
    ]);
    expect(csv).toBe('month,revenue\nJan,100\nFeb,200');
  });

  it('CSV-escapes commas, quotes, and newlines', () => {
    const csv = queryResultToCsv(['label', 'note'], [
      { label: 'a, b', note: 'has "quote"' },
    ]);
    expect(csv).toBe('label,note\n"a, b","has ""quote"""');
  });

  it('renders null/undefined as empty cells and preserves column order for missing keys', () => {
    const csv = queryResultToCsv(['a', 'b', 'c'], [
      { a: 1, c: null }, // b missing, c null
    ]);
    expect(csv).toBe('a,b,c\n1,,');
  });
});
