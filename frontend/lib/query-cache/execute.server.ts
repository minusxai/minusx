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
import { drainQueryStream, drainQueryStreamBounded, type QueryResult, type QueryStream, type BoundedDrainOptions } from '@/lib/connections/base';
import { getQueryHash, hashContent } from '@/lib/utils/query-hash';
import { sortObjectKeysDeep } from '@/lib/api/file-encoding';
import { createQueryCacheBlobStore, blobRefForKey } from './blob-store';
import { resultToJsonlStream, queryStreamToJsonl } from './jsonl-stream.server';
import { classifyCacheRow } from './swr';
import {
  claimLease, getCacheRow, markReady, releaseLease, waitForReady, renewLease, sweepExpired,
} from './store.server';
import { QUERY_CACHE_LEASE_MS, QUERY_SERVER_TIMEOUT_MS } from '@/lib/config';
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
  /**
   * Declared param TYPES ('text'|'number'|'date'). They change how the SAME param value binds at
   * the warehouse (BigQuery DATE vs STRING) → different result. Folded into the cache key so a
   * differently-typed request can't read a wrong-typed blob. Order-independent.
   */
  parameterTypes?: Record<string, string>;
  /**
   * Composed-query references ({id, alias}). The route CTE-composes these into a different final
   * SQL, so two requests with identical raw SQL+params but different refs must not share a blob.
   * Keyed by id+alias in order (order affects the composed SQL).
   */
  references?: Array<{ id: number; alias?: string }>;
  /**
   * Force a fresh execution that refreshes the cache, bypassing the fresh/stale
   * serve (the "Run query" button). Still lease-guarded, so concurrent forced
   * runs don't stampede the warehouse.
   */
  forceRefresh?: boolean;
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

/**
 * A loser's per-attempt wait for the winner's blob. Must exceed the max time a legitimate execution
 * can take (query timeout + one lease window of crash-detection slack), so a waiter never gives up
 * on a still-running winner and stampedes the warehouse. The winner heartbeats its lease
 * (see runAndStore), so within one attempt a waiter either sees the blob or detects a genuinely
 * dead lease (crash) and re-claims — it never times out against a live, working holder.
 */
const WAIT_TIMEOUT_MS = QUERY_SERVER_TIMEOUT_MS + QUERY_CACHE_LEASE_MS;
const MAX_LEASE_ATTEMPTS = 3;
/** Renew the lease at 1/3 of its window so it never lapses mid-execution (2+ renews per window). */
const HEARTBEAT_MS = Math.max(5_000, Math.floor(QUERY_CACHE_LEASE_MS / 3));

function cacheKey(opts: CachedExec): string {
  const base = `${opts.mode}:${getQueryHash(opts.query, opts.params, opts.connectionName)}`;
  // Fold in the facets getQueryHash omits but that change the executed SQL/result. Omit the suffix
  // entirely when neither is present so existing keys are unchanged (back-compat, no needless
  // cold cache for the common no-refs/no-types case). parameterTypes canonicalized (key-sorted)
  // so map order doesn't fork the key; references kept in order (order affects composition).
  const hasTypes = opts.parameterTypes && Object.keys(opts.parameterTypes).length > 0;
  const hasRefs = opts.references && opts.references.length > 0;
  if (!hasTypes && !hasRefs) return base;
  const extra = hashContent({
    t: hasTypes ? sortObjectKeysDeep(opts.parameterTypes) : null,
    r: hasRefs ? opts.references!.map((r) => [r.id, r.alias ?? null]) : null,
  });
  return `${base}:${extra}`;
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

/**
 * Like {@link getCachedResult} but materializes only up to a row/byte budget — for agent consumers
 * that truncate to a character budget anyway. Peak RAM is the budget, not the full result (which
 * still lives fully + streamed in the blob). `meta.rowCount` stays AUTHORITATIVE (the full total
 * from the cache row / header), so the agent can still be told the true size while holding few rows;
 * `truncated` says the returned rows were clipped.
 */
export async function getCachedResultBounded(
  opts: CachedExec,
  budget: BoundedDrainOptions,
): Promise<{ result: QueryResult; meta: CachedMeta; truncated: boolean }> {
  const r = await resolve(opts);
  if (r.source === 'fresh') {
    // Degrade path: the result is already materialized in RAM, so just clip the array (no benefit
    // to re-streaming). meta.rowCount reflects the FULL result; truncated iff we clipped.
    const clipped = clipRows(r.result, budget);
    return { result: clipped.result, meta: metaOf(r.result, false, r.cachedAt), truncated: clipped.truncated };
  }
  const bounded = await store(opts).getResultBounded(r.blobRef, budget);
  if (bounded) {
    return {
      result: bounded,
      // rowCount from the cache row is the FULL total, even though we only hold `bounded.rows`.
      meta: { finalQuery: r.finalQuery, rowCount: r.rowCount, colCount: r.colCount, fromCache: r.fromCache, cachedAt: r.cachedAt },
      truncated: bounded.truncated || (r.rowCount > bounded.rows.length),
    };
  }
  const b = await drainQueryStreamBounded(await opts.execute(), budget);
  return { result: b, meta: metaOf(b, false, nowOf(opts)), truncated: b.truncated };
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

  // Opportunistic, throttled GC of hard-expired rows + blobs (no cron in this deployment).
  maybeSweepExpired(store(opts), now);

  // forceRefresh ("Run query") skips the fresh/stale serve and re-executes,
  // refreshing the cached blob (still lease-guarded inside executeWithLease).
  if (!opts.forceRefresh) {
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
  // Heartbeat the lease for the whole execution+write so it never lapses while we're working
  // (a lapsed lease lets a waiter steal it and run a duplicate query). Cleared in `finally`.
  const heartbeat = setInterval(() => {
    void renewLease(key, nowOf(opts)).catch(() => { /* best effort; a missed beat just risks a steal */ });
  }, HEARTBEAT_MS);
  if (typeof heartbeat === 'object' && 'unref' in heartbeat) heartbeat.unref?.();
  try {
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
  } finally {
    clearInterval(heartbeat);
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

/** Clip an already-materialized result to a row/byte budget (degrade path — rows already in RAM). */
function clipRows(result: QueryResult, { maxRows = Infinity, maxBytes = Infinity }: BoundedDrainOptions): { result: QueryResult; truncated: boolean } {
  const rows: Record<string, unknown>[] = [];
  let bytes = 0;
  for (const row of result.rows) {
    if (rows.length >= maxRows || bytes >= maxBytes) break;
    bytes += Buffer.byteLength(JSON.stringify(row), 'utf8');
    rows.push(row);
  }
  return { result: { ...result, rows }, truncated: rows.length < result.rows.length };
}

function metaOf(result: QueryResult, fromCache: boolean, cachedAt: number): CachedMeta {
  return { finalQuery: result.finalQuery, rowCount: result.rows.length, colCount: result.columns.length, fromCache, cachedAt };
}

function nowOf(opts: CachedExec): number {
  return opts.now?.() ?? Date.now();
}

// ── Opportunistic GC ───────────────────────────────────────────────────────────
// There is no cron in this deployment, so hard-expired cache rows + their blobs are swept lazily
// from the hot path: at most once per SWEEP_INTERVAL_MS, fire-and-forget, best-effort. This keeps
// the query_cache table and the object store from growing unbounded without a scheduler.

const SWEEP_INTERVAL_MS = 10 * 60_000;
let lastSweepAt = 0;

/** Test hook — reset the throttle so a test can drive the sweep deterministically. */
export function _resetSweepThrottleForTest(): void { lastSweepAt = 0; }

/** Delete hard-expired cache rows and their orphaned blobs. Returns the blob refs removed. */
export async function sweepExpiredBlobs(store: QueryCacheBlobStore, now: number): Promise<string[]> {
  const refs = await sweepExpired(now);
  await Promise.all(refs.map((r) => store.delete(r).catch(() => { /* best effort */ })));
  return refs;
}

/**
 * Throttled, fire-and-forget sweep for the hot path. `sweep` is injectable for tests; production
 * passes `sweepExpired`. Never awaited by the request, never throws into it.
 */
export function maybeSweepExpired(
  store: QueryCacheBlobStore,
  now: number,
  sweep: (now: number) => Promise<string[]> = sweepExpired,
): void {
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;
  void (async () => {
    const refs = await sweep(now);
    await Promise.all(refs.map((r) => store.delete(r).catch(() => { /* best effort */ })));
  })().catch(() => { /* GC is best-effort; never surface to the request */ });
}
