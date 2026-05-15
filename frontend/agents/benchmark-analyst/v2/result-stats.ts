// Result stats computation: generates per-column stats from query results
// Used to give the LLM a compressed view of all N rows without holding them.

import type { QueryResult } from '@/lib/connections/base';
import { immutableSet } from '@/lib/utils/immutable-collections';

export interface ColumnStats {
  // Numeric columns
  min?: number;
  max?: number;
  avg?: number;

  // Text/categorical columns
  cardinality?: 'low' | 'high';
  nDistinct?: number;
  topValues?: Array<{ value: string; count: number }>;
  minLength?: number;
  maxLength?: number;
  avgLength?: number;

  // Temporal columns
  minDate?: string;
  maxDate?: string;
}

export interface ResultStats {
  rowCount: number;
  previewCount: number;
  columns: Record<string, ColumnStats>;
}

const NUMERIC_TYPES = immutableSet([
  'INTEGER', 'INT', 'INT4', 'INT8', 'BIGINT', 'SMALLINT', 'TINYINT',
  'DOUBLE', 'FLOAT', 'FLOAT4', 'FLOAT8', 'REAL',
  'DECIMAL', 'NUMERIC', 'NUMBER',
]);

const TEMPORAL_TYPES = immutableSet([
  'DATE', 'DATETIME', 'TIMESTAMP', 'TIMESTAMPTZ', 'TIME', 'TIMETZ',
]);

function isNumericType(type: string): boolean {
  const upper = type.toUpperCase();
  return NUMERIC_TYPES.has(upper) || upper.includes('INT') || upper.includes('FLOAT') || upper.includes('DOUBLE') || upper.includes('DECIMAL');
}

function isTemporalType(type: string): boolean {
  const upper = type.toUpperCase();
  return TEMPORAL_TYPES.has(upper) || upper.includes('DATE') || upper.includes('TIME');
}

// Threshold for "low" cardinality: absolute max or ratio of distinct / total
// A column is "low cardinality" if nDistinct <= 100 AND ratio <= 50%
const CATEGORICAL_ABSOLUTE_MAX = 100;
const CATEGORICAL_RATIO_MAX = 0.5;
const TOP_VALUES_LIMIT = 10;

/**
 * Compute stats for a query result.
 * @param result The query result
 * @param previewCount Number of rows shown in preview (for the stats)
 */
export function computeResultStats(result: QueryResult, previewCount: number): ResultStats {
  const rowCount = result.rows.length;
  const actualPreviewCount = Math.min(previewCount, rowCount);

  const columns: Record<string, ColumnStats> = {};

  for (let i = 0; i < result.columns.length; i++) {
    const colName = result.columns[i];
    const colType = result.types?.[i] ?? 'VARCHAR';

    const values = result.rows.map((row) => row[colName]);
    const nonNullValues = values.filter((v) => v != null);

    if (nonNullValues.length === 0) {
      columns[colName] = {};
      continue;
    }

    if (isNumericType(colType)) {
      columns[colName] = computeNumericStats(nonNullValues);
    } else if (isTemporalType(colType)) {
      columns[colName] = computeTemporalStats(nonNullValues);
    } else {
      columns[colName] = computeTextStats(nonNullValues, rowCount);
    }
  }

  return { rowCount, previewCount: actualPreviewCount, columns };
}

function computeNumericStats(values: unknown[]): ColumnStats {
  const nums = values.map((v) => typeof v === 'number' ? v : parseFloat(String(v))).filter((n) => !isNaN(n));

  if (nums.length === 0) return {};

  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length;

  return { min, max, avg };
}

function computeTemporalStats(values: unknown[]): ColumnStats {
  const dates = values
    .map((v) => String(v))
    .filter((s) => s.length > 0)
    .sort();

  if (dates.length === 0) return {};

  return {
    minDate: dates[0],
    maxDate: dates[dates.length - 1],
  };
}

function computeTextStats(values: unknown[], totalRows: number): ColumnStats {
  const strings = values.map((v) => String(v));

  // Compute distinct values
  const valueCounts = new Map<string, number>();
  for (const s of strings) {
    valueCounts.set(s, (valueCounts.get(s) ?? 0) + 1);
  }

  const nDistinct = valueCounts.size;
  const ratio = nDistinct / totalRows;
  const isLowCardinality = nDistinct <= CATEGORICAL_ABSOLUTE_MAX && ratio <= CATEGORICAL_RATIO_MAX;

  const stats: ColumnStats = {
    cardinality: isLowCardinality ? 'low' : 'high',
    nDistinct,
  };

  // Top values for low cardinality
  if (isLowCardinality) {
    const sorted = Array.from(valueCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_VALUES_LIMIT);
    stats.topValues = sorted.map(([value, count]) => ({ value, count }));
  }

  // String lengths
  const lengths = strings.map((s) => s.length);
  if (lengths.length > 0) {
    stats.minLength = Math.min(...lengths);
    stats.maxLength = Math.max(...lengths);
    stats.avgLength = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  }

  return stats;
}
