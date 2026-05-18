import 'server-only';

import type { NodeConnector } from '@/lib/connections/base';
import { buildSampleSql } from '../sample-sql';

const DEFAULT_SAMPLE_SIZE = 8;
const DEFAULT_SUPER_SAMPLE_SIZE = 30;

export interface FetchTableSampleOpts {
  /** Final number of rows returned (length-stratified pick). */
  sampleSize?: number;
  /** Initial draw size from the connector. Larger than `sampleSize` so
   *  the diversity-pick has material to work with. */
  superSampleSize?: number;
}

/**
 * Pick a length-diverse subset from `pool`. When `textCols` are flagged
 * (typically high-cardinality narrative fields), rows are sorted by the
 * sum of those columns' value lengths and picked at evenly-spaced
 * percentile points so the result spans the length range. Pure.
 */
export function pickDiverseRows<T extends Record<string, unknown>>(
  pool: T[],
  n: number,
  textCols: string[],
): T[] {
  if (n <= 0 || pool.length === 0) return [];
  if (pool.length <= n) return pool;
  if (textCols.length === 0) return pool.slice(0, n);

  const lengthFor = (row: T) =>
    textCols.reduce((sum, col) => {
      const v = row[col];
      return sum + (typeof v === 'string' ? v.length : v == null ? 0 : JSON.stringify(v).length);
    }, 0);

  // Sort by length signature; stable enough for fixed inputs.
  const sorted = [...pool].sort((a, b) => lengthFor(a) - lengthFor(b));

  // Evenly-spaced picks across the sorted pool — guarantees the min and
  // max are present (indices 0 and pool.length - 1).
  const picks: T[] = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.round((i * (sorted.length - 1)) / (n - 1));
    picks.push(sorted[idx]);
  }
  return picks;
}

/**
 * Fetch a representative sample of rows for one table. Pulls
 * `superSampleSize` rows from the connector via the dialect's natural
 * sampling syntax (`buildSampleSql`), then narrows to `sampleSize` via
 * `pickDiverseRows`. Per-table connector errors yield an empty array —
 * never crash a multi-table profiling pass.
 */
export async function fetchTableSample(
  connector: NodeConnector,
  schema: string,
  table: string,
  dialect: string,
  highCardTextCols: string[],
  opts: FetchTableSampleOpts = {},
): Promise<Record<string, unknown>[]> {
  const sampleSize = opts.sampleSize ?? DEFAULT_SAMPLE_SIZE;
  const superSampleSize = opts.superSampleSize ?? DEFAULT_SUPER_SAMPLE_SIZE;

  const sql = buildSampleSql(dialect, schema, table, superSampleSize);
  try {
    const result = await connector.query(sql);
    return pickDiverseRows(result.rows ?? [], sampleSize, highCardTextCols);
  } catch {
    return [];
  }
}
