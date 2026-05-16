// Tests for computeResultStats: generates per-column stats from query results
import { describe, it, expect } from 'vitest';
import type { QueryResult } from '@/lib/connections/base';
import { computeResultStats, type ResultStats } from '../result-stats';

describe('computeResultStats', () => {
  describe('row counts', () => {
    it('returns correct rowCount and previewCount', () => {
      const result: QueryResult = {
        columns: ['id'],
        types: ['INTEGER'],
        rows: [{ id: 1 }, { id: 2 }, { id: 3 }],
        finalQuery: '',
      };

      const stats = computeResultStats(result, 2);

      expect(stats.rowCount).toBe(3);
      expect(stats.previewCount).toBe(2);
    });

    it('handles empty result set', () => {
      const result: QueryResult = {
        columns: ['id'],
        types: ['INTEGER'],
        rows: [],
        finalQuery: '',
      };

      const stats = computeResultStats(result, 10);

      expect(stats.rowCount).toBe(0);
      expect(stats.previewCount).toBe(0);
    });

    it('clamps previewCount to rowCount when smaller', () => {
      const result: QueryResult = {
        columns: ['id'],
        types: ['INTEGER'],
        rows: [{ id: 1 }],
        finalQuery: '',
      };

      const stats = computeResultStats(result, 100);

      expect(stats.rowCount).toBe(1);
      expect(stats.previewCount).toBe(1);
    });
  });

  describe('numeric columns', () => {
    it('computes min/max/avg for numeric columns', () => {
      const result: QueryResult = {
        columns: ['value'],
        types: ['DOUBLE'],
        rows: [{ value: 10 }, { value: 20 }, { value: 30 }],
        finalQuery: '',
      };

      const stats = computeResultStats(result, 3);

      expect(stats.columns.value.min).toBe(10);
      expect(stats.columns.value.max).toBe(30);
      expect(stats.columns.value.avg).toBe(20);
    });

    it('handles null values in numeric columns', () => {
      const result: QueryResult = {
        columns: ['value'],
        types: ['INTEGER'],
        rows: [{ value: 10 }, { value: null }, { value: 30 }],
        finalQuery: '',
      };

      const stats = computeResultStats(result, 3);

      expect(stats.columns.value.min).toBe(10);
      expect(stats.columns.value.max).toBe(30);
      expect(stats.columns.value.avg).toBe(20);
    });

    it('handles INTEGER, BIGINT, DECIMAL types as numeric', () => {
      const result: QueryResult = {
        columns: ['int_col', 'bigint_col', 'decimal_col'],
        types: ['INTEGER', 'BIGINT', 'DECIMAL'],
        rows: [{ int_col: 1, bigint_col: 100, decimal_col: 1.5 }],
        finalQuery: '',
      };

      const stats = computeResultStats(result, 1);

      expect(stats.columns.int_col.min).toBe(1);
      expect(stats.columns.bigint_col.min).toBe(100);
      expect(stats.columns.decimal_col.min).toBe(1.5);
    });
  });

  describe('text/categorical columns', () => {
    it('identifies low-cardinality columns and provides topValues', () => {
      const result: QueryResult = {
        columns: ['category'],
        types: ['VARCHAR'],
        rows: [
          { category: 'A' },
          { category: 'A' },
          { category: 'B' },
          { category: 'A' },
          { category: 'B' },
        ],
        finalQuery: '',
      };

      const stats = computeResultStats(result, 5);

      expect(stats.columns.category.cardinality).toBe('low');
      expect(stats.columns.category.nDistinct).toBe(2);
      expect(stats.columns.category.topValues).toEqual([
        { value: 'A', count: 3 },
        { value: 'B', count: 2 },
      ]);
    });

    it('identifies high-cardinality columns (no topValues)', () => {
      const rows = Array.from({ length: 100 }, (_, i) => ({ id: `unique_${i}` }));
      const result: QueryResult = {
        columns: ['id'],
        types: ['VARCHAR'],
        rows,
        finalQuery: '',
      };

      const stats = computeResultStats(result, 100);

      expect(stats.columns.id.cardinality).toBe('high');
      expect(stats.columns.id.nDistinct).toBe(100);
      expect(stats.columns.id.topValues).toBeUndefined();
    });

    it('computes min/max/avg length for text columns', () => {
      const result: QueryResult = {
        columns: ['name'],
        types: ['VARCHAR'],
        rows: [
          { name: 'a' },       // len 1
          { name: 'abc' },     // len 3
          { name: 'abcde' },   // len 5
        ],
        finalQuery: '',
      };

      const stats = computeResultStats(result, 3);

      expect(stats.columns.name.minLength).toBe(1);
      expect(stats.columns.name.maxLength).toBe(5);
      expect(stats.columns.name.avgLength).toBe(3);
    });
  });

  describe('temporal columns', () => {
    it('computes minDate/maxDate for DATE columns', () => {
      const result: QueryResult = {
        columns: ['created_at'],
        types: ['DATE'],
        rows: [
          { created_at: '2023-01-01' },
          { created_at: '2023-06-15' },
          { created_at: '2023-12-31' },
        ],
        finalQuery: '',
      };

      const stats = computeResultStats(result, 3);

      expect(stats.columns.created_at.minDate).toBe('2023-01-01');
      expect(stats.columns.created_at.maxDate).toBe('2023-12-31');
    });

    it('handles TIMESTAMP columns', () => {
      const result: QueryResult = {
        columns: ['updated_at'],
        types: ['TIMESTAMP'],
        rows: [
          { updated_at: '2023-01-01T00:00:00Z' },
          { updated_at: '2023-12-31T23:59:59Z' },
        ],
        finalQuery: '',
      };

      const stats = computeResultStats(result, 2);

      expect(stats.columns.updated_at.minDate).toBeDefined();
      expect(stats.columns.updated_at.maxDate).toBeDefined();
    });
  });

  describe('mixed columns', () => {
    it('handles results with multiple column types', () => {
      const result: QueryResult = {
        columns: ['id', 'name', 'amount', 'created'],
        types: ['INTEGER', 'VARCHAR', 'DECIMAL', 'DATE'],
        rows: [
          { id: 1, name: 'Alice', amount: 100.5, created: '2023-01-01' },
          { id: 2, name: 'Bob', amount: 200.0, created: '2023-02-01' },
        ],
        finalQuery: '',
      };

      const stats = computeResultStats(result, 2);

      // numeric
      expect(stats.columns.id.min).toBe(1);
      expect(stats.columns.amount.avg).toBe(150.25);

      // text
      expect(stats.columns.name.nDistinct).toBe(2);

      // temporal
      expect(stats.columns.created.minDate).toBe('2023-01-01');
    });
  });

  describe('edge cases', () => {
    it('handles all-null column', () => {
      const result: QueryResult = {
        columns: ['value'],
        types: ['INTEGER'],
        rows: [{ value: null }, { value: null }],
        finalQuery: '',
      };

      const stats = computeResultStats(result, 2);

      expect(stats.columns.value.min).toBeUndefined();
      expect(stats.columns.value.max).toBeUndefined();
    });

    it('handles result with no columns', () => {
      const result: QueryResult = {
        columns: [],
        types: [],
        rows: [],
        finalQuery: '',
      };

      const stats = computeResultStats(result, 0);

      expect(stats.rowCount).toBe(0);
      expect(stats.columns).toEqual({});
    });
  });
});
