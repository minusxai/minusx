/**
 * executeQueryCached — the ONE chokepoint for cached query execution.
 *
 * Both `/api/query` and the agent's ExecuteQuery go through here, so they share
 * one durable, cross-instance, stale-while-revalidate cache (arch doc §3–5).
 *
 *   fresh   → serve blob (cache stream, no execution)
 *   stale   → serve blob NOW + fire-and-forget background revalidation (lease)
 *   expired → execute synchronously (lease)
 *   miss    → execute synchronously (lease); losers wait then read the winner's blob
 *
 * Callers supply an `execute()` thunk that runs the actual query (None-resolution,
 * CTE composition, runQuery). This module owns the cache key, the lease, the blob
 * write, and the SWR decision — never the SQL itself.
 */
import 'server-only';
import type { Readable } from 'stream';
import type { QueryResult } from '@/lib/connections/base';
import { getQueryHash } from '@/lib/utils/query-hash';
import { createQueryCacheBlobStore, blobRefForKey } from './blob-store';
import { resultToJsonlStream } from './jsonl-stream.server';
import { classifyCacheRow } from './swr';
import {
  claimLease, getCacheRow, markReady, releaseLease, waitForReady,
} from './store.server';
import type { CachePolicy, QueryCacheBlobStore } from './types';

export interface CachedExec {
  mode: string;
  connectionName: string;
  /** Raw query used for the cache key — matches the client's getQueryHash inputs. */
  query: string;
  params: Record<string, string | number | null>;
  policy: CachePolicy;
  /** Runs the actual query (applyNoneParams + CTE + runQuery) and returns the result. */
  execute: () => Promise<QueryResult>;
  /** Overridable for tests. */
  blobStore?: QueryCacheBlobStore;
  now?: () => number;
}

export interface CachedMeta {
  finalQuery: string;
  rowCount: number;
  colCount: number;
  fromCache: boolean;
  /** Epoch ms the served result was produced. */
  cachedAt: number;
}

/** How long a loser waits for the winner's blob before re-claiming. */
const WAIT_TIMEOUT_MS = 30_000;
const MAX_LEASE_ATTEMPTS = 3;

function cacheKey(opts: CachedExec): string {
  return `${opts.mode}:${getQueryHash(opts.query, opts.params, opts.connectionName)}`;
}

function store(opts: CachedExec): QueryCacheBlobStore {
  return opts.blobStore ?? createQueryCacheBlobStore();
}

type Resolved =
  | { source: 'cache'; blobRef: string; finalQuery: string; rowCount: number; colCount: number; cachedAt: number }
  | { source: 'fresh'; result: QueryResult; cachedAt: number };

/** Get the cached result fully materialized (agent + small reads). */
export async function getCachedResult(opts: CachedExec): Promise<{ result: QueryResult; meta: CachedMeta }> {
  const r = await resolve(opts);
  if (r.source === 'fresh') {
    return { result: r.result, meta: metaOf(r.result, false, r.cachedAt) };
  }
  const result = await store(opts).getResult(r.blobRef);
  if (result) {
    return { result, meta: { finalQuery: r.finalQuery, rowCount: r.rowCount, colCount: r.colCount, fromCache: true, cachedAt: r.cachedAt } };
  }
  // Blob vanished between index read and blob read → execute fresh.
  const fresh = await runAndStore(cacheKey(opts), opts);
  return { result: fresh, meta: metaOf(fresh, false, nowOf(opts)) };
}

/** Get the cached result as a JSONL stream (the streaming `/api/query` body). */
export async function getCachedJsonlStream(opts: CachedExec): Promise<{ stream: Readable; meta: CachedMeta }> {
  const r = await resolve(opts);
  if (r.source === 'fresh') {
    return { stream: resultToJsonlStream(r.result), meta: metaOf(r.result, false, r.cachedAt) };
  }
  const stream = await store(opts).getStream(r.blobRef);
  if (stream) {
    return { stream, meta: { finalQuery: r.finalQuery, rowCount: r.rowCount, colCount: r.colCount, fromCache: true, cachedAt: r.cachedAt } };
  }
  const fresh = await runAndStore(cacheKey(opts), opts);
  return { stream: resultToJsonlStream(fresh), meta: metaOf(fresh, false, nowOf(opts)) };
}

// ── internals ────────────────────────────────────────────────────────────────

async function resolve(opts: CachedExec): Promise<Resolved> {
  const now = nowOf(opts);
  const key = cacheKey(opts);
  const row = await getCacheRow(key);
  const cls = classifyCacheRow(row, now);

  if ((cls === 'fresh' || cls === 'stale') && row?.blobRef) {
    if (cls === 'stale') backgroundRevalidate(key, opts);
    return {
      source: 'cache', blobRef: row.blobRef, finalQuery: row.finalQuery ?? '',
      rowCount: row.rowCount ?? 0, colCount: row.colCount ?? 0, cachedAt: row.createdAt,
    };
  }
  return executeWithLease(key, opts, now);
}

async function executeWithLease(key: string, opts: CachedExec, startNow: number): Promise<Resolved> {
  let now = startNow;
  for (let attempt = 0; attempt < MAX_LEASE_ATTEMPTS; attempt++) {
    const claim = await claimLease(
      key,
      { query: opts.query, connectionName: opts.connectionName, params: opts.params, policy: opts.policy },
      now,
    );
    if (claim.won) {
      const result = await runAndStore(key, opts);
      return { source: 'fresh', result, cachedAt: now };
    }
    // Lost — wait for the winner's blob.
    const ready = await waitForReady(key, { timeoutMs: WAIT_TIMEOUT_MS, intervalMs: 50, now: () => Date.now() });
    if (ready?.blobRef) {
      return {
        source: 'cache', blobRef: ready.blobRef, finalQuery: ready.finalQuery ?? '',
        rowCount: ready.rowCount ?? 0, colCount: ready.colCount ?? 0, cachedAt: ready.createdAt,
      };
    }
    now = Date.now(); // winner died without a blob → re-claim
  }
  // Exhausted attempts (rare) — execute directly so the caller still gets data.
  const result = await runAndStore(key, opts).catch(() => opts.execute());
  return { source: 'fresh', result, cachedAt: Date.now() };
}

/** Execute, write the blob, mark ready. On failure, free the lease and rethrow. */
async function runAndStore(key: string, opts: CachedExec): Promise<QueryResult> {
  try {
    const result = await opts.execute();
    const blobRef = blobRefForKey(key);
    const { byteSize } = await store(opts).putStream(blobRef, resultToJsonlStream(result));
    await markReady(
      key,
      {
        blobRef, finalQuery: result.finalQuery, rowCount: result.rows.length,
        colCount: result.columns.length, byteSize, policy: opts.policy,
      },
      Date.now(),
    );
    return result;
  } catch (err) {
    await releaseLease(key).catch(() => { /* best effort */ });
    throw err;
  }
}

/** Fire-and-forget background refresh of a stale entry. One winner via the lease. */
function backgroundRevalidate(key: string, opts: CachedExec): void {
  void (async () => {
    const claim = await claimLease(
      key,
      { query: opts.query, connectionName: opts.connectionName, params: opts.params, policy: opts.policy },
      Date.now(),
    );
    if (!claim.won) return; // someone else is already revalidating
    await runAndStore(key, opts).catch(() => { /* stale blob keeps serving; lease freed in runAndStore */ });
  })().catch(() => { /* never surface to the request */ });
}

function metaOf(result: QueryResult, fromCache: boolean, cachedAt: number): CachedMeta {
  return { finalQuery: result.finalQuery, rowCount: result.rows.length, colCount: result.columns.length, fromCache, cachedAt };
}

function nowOf(opts: CachedExec): number {
  return opts.now?.() ?? Date.now();
}
