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

describe('aggregatePivotData — numeric dimension ordering', () => {
  // Regression: numeric column/row values were sorted lexicographically
  // ("10" < "3"), so ISO-week columns came out 10,11,…,3,4. They must sort
  // numerically when the dimension values are numbers.
  const weekRows = [
    { day: 1, week: 3, n: 1 },
    { day: 1, week: 10, n: 1 },
    { day: 1, week: 2, n: 1 },
    { day: 1, week: 21, n: 1 },
  ];

  it('sorts numeric column headers numerically, not as strings', () => {
    const config = { rows: ['day'], columns: ['week'], values: [{ column: 'n', aggFunction: 'SUM' }] } as unknown as PivotConfig;
    const data = aggregatePivotData(weekRows, config);
    expect(data.columnHeaders.map(h => h[0])).toEqual(['2', '3', '10', '21']);
  });

  it('sorts non-numeric dimensions lexicographically', () => {
    const data = aggregatePivotData(rows, { rows: ['region'], columns: ['product'], values: [{ column: 'amount', aggFunction: 'SUM' }] } as unknown as PivotConfig);
    expect(data.columnHeaders.map(h => h[0])).toEqual(['A', 'B']);
  });
});

describe('aggregatePivotData — cellPresent distinguishes missing from 0', () => {
  // A sparse pivot: NA has both products, EU only has A. The EU×B cell has no
  // source row → must be marked absent (N/A), not a real aggregated 0.
  const config = { rows: ['region'], columns: ['product'], values: [{ column: 'amount', aggFunction: 'SUM' }] } as unknown as PivotConfig;

  it('marks intersections with no source rows as not present', () => {
    const data = aggregatePivotData(rows, config);
    const euIdx = data.rowHeaders.findIndex(h => h[0] === 'EU');
    const colA = data.columnHeaders.findIndex(h => h[0] === 'A');
    const colB = data.columnHeaders.findIndex(h => h[0] === 'B');
    expect(data.cellPresent[euIdx][colA]).toBe(true);   // EU×A has data
    expect(data.cellPresent[euIdx][colB]).toBe(false);  // EU×B is N/A
    expect(data.cells[euIdx][colB]).toBe(0);            // …but the numeric value is still 0
  });

  it('marks a genuine aggregated 0 as present (distinct from N/A)', () => {
    const zeroRows = [{ region: 'NA', product: 'A', amount: 0 }];
    const data = aggregatePivotData(zeroRows, config);
    expect(data.cells[0][0]).toBe(0);
    expect(data.cellPresent[0][0]).toBe(true); // real 0 → present
  });
});
