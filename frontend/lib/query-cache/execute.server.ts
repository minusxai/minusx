/**
 * executeQueryCached — the ONE chokepoint for cached query execution, now fully
 * STREAMING write-through (arch doc §1, §3–5).
 *
 *   fresh   → serve blob (cache stream, no execution)
 *   stale   → serve blob NOW + fire-and-forget background revalidation (lease)
 *   expired → execute (lease)
 *   miss    → execute (lease); losers wait then read the winner's blob
 *
 * On a miss/refresh the caller's `execute()` returns a `QueryStream` (header +
 * lazily-yielded rows). We pipe it connector → JSONL → gzip → object store
 * WITHOUT ever materializing (peak RAM = one chunk), then serve every read back
 * from the object store. The server never holds the whole result on the write
 * path. Materialization happens only when a consumer (the agent) explicitly
 * reads the full result back, and only for the degraded (cache-infra-down) path.
 *
 * Best-effort: a cache-infra failure degrades to direct execution; SQL errors
 * still propagate (→ 400).
 */
import 'server-only';
import type { Readable } from 'stream';
import { drainQueryStream, type QueryResult, type QueryStream } from '@/lib/connections/base';
import { getQueryHash } from '@/lib/utils/query-hash';
import { createQueryCacheBlobStore, blobRefForKey } from './blob-store';
import { resultToJsonlStream, queryStreamToJsonl } from './jsonl-stream.server';
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
  /** Runs the actual query and returns a STREAMING result (runQueryStream). */
  execute: () => Promise<QueryStream>;
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
  | { source: 'cache'; blobRef: string; finalQuery: string; rowCount: number; colCount: number; cachedAt: number; fromCache: boolean }
  | { source: 'fresh'; result: QueryResult; cachedAt: number };

/** Get the cached result fully materialized (agent + small reads). */
export async function getCachedResult(opts: CachedExec): Promise<{ result: QueryResult; meta: CachedMeta }> {
  const r = await resolve(opts);
  if (r.source === 'fresh') {
    return { result: r.result, meta: metaOf(r.result, false, r.cachedAt) };
  }
  const result = await store(opts).getResult(r.blobRef);
  if (result) {
    return { result, meta: { finalQuery: r.finalQuery, rowCount: r.rowCount, colCount: r.colCount, fromCache: r.fromCache, cachedAt: r.cachedAt } };
  }
  // Blob vanished between index read and blob read → execute fresh (materialized).
  const fresh = await drainQueryStream(await opts.execute());
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
    return { stream, meta: { finalQuery: r.finalQuery, rowCount: r.rowCount, colCount: r.colCount, fromCache: r.fromCache, cachedAt: r.cachedAt } };
  }
  const fresh = await drainQueryStream(await opts.execute());
  return { stream: resultToJsonlStream(fresh), meta: metaOf(fresh, false, nowOf(opts)) };
}

// ── internals ────────────────────────────────────────────────────────────────

async function resolve(opts: CachedExec): Promise<Resolved> {
  const now = nowOf(opts);
  const key = cacheKey(opts);
  // Cache reads are best-effort: a DB/infra hiccup degrades to direct execution.
  const row = await getCacheRow(key).catch(() => null);
  const cls = classifyCacheRow(row, now);

  if ((cls === 'fresh' || cls === 'stale') && row?.blobRef) {
    if (cls === 'stale') backgroundRevalidate(key, opts);
    return {
      source: 'cache', blobRef: row.blobRef, finalQuery: row.finalQuery ?? '',
      rowCount: row.rowCount ?? 0, colCount: row.colCount ?? 0, cachedAt: row.createdAt, fromCache: true,
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
    ).catch(() => ({ won: true } as { won: boolean }));
    if (claim.won) {
      return runAndStore(key, opts, now);
    }
    const ready = await waitForReady(key, { timeoutMs: WAIT_TIMEOUT_MS, intervalMs: 50, now: () => Date.now() })
      .catch(() => null);
    if (ready?.blobRef) {
      return {
        source: 'cache', blobRef: ready.blobRef, finalQuery: ready.finalQuery ?? '',
        rowCount: ready.rowCount ?? 0, colCount: ready.colCount ?? 0, cachedAt: ready.createdAt, fromCache: true,
      };
    }
    now = Date.now(); // winner died without a blob → re-claim
  }
  return runAndStore(key, opts, Date.now());
}

/**
 * Execute (streaming) and write-through to the blob store, never materializing.
 * EXECUTION errors propagate (→ 400). A cache-infra failure degrades: re-execute
 * and materialize so the caller still gets data, just uncached this round.
 */
async function runAndStore(key: string, opts: CachedExec, now: number): Promise<Resolved> {
  let stream: QueryStream;
  try {
    stream = await opts.execute();
  } catch (err) {
    await releaseLease(key).catch(() => { /* best effort */ });
    throw err; // execution failure → surfaced to the route as 400
  }
  try {
    const blobRef = blobRefForKey(key);
    const { readable, rowCount, colCount } = queryStreamToJsonl(stream);
    const { byteSize } = await store(opts).putStream(blobRef, readable); // connector → gzip → object store
    const rc = rowCount();
    await markReady(
      key,
      { blobRef, finalQuery: stream.finalQuery, rowCount: rc, colCount, byteSize, policy: opts.policy },
      Date.now(),
    );
    return { source: 'cache', blobRef, finalQuery: stream.finalQuery, rowCount: rc, colCount, cachedAt: now, fromCache: false };
  } catch {
    // Cache-infra failure (object store / DB) — degrade: re-execute, materialize,
    // serve directly (uncached). Bounded by the row cap.
    await releaseLease(key).catch(() => { /* best effort */ });
    const fresh = await drainQueryStream(await opts.execute());
    return { source: 'fresh', result: fresh, cachedAt: now };
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
    await runAndStore(key, opts, Date.now()).catch(() => { /* stale blob keeps serving */ });
  })().catch(() => { /* never surface to the request */ });
}

function metaOf(result: QueryResult, fromCache: boolean, cachedAt: number): CachedMeta {
  return { finalQuery: result.finalQuery, rowCount: result.rows.length, colCount: result.columns.length, fromCache, cachedAt };
}

function nowOf(opts: CachedExec): number {
  return opts.now?.() ?? Date.now();
}
