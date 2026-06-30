/**
 * QueryCacheStore — the control-plane data access for `query_cache`.
 *
 * Owns the execution lease: concurrent identical misses/revalidations are
 * deduped via an `INSERT … ON CONFLICT … WHERE lease_expired` claim, so exactly
 * one caller executes and the rest wait then read the blob. Stateless per
 * instance (works across the hosted fleet; a graceful no-op on single-writer
 * PGLite). See docs/Query Execution, Cache, & Params Arch V2.md §4.
 */
import 'server-only';
import { getModules } from '@/lib/modules/registry';
import { QUERY_CACHE_LEASE_MS } from '@/lib/config';
import type { CachePolicy, LeaseClaim, QueryCacheRow } from './types';

type ParamMap = Record<string, string | number | null>;

interface CacheRowDb {
  cache_key: string;
  query: string;
  connection_name: string;
  params: ParamMap;
  blob_ref: string | null;
  final_query: string | null;
  row_count: number | null;
  col_count: number | null;
  byte_size: number | null;
  status: 'pending' | 'ready';
  created_at: string | number;
  revalidate_at: string | number;
  expire_at: string | number;
  lease_expires_at: string | number;
}

function toRow(r: CacheRowDb): QueryCacheRow {
  return {
    cacheKey: r.cache_key,
    query: r.query,
    connectionName: r.connection_name,
    params: r.params ?? {},
    blobRef: r.blob_ref,
    finalQuery: r.final_query,
    rowCount: r.row_count,
    colCount: r.col_count,
    byteSize: r.byte_size,
    status: r.status,
    createdAt: Number(r.created_at),
    revalidateAt: Number(r.revalidate_at),
    expireAt: Number(r.expire_at),
    leaseExpiresAt: Number(r.lease_expires_at),
  };
}

const db = () => getModules().db;

/** Read the current cache row for a key, or null. */
export async function getCacheRow(cacheKey: string): Promise<QueryCacheRow | null> {
  const res = await db().exec<CacheRowDb>('SELECT * FROM query_cache WHERE cache_key = $1', [cacheKey]);
  return res.rows[0] ? toRow(res.rows[0]) : null;
}

/**
 * Attempt to claim the execution lease for a key. Wins by inserting a fresh
 * pending row, OR by stealing a row whose lease has expired. Loses (returns the
 * current row, `won:false`) when another caller holds a live lease.
 *
 * IMPORTANT: a claim never clears `blob_ref` — a stale row keeps serving its old
 * blob while the winner refreshes it.
 */
export async function claimLease(
  cacheKey: string,
  init: { query: string; connectionName: string; params: ParamMap; policy: CachePolicy },
  now: number,
): Promise<LeaseClaim> {
  const leaseUntil = now + QUERY_CACHE_LEASE_MS;
  // On INSERT (brand-new key) we win. On CONFLICT we win only if the existing
  // lease is dead (lease_expires_at < now); otherwise the WHERE blocks the
  // UPDATE and RETURNING yields no row → we lost.
  const res = await db().exec<CacheRowDb>(
    `INSERT INTO query_cache
       (cache_key, query, connection_name, params, status,
        created_at, revalidate_at, expire_at, lease_expires_at)
     VALUES ($1, $2, $3, $4::jsonb, 'pending', $5, $6, $7, $8)
     ON CONFLICT ON CONSTRAINT query_cache_pkey DO UPDATE
       SET status = 'pending',
           lease_expires_at = $8,
           query = EXCLUDED.query,
           connection_name = EXCLUDED.connection_name,
           params = EXCLUDED.params
       WHERE query_cache.lease_expires_at < $5
     RETURNING *`,
    [
      cacheKey, init.query, init.connectionName, JSON.stringify(init.params),
      now, now + init.policy.revalidateMs, now + init.policy.expiryMs, leaseUntil,
    ],
  );

  if (res.rows[0]) return { won: true, row: toRow(res.rows[0]) };

  // Lost the race — return the live row so the caller can wait + read its blob.
  const current = await getCacheRow(cacheKey);
  // current can momentarily be null if the holder's row vanished; synthesize a
  // minimal placeholder so callers always get a row.
  return {
    won: false,
    row: current ?? {
      cacheKey, query: init.query, connectionName: init.connectionName, params: init.params,
      blobRef: null, finalQuery: null, rowCount: null, colCount: null, byteSize: null,
      status: 'pending', createdAt: now, revalidateAt: now + init.policy.revalidateMs,
      expireAt: now + init.policy.expiryMs, leaseExpiresAt: leaseUntil,
    },
  };
}

/** Mark a key ready after a successful execution + blob write. Resets SWR windows + frees the lease. */
export async function markReady(
  cacheKey: string,
  result: { blobRef: string; finalQuery: string; rowCount: number; colCount: number; byteSize: number; policy: CachePolicy },
  now: number,
): Promise<void> {
  await db().exec(
    `UPDATE query_cache
       SET status = 'ready', blob_ref = $2, final_query = $3,
           row_count = $4, col_count = $5, byte_size = $6,
           created_at = $7, revalidate_at = $8, expire_at = $9,
           lease_expires_at = 0
     WHERE cache_key = $1`,
    [cacheKey, result.blobRef, result.finalQuery, result.rowCount, result.colCount, result.byteSize,
     now, now + result.policy.revalidateMs, now + result.policy.expiryMs],
  );
}

/** Release the lease after a FAILED execution so the next caller can retry. Leaves any prior blob intact. */
export async function releaseLease(cacheKey: string): Promise<void> {
  await db().exec('UPDATE query_cache SET lease_expires_at = 0 WHERE cache_key = $1', [cacheKey]);
}

/**
 * Poll for a ready blob after losing the lease. Resolves with the ready row, or
 * null if the holder's lease expires without producing a blob (caller re-claims).
 */
export async function waitForReady(
  cacheKey: string,
  opts: { timeoutMs: number; intervalMs?: number; now: () => number },
): Promise<QueryCacheRow | null> {
  const interval = opts.intervalMs ?? 50;
  const deadline = opts.now() + opts.timeoutMs;
  for (;;) {
    const row = await getCacheRow(cacheKey);
    if (row?.status === 'ready' && row.blobRef) return row;
    const t = opts.now();
    // Holder died (lease expired) without producing a blob → let caller re-claim.
    if (row && row.leaseExpiresAt < t && (row.status !== 'ready' || !row.blobRef)) return null;
    if (t >= deadline) return null;
    await sleep(interval);
  }
}

/** Delete cache rows whose hard-expiry has passed. Returns the blob refs to delete. */
export async function sweepExpired(now: number): Promise<string[]> {
  const res = await db().exec<{ blob_ref: string | null }>(
    'DELETE FROM query_cache WHERE expire_at < $1 RETURNING blob_ref',
    [now],
  );
  return res.rows.map((r) => r.blob_ref).filter((r): r is string => !!r);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
