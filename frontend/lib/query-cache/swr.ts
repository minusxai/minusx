/**
 * Pure SWR classification — no I/O, fully unit-testable. Decides how a cache row
 * should be treated at time `now`. On the classification path the execution lease
 * is acquired only for the states that execute (`miss`, `stale` → background,
 * `expired`) and never for `fresh`; `forceRefresh` skips classification entirely
 * and takes the lease regardless (see execute.server's `resolve`).
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
