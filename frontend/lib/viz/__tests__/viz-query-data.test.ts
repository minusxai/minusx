import { describe, it, expect } from 'vitest';
import { toVizColumns, sqlTypeToVizKind } from '@/lib/viz/query-data';

describe('sqlTypeToVizKind', () => {
  it('maps numeric SQL types to quantitative', () => {
    for (const t of ['INTEGER', 'BIGINT', 'DOUBLE', 'DECIMAL(10,2)', 'FLOAT', 'number', 'NUMERIC', 'REAL']) {
      expect(sqlTypeToVizKind(t)).toBe('quantitative');
    }
  });

  it('maps date/time SQL types to temporal', () => {
    for (const t of ['DATE', 'TIMESTAMP', 'TIMESTAMP WITH TIME ZONE', 'DATETIME', 'TIME', 'date']) {
      expect(sqlTypeToVizKind(t)).toBe('temporal');
    }
  });

  it('maps booleans to boolean and strings to nominal', () => {
    expect(sqlTypeToVizKind('BOOLEAN')).toBe('boolean');
    expect(sqlTypeToVizKind('VARCHAR')).toBe('nominal');
    expect(sqlTypeToVizKind('TEXT')).toBe('nominal');
    expect(sqlTypeToVizKind('string')).toBe('nominal');
  });

  it('maps unknowns to unknown', () => {
    expect(sqlTypeToVizKind('GEOMETRY')).toBe('unknown');
  });
});

describe('toVizColumns', () => {
  it('zips column names with mapped kinds', () => {
    expect(toVizColumns(['month', 'revenue'], ['DATE', 'DOUBLE'])).toEqual([
      { name: 'month', kind: 'temporal' },
      { name: 'revenue', kind: 'quantitative' },
    ]);
  });

  it('pads missing types as unknown', () => {
    expect(toVizColumns(['a', 'b'], ['DOUBLE'])).toEqual([
      { name: 'a', kind: 'quantitative' },
      { name: 'b', kind: 'unknown' },
    ]);
  });
});
