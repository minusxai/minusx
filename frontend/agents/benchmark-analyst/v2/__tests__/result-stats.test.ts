import { computeResultStats, type ResultStats } from '../result-stats';
import type { QueryResult } from '@/lib/connections/base';

describe('computeResultStats', () => {
  it('computes basic stats for numeric columns', () => {
    const result: QueryResult = {
      columns: ['value'],
      types: ['INTEGER'],
      rows: [{ value: 10 }, { value: 20 }, { value: 30 }, { value: null }],
      finalQuery: 'SELECT value FROM t',
    };

    const stats = computeResultStats(result, 4);

    expect(stats.rowCount).toBe(4);
    expect(stats.previewCount).toBe(4);
    expect(stats.columns).toHaveLength(1);

    const colStats = stats.columns[0];
    expect(colStats.column).toBe('value');
    expect(colStats.type).toBe('INTEGER');
    expect(colStats.nullCount).toBe(1);
    expect(colStats.min).toBe(10);
    expect(colStats.max).toBe(30);
    expect(colStats.avg).toBe(20);
  });

  it('computes stats for text columns with low cardinality', () => {
    const result: QueryResult = {
      columns: ['category'],
      types: ['VARCHAR'],
      rows: [
        { category: 'A' },
        { category: 'A' },
        { category: 'B' },
        { category: 'C' },
        { category: null },
      ],
      finalQuery: 'SELECT category FROM t',
    };

    const stats = computeResultStats(result, 5);
    const colStats = stats.columns[0];

    expect(colStats.cardinality).toBe('low');
    expect(colStats.nDistinct).toBe(3);
    expect(colStats.nullCount).toBe(1);
    expect(colStats.topValues).toBeDefined();
    expect(colStats.topValues).toHaveLength(3);
    expect(colStats.topValues![0]).toEqual({ value: 'A', count: 2 });
  });

  it('computes string length stats for text columns', () => {
    const result: QueryResult = {
      columns: ['name'],
      types: ['VARCHAR'],
      rows: [
        { name: 'AB' },
        { name: 'ABCD' },
        { name: 'ABCDEF' },
      ],
      finalQuery: 'SELECT name FROM t',
    };

    const stats = computeResultStats(result, 3);
    const colStats = stats.columns[0];

    expect(colStats.minLength).toBe(2);
    expect(colStats.maxLength).toBe(6);
    expect(colStats.avgLength).toBe(4);
  });

  it('identifies high cardinality columns', () => {
    // More than 100 distinct values or > 5% ratio
    const rows = Array.from({ length: 200 }, (_, i) => ({ id: `unique_${i}` }));
    const result: QueryResult = {
      columns: ['id'],
      types: ['VARCHAR'],
      rows,
      finalQuery: 'SELECT id FROM t',
    };

    const stats = computeResultStats(result, 200);
    const colStats = stats.columns[0];

    expect(colStats.cardinality).toBe('high');
    expect(colStats.topValues).toBeUndefined(); // No topValues for high cardinality
  });

  it('handles empty rows', () => {
    const result: QueryResult = {
      columns: ['x'],
      types: ['INTEGER'],
      rows: [],
      finalQuery: 'SELECT x FROM t WHERE FALSE',
    };

    const stats = computeResultStats(result, 0);
    expect(stats.rowCount).toBe(0);
    expect(stats.columns).toHaveLength(1);
  });

  it('handles multiple columns', () => {
    const result: QueryResult = {
      columns: ['id', 'name', 'price'],
      types: ['INTEGER', 'VARCHAR', 'DECIMAL'],
      rows: [
        { id: 1, name: 'foo', price: 10.5 },
        { id: 2, name: 'bar', price: 20.0 },
      ],
      finalQuery: 'SELECT * FROM t',
    };

    const stats = computeResultStats(result, 2);
    expect(stats.columns).toHaveLength(3);
    expect(stats.columns.map(c => c.column)).toEqual(['id', 'name', 'price']);
  });

  it('treats small integer values as numeric (min/max/avg)', () => {
    const result: QueryResult = {
      columns: ['status'],
      types: ['INTEGER'],
      rows: [
        { status: 1 },
        { status: 1 },
        { status: 2 },
      ],
      finalQuery: 'SELECT status FROM t',
    };

    const stats = computeResultStats(result, 3);
    const colStats = stats.columns[0];

    // Integer columns are treated as numeric, not categorical
    expect(colStats.min).toBe(1);
    expect(colStats.max).toBe(2);
    expect(colStats.avg).toBeCloseTo(1.33, 1);
  });
});
