import { describe, it, expect } from 'vitest';
import { aggregatePivotData } from '../pivot-utils';
import type { PivotConfig } from '@/lib/validation/atlas-schemas';

// A pivot question saved with a malformed pivotConfig (missing the `columns` array)
// crashed prod: `aggregatePivotData` did `config.columns.map(...)` on undefined
// → "Cannot read properties of undefined (reading 'map')" (pivot-utils.ts:57).
// The schema requires rows/columns/values arrays, but legacy / LLM-generated content
// can omit them, so the aggregator must tolerate missing array fields.

const rows = [
  { region: 'NA', product: 'A', amount: 10 },
  { region: 'NA', product: 'B', amount: 5 },
  { region: 'EU', product: 'A', amount: 7 },
];

describe('aggregatePivotData — tolerates malformed configs', () => {
  it('does not throw when `columns` is missing (the prod crash) and still aggregates', () => {
    const config = { rows: ['region'], values: [{ column: 'amount', aggFunction: 'SUM' }] } as unknown as PivotConfig;
    expect(() => aggregatePivotData(rows, config)).not.toThrow();
    const data = aggregatePivotData(rows, config);
    expect(data.cells.length).toBeGreaterThan(0);
  });

  it('does not throw when `rows` is missing', () => {
    const config = { columns: ['product'], values: [{ column: 'amount', aggFunction: 'SUM' }] } as unknown as PivotConfig;
    expect(() => aggregatePivotData(rows, config)).not.toThrow();
  });

  it('returns empty when `values` is missing (no measures to aggregate)', () => {
    const config = { rows: ['region'], columns: [] } as unknown as PivotConfig;
    const data = aggregatePivotData(rows, config);
    expect(data.cells).toEqual([]);
  });
});
