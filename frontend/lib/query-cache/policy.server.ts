/**
 * Resolve a (possibly partial) per-file cache policy to concrete SWR windows,
 * falling back to the env-configured defaults (20 min / 1 hr) and clamping so
 * expiry is never shorter than revalidation.
 */
import 'server-only';
import { QUERY_CACHE_REVALIDATE_MS, QUERY_CACHE_EXPIRY_MS } from '@/lib/config';
import type { CachePolicy } from './types';

export function resolveCachePolicy(p?: { revalidateMs?: number; expiryMs?: number } | null): CachePolicy {
  const revalidateMs = posOr(p?.revalidateMs, QUERY_CACHE_REVALIDATE_MS);
  const expiryMs = Math.max(revalidateMs, posOr(p?.expiryMs, QUERY_CACHE_EXPIRY_MS));
  return { revalidateMs, expiryMs };
}

function posOr(v: number | undefined | null, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;
}
