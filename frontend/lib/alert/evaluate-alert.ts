/**
 * Alert condition evaluation logic.
 * Shared by server-side API routes and client-side preview.
 */
import { AlertCondition, ComparisonOperator } from '@/lib/types';

export function evaluateCondition(actual: number, operator: ComparisonOperator, threshold: number): boolean {
  switch (operator) {
    case '>': return actual > threshold;
    case '<': return actual < threshold;
    case '=': return actual === threshold;
    case '>=': return actual >= threshold;
    case '<=': return actual <= threshold;
    case '!=': return actual !== threshold;
    default: return false;
  }
}

/**
 * Extract the metric value from query rows based on the alert condition.
 * Throws if the data is insufficient or types are wrong.
 */
export function extractMetricValue(
  rows: Record<string, any>[],
  condition: AlertCondition
): number {
  const { selector, function: fn, column } = condition;
  const col = column || '';

  if (fn === 'count') {
    return rows.length;
  }

  if (fn === 'sum' || fn === 'avg' || fn === 'min' || fn === 'max') {
    if (rows.length === 0) throw new Error('Query returned no rows');
    const vals = rows.map((r) => {
      const v = typeof r[col] === 'number' ? r[col] : Number(r[col]);
      if (isNaN(v)) throw new Error(`Column "${col}" contains non-numeric value: ${r[col]}`);
      return v;
    });
    if (fn === 'sum') return vals.reduce((a, b) => a + b, 0);
    if (fn === 'avg') return vals.reduce((a, b) => a + b, 0) / vals.length;
    if (fn === 'min') return Math.min(...vals);
    return Math.max(...vals);
  }

  // Single-row functions (first/last selector)
  if (rows.length === 0) throw new Error('Query returned no rows');
  const rowIdx = selector === 'last' ? rows.length - 1 : 0;

  if (fn === 'value') {
    const raw = rows[rowIdx][col];
    const v = typeof raw === 'number' ? raw : Number(raw);
    if (isNaN(v)) throw new Error(`Column "${col}" value is not a number: ${raw}`);
    return v;
  }

  if (fn === 'diff' || fn === 'pct_change') {
    if (rows.length < 2) throw new Error('Need at least 2 rows for diff/pct_change');
    const adjIdx = selector === 'last' ? rows.length - 2 : 1;
    const selected = typeof rows[rowIdx][col] === 'number' ? rows[rowIdx][col] : Number(rows[rowIdx][col]);
    const adjacent = typeof rows[adjIdx][col] === 'number' ? rows[adjIdx][col] : Number(rows[adjIdx][col]);
    if (isNaN(selected) || isNaN(adjacent)) throw new Error(`Column "${col}" contains non-numeric values`);
    if (fn === 'diff') return selected - adjacent;
    if (adjacent === 0) throw new Error('Cannot compute % change: adjacent value is 0');
    return ((selected - adjacent) / Math.abs(adjacent)) * 100;
  }

  if (fn === 'months_ago' || fn === 'days_ago' || fn === 'years_ago') {
    const raw = rows[rowIdx][col];
    const d = new Date(raw);
    if (isNaN(d.getTime())) throw new Error(`Column "${col}" contains invalid date: ${raw}`);
    const now = new Date();
    if (fn === 'days_ago') return Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
    if (fn === 'months_ago') return (now.getFullYear() * 12 + now.getMonth()) - (d.getFullYear() * 12 + d.getMonth());
    return now.getFullYear() - d.getFullYear();
  }

  throw new Error(`Unknown function: ${fn}`);
}
