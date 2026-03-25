/**
 * Unified Test module.
 *
 * Defines the TestRunner interface and shared comparison utilities.
 * Two implementations:
 *   - lib/tests/server.ts  — server-side (used by transformation-handler.ts)
 *   - lib/tests/client.ts  — client-side (used by UI for inline test runs)
 */
import type { Test, TestRunResult, TestAnswerType, TestOperator } from '@/lib/types';

export type { Test, TestRunResult };

/**
 * Shared interface for running a Test. Implemented by both the server runner
 * (lib/tests/server.ts) and the client runner (lib/tests/client.ts).
 */
export interface TestRunner {
  execute(test: Test): Promise<TestRunResult>;
}

// ─── Shared comparison utilities ────────────────────────────────────────────

/**
 * Resolve a RowIndex (0 = first, -1 = last, etc.) to an absolute row index.
 * Returns undefined if the rows array is empty or index is out of bounds.
 */
export function resolveRowIndex(
  rows: Record<string, unknown>[],
  rowIndex: number | undefined
): number | undefined {
  if (!rows.length) return undefined;
  const idx = rowIndex ?? 0;
  const resolved = idx < 0 ? rows.length + idx : idx;
  if (resolved < 0 || resolved >= rows.length) return undefined;
  return resolved;
}

/**
 * Extract a single cell value from a query result.
 * @param rows    Result rows (Record<column, value>[])
 * @param columns Available column names
 * @param column  Desired column (falls back to first column)
 * @param row     Row index (0 = first, -1 = last, etc.; defaults to 0)
 */
export function extractCellValue(
  rows: Record<string, unknown>[],
  columns: string[],
  column?: string,
  row?: number
): string | number | boolean | null {
  const rowIdx = resolveRowIndex(rows, row);
  if (rowIdx === undefined) return null;
  const actualRow = rows[rowIdx];
  const colName = column && columns.includes(column) ? column : columns[0];
  if (!colName) return null;
  const val = actualRow[colName];
  if (val === null || val === undefined) return null;
  return val as string | number | boolean;
}

/**
 * Compare an actual value against an expected value using the given operator.
 * Returns true if the test passes.
 */
export function compareValues(
  actual: string | number | boolean | null,
  expected: string | number | boolean | null,
  operator: TestOperator,
  answerType: TestAnswerType
): boolean {
  if (actual === null || expected === null) return false;

  if (answerType === 'binary') {
    // binary only supports '='
    return Boolean(actual) === Boolean(expected);
  }

  if (answerType === 'number') {
    const a = typeof actual === 'number' ? actual : parseFloat(String(actual));
    const e = typeof expected === 'number' ? expected : parseFloat(String(expected));
    if (isNaN(a) || isNaN(e)) return false;
    switch (operator) {
      case '=':  return Math.abs(a - e) < 0.0001;
      case '<':  return a < e;
      case '>':  return a > e;
      case '<=': return a <= e;
      case '>=': return a >= e;
    }
    return false;
  }

  if (answerType === 'string') {
    const a = String(actual);
    const e = String(expected);
    if (operator === '~') {
      if (e.length > 100) return false;
      try {
        return new RegExp(e).test(a);
      } catch {
        return false;
      }
    }
    if (operator === '=') return a === e;
  }

  return false;
}
