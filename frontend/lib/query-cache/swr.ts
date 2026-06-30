/**
 * Pure SWR classification — no I/O, fully unit-testable. Decides how a cache row
 * should be treated at time `now`. The execution lease is acquired ONLY for the
 * states that execute (`miss`, `stale` → background, `expired`), never for `fresh`.
 */
import type { QueryCacheRow } from './types';

export type CacheClass =
  | 'miss'    // no row, or a pending row with no usable blob yet → must execute/wait
  | 'fresh'   // serve as-is, no revalidation
  | 'stale'   // serve immediately + background revalidate (lease)
  | 'expired'; // too old to serve → execute synchronously (lease)

export function classifyCacheRow(row: QueryCacheRow | null, now: number): CacheClass {
  if (!row || !row.blobRef) return 'miss';
  if (now < row.revalidateAt) return 'fresh';
  if (now < row.expireAt) return 'stale';
  return 'expired';
}
