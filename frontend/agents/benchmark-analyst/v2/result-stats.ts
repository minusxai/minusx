/**
 * Compute per-column statistics from a QueryResult.
 * These stats let the model "see" all N rows without holding them in context.
 */

import type { QueryResult } from '@/lib/connections/base';

const CATEGORICAL_ABSOLUTE_MAX = 100;
const CATEGORICAL_RATIO_MAX = 0.05;
const TOP_VALUES_LIMIT = 10;

export type ColumnCardinality = 'low' | 'high';

export interface TopValue {
  value: string | number | boolean;
  count: number;
}

export interface ColumnStats {
  column: string;
  type: string;
  nullCount: number;
  // Numeric columns
  min?: number;
  max?: number;
  avg?: number;
  // Text/categorical columns
  cardinality?: ColumnCardinality;
  nDistinct?: number;
  topValues?: TopValue[];
  avgLength?: number;
  minLength?: number;
  maxLength?: number;
}

export interface ResultStats {
  rowCount: number;
  previewCount: number;
  columns: ColumnStats[];
}

/**
 * Classify a column as categorical (low cardinality) or high cardinality.
 */
function classifyCardinality(nDistinct: number, rowCount: number): ColumnCardinality {
  if (rowCount === 0) return 'low';
  const ratio = nDistinct / rowCount;
  if (nDistinct <= CATEGORICAL_ABSOLUTE_MAX || ratio <= CATEGORICAL_RATIO_MAX) {
    return 'low';
  }
  return 'high';
}

/**
 * Check if a type is numeric.
 */
function isNumericType(type: string): boolean {
  const t = type.toLowerCase();
  return ['int', 'float', 'double', 'decimal', 'numeric', 'real', 'bigint', 'smallint', 'number', 'int64', 'float64'].some(k => t.includes(k));
}

/**
 * Check if a type is text/string.
 */
function isTextType(type: string): boolean {
  const t = type.toLowerCase();
  return ['text', 'varchar', 'character', 'string', 'char'].some(k => t.includes(k));
}

/**
 * Compute statistics for a single column.
 */
function computeColumnStats(
  columnName: string,
  columnType: string,
  values: unknown[],
): ColumnStats {
  const stats: ColumnStats = {
    column: columnName,
    type: columnType,
    nullCount: 0,
  };

  // Count nulls
  const nonNullValues: unknown[] = [];
  for (const v of values) {
    if (v == null) {
      stats.nullCount++;
    } else {
      nonNullValues.push(v);
    }
  }

  if (nonNullValues.length === 0) {
    return stats;
  }

  // Check if all values are numeric
  const numericValues: number[] = [];
  const stringValues: string[] = [];

  for (const v of nonNullValues) {
    if (typeof v === 'number' && !isNaN(v)) {
      numericValues.push(v);
    } else if (typeof v === 'string') {
      stringValues.push(v);
    }
  }

  // Numeric stats
  if (numericValues.length === nonNullValues.length && numericValues.length > 0) {
    stats.min = Math.min(...numericValues);
    stats.max = Math.max(...numericValues);
    stats.avg = Math.round((numericValues.reduce((a, b) => a + b, 0) / numericValues.length) * 100) / 100;
    return stats;
  }

  // Text/categorical stats
  const valueCounts = new Map<string, number>();
  let totalLength = 0;
  let minLength = Infinity;
  let maxLength = 0;

  for (const v of nonNullValues) {
    const str = String(v);
    valueCounts.set(str, (valueCounts.get(str) ?? 0) + 1);
    totalLength += str.length;
    minLength = Math.min(minLength, str.length);
    maxLength = Math.max(maxLength, str.length);
  }

  const nDistinct = valueCounts.size;
  stats.nDistinct = nDistinct;
  stats.cardinality = classifyCardinality(nDistinct, values.length);

  // String length stats for text columns
  if (isTextType(columnType) || stringValues.length === nonNullValues.length) {
    stats.avgLength = Math.round((totalLength / nonNullValues.length) * 10) / 10;
    stats.minLength = minLength === Infinity ? 0 : minLength;
    stats.maxLength = maxLength;
  }

  // Top values for low-cardinality columns
  if (stats.cardinality === 'low') {
    const sorted = [...valueCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_VALUES_LIMIT);

    stats.topValues = sorted.map(([value, count]) => {
      // Try to preserve numeric values
      const numVal = Number(value);
      if (!isNaN(numVal) && String(numVal) === value) {
        return { value: numVal, count };
      }
      return { value, count };
    });
  }

  return stats;
}

/**
 * Compute statistics for an entire query result.
 */
export function computeResultStats(
  result: QueryResult,
  previewCount: number,
): ResultStats {
  const columns: ColumnStats[] = [];
  const { rows } = result;
  const colNames = result.columns ?? (rows[0] ? Object.keys(rows[0]) : []);
  const colTypes = result.types ?? colNames.map(() => 'unknown');

  for (let i = 0; i < colNames.length; i++) {
    const name = colNames[i];
    const type = colTypes[i] ?? 'unknown';
    const values = rows.map(r => r[name]);
    columns.push(computeColumnStats(name, type, values));
  }

  return {
    rowCount: rows.length,
    previewCount,
    columns,
  };
}
