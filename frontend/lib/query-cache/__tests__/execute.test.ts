
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { getCachedResult, getCachedJsonlStream, getCachedResultBounded, sweepExpiredBlobs, _resetSweepThrottleForTest, maybeSweepExpired } from '../execute.server';
import { createQueryCacheBlobStore } from '../blob-store';
import { decodeJsonl } from '../jsonl';
import type { ObjectStore } from '@/lib/object-store';
import { queryResultToStream, type QueryStream } from '@/lib/connections/base';
import type { CachePolicy } from '../types';
import { Readable } from 'stream';

function fakeObjectStore(): ObjectStore {
  const map = new Map<string, Buffer>();
  return {
    async put(key, body) { map.set(key, Buffer.from(body)); return `mem://${key}`; },
    async putStream(key, body) {
      const chunks: Buffer[] = [];
      for await (const c of body) chunks.push(Buffer.from(c));
      map.set(key, Buffer.concat(chunks));
    },
    async getStream(key) { const b = map.get(key); return b ? Readable.from([b]) : null; },
    async get(key) { return map.get(key) ?? null; },
    async delete(key) { map.delete(key); },
    async exists(key) { return map.has(key); },
    publicUrl(key) { return `mem://${key}`; },
    async getUploadUrl({ key }) { return { uploadUrl: `mem://${key}`, publicUrl: `mem://${key}` }; },
    async copyObject(src, dest) { const b = map.get(src); if (b) map.set(dest, b); },
  };
}

const POLICY: CachePolicy = { revalidateMs: 1000, expiryMs: 5000 };

function makeOpts(overrides: Partial<Parameters<typeof getCachedResult>[0]> = {}) {
  let calls = 0;
  const exec = vi.fn(async (): Promise<QueryStream> => {
    calls += 1;
    return queryResultToStream({ columns: ['n'], types: ['number'], rows: [{ n: calls }], finalQuery: `run-${calls}` });
  });
  const opts = {
    mode: 'org', connectionName: 'duckdb', query: 'SELECT 1', params: {}, policy: POLICY,
    execute: exec, blobStore: createQueryCacheBlobStore(fakeObjectStore()),
    ...overrides,
  };
  return { opts, exec };
}

async function clear() {
  const { getModules } = await import('@/lib/modules/registry');
  await getModules().db.exec('DELETE FROM query_cache');
}

/** Backdate a row's SWR windows to simulate aging. */
async function age(key: string, windows: { revalidateAt: number; expireAt: number }) {
  const { getModules } = await import('@/lib/modules/registry');
  await getModules().db.exec(
    'UPDATE query_cache SET revalidate_at = $2, expire_at = $3 WHERE cache_key = $1',
    [key, windows.revalidateAt, windows.expireAt],
  );
}

const KEY = 'org:'; // prefix; full key derived by hash — we DELETE-all between tests so any row is ours.
async function onlyKey(): Promise<string> {
  const { getModules } = await import('@/lib/modules/registry');
  const r = await getModules().db.exec<{ cache_key: string }>('SELECT cache_key FROM query_cache LIMIT 1');
  return r.rows[0].cache_key;
}

function tick(ms = 80) { return new Promise((r) => setTimeout(r, ms)); }

describe('executeQueryCached (SWR orchestration)', () => {
  setupTestDb(getTestDbPath('query_cache_execute'));
  beforeEach(clear);

  it('miss → executes once, caches; second call serves from cache (no execute)', async () => {
    const { opts, exec } = makeOpts();
    const first = await getCachedResult(opts);
    expect(first.meta.fromCache).toBe(false);
    expect(first.result.rows).toEqual([{ n: 1 }]);

    const second = await getCachedResult(opts);
    expect(second.meta.fromCache).toBe(true);
    expect(second.result.rows).toEqual([{ n: 1 }]); // same cached value
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('forceRefresh re-executes even when fresh, and refreshes the cached blob', async () => {
    const { opts, exec } = makeOpts();
    await getCachedResult(opts);                       // miss → n=1, cached
    await getCachedResult(opts);                       // fresh hit, no execute
    expect(exec).toHaveBeenCalledTimes(1);

    // "Run query": bypass the fresh serve, re-execute, update the cache.
    const forced = await getCachedResult({ ...opts, forceRefresh: true });
    expect(forced.meta.fromCache).toBe(false);
    expect(forced.result.rows).toEqual([{ n: 2 }]);    // freshly executed
    expect(exec).toHaveBeenCalledTimes(2);

    // A subsequent normal call now serves the REFRESHED value from cache.
    const after = await getCachedResult(opts);
    expect(after.meta.fromCache).toBe(true);
    expect(after.result.rows).toEqual([{ n: 2 }]);
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it('stale → serves cached value immediately AND revalidates in the background', async () => {
    const { opts, exec } = makeOpts();
    await getCachedResult(opts);              // populate (n=1)
    const key = await onlyKey();
    await age(key, { revalidateAt: 1, expireAt: Date.now() + 60_000 }); // stale, not expired

    const stale = await getCachedResult(opts);
    expect(stale.meta.fromCache).toBe(true);
    expect(stale.result.rows).toEqual([{ n: 1 }]); // OLD value served immediately
    await tick();                                  // let background revalidation finish
    expect(exec).toHaveBeenCalledTimes(2);         // refreshed once in the background

    const fresh = await getCachedResult(opts);     // now fresh again with n=2
    expect(fresh.meta.fromCache).toBe(true);
    expect(fresh.result.rows).toEqual([{ n: 2 }]);
  });

  it('expired → re-executes synchronously and returns the fresh value', async () => {
    const { opts, exec } = makeOpts();
    await getCachedResult(opts);            // n=1
    const key = await onlyKey();
    await age(key, { revalidateAt: 1, expireAt: 2 }); // fully expired

    const out = await getCachedResult(opts);
    expect(out.meta.fromCache).toBe(false);
    expect(out.result.rows).toEqual([{ n: 2 }]);
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it('concurrent misses execute once (lease dedup); both callers get the result', async () => {
    let calls = 0;
    const slowExec = vi.fn(async (): Promise<QueryStream> => {
      calls += 1; await tick(60);
      return queryResultToStream({ columns: ['n'], types: ['number'], rows: [{ n: calls }], finalQuery: `run-${calls}` });
    });
    const opts = {
      mode: 'org', connectionName: 'duckdb', query: 'SELECT 2', params: {}, policy: POLICY,
      execute: slowExec, blobStore: createQueryCacheBlobStore(fakeObjectStore()),
    };
    const [a, b] = await Promise.all([getCachedResult(opts), getCachedResult(opts)]);
    expect(slowExec).toHaveBeenCalledTimes(1);
    expect(a.result.rows).toEqual([{ n: 1 }]);
    expect(b.result.rows).toEqual([{ n: 1 }]);
  });

  it('DIFFERENT parameterTypes → DIFFERENT cache key (no wrong-typed blob collision)', async () => {
    // Same value "2024-01-01" but declared date vs text binds differently at the warehouse
    // (BigQuery DATE vs STRING) → different result. They must not share a blob.
    const base = { mode: 'org', connectionName: 'bq', query: 'SELECT :d', params: { d: '2024-01-01' }, policy: POLICY };
    const store = createQueryCacheBlobStore(fakeObjectStore());
    const execA = vi.fn(async (): Promise<QueryStream> =>
      queryResultToStream({ columns: ['a'], types: ['date'], rows: [{ a: 'DATE' }], finalQuery: 'as-date' }));
    const execB = vi.fn(async (): Promise<QueryStream> =>
      queryResultToStream({ columns: ['a'], types: ['text'], rows: [{ a: 'TEXT' }], finalQuery: 'as-text' }));

    const a = await getCachedResult({ ...base, blobStore: store, execute: execA, parameterTypes: { d: 'date' } });
    const b = await getCachedResult({ ...base, blobStore: store, execute: execB, parameterTypes: { d: 'text' } });

    expect(a.result.rows).toEqual([{ a: 'DATE' }]);
    expect(b.result.rows).toEqual([{ a: 'TEXT' }]); // NOT a's cached blob
    expect(execA).toHaveBeenCalledTimes(1);
    expect(execB).toHaveBeenCalledTimes(1);
    const { getModules } = await import('@/lib/modules/registry');
    const rows = await getModules().db.exec('SELECT cache_key FROM query_cache');
    expect(rows.rows.length).toBe(2); // two distinct keys
  });

  it('parameterTypes key is ORDER-INDEPENDENT (same map, different key order → same cache entry)', async () => {
    const base = { mode: 'org', connectionName: 'bq', query: 'SELECT :a, :b', params: { a: '1', b: '2' }, policy: POLICY };
    const store = createQueryCacheBlobStore(fakeObjectStore());
    const { opts: _o, exec } = makeOpts();
    const shared = { ...base, blobStore: store, execute: exec };
    await getCachedResult({ ...shared, parameterTypes: { a: 'number', b: 'date' } });
    const hit = await getCachedResult({ ...shared, parameterTypes: { b: 'date', a: 'number' } });
    expect(hit.meta.fromCache).toBe(true); // same logical types → one entry
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('DIFFERENT references → DIFFERENT cache key (composed-query collision)', async () => {
    // Same raw SQL + params but composed against different reference ids → different finalQuery.
    const base = { mode: 'org', connectionName: 'duckdb', query: 'SELECT * FROM base', params: {}, policy: POLICY };
    const store = createQueryCacheBlobStore(fakeObjectStore());
    const execA = vi.fn(async (): Promise<QueryStream> =>
      queryResultToStream({ columns: ['n'], types: ['number'], rows: [{ n: 5 }], finalQuery: 'via-5' }));
    const execB = vi.fn(async (): Promise<QueryStream> =>
      queryResultToStream({ columns: ['n'], types: ['number'], rows: [{ n: 6 }], finalQuery: 'via-6' }));

    const a = await getCachedResult({ ...base, blobStore: store, execute: execA, references: [{ id: 5, alias: 'r' }] });
    const b = await getCachedResult({ ...base, blobStore: store, execute: execB, references: [{ id: 6, alias: 'r' }] });

    expect(a.result.rows).toEqual([{ n: 5 }]);
    expect(b.result.rows).toEqual([{ n: 6 }]); // NOT a's blob
    expect(execA).toHaveBeenCalledTimes(1);
    expect(execB).toHaveBeenCalledTimes(1);
  });

  it('no parameterTypes / no references → key unchanged (back-compat, still one entry)', async () => {
    const { opts, exec } = makeOpts();
    await getCachedResult(opts);
    const second = await getCachedResult(opts);
    expect(second.meta.fromCache).toBe(true);
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('getCachedResultBounded caps rows on a MISS but reports the true total via meta.rowCount', async () => {
    const bigExec = vi.fn(async (): Promise<QueryStream> => queryResultToStream({
      columns: ['n'], types: ['number'],
      rows: Array.from({ length: 500 }, (_, i) => ({ n: i })), finalQuery: 'big',
    }));
    const opts = {
      mode: 'org', connectionName: 'duckdb', query: 'SELECT big', params: {}, policy: POLICY,
      execute: bigExec, blobStore: createQueryCacheBlobStore(fakeObjectStore()),
    };
    const out = await getCachedResultBounded(opts, { maxRows: 10 });
    expect(out.result.rows.length).toBe(10);   // only 10 materialized
    expect(out.truncated).toBe(true);
    // The blob still holds all 500; a normal read proves it, and meta.rowCount is authoritative.
    const full = await getCachedResult(opts);
    expect(full.result.rows.length).toBe(500);
    expect(full.meta.rowCount).toBe(500);
  });

  it('getCachedResultBounded caps rows on a cache HIT (bounded blob read) with true total in meta', async () => {
    const bigExec = vi.fn(async (): Promise<QueryStream> => queryResultToStream({
      columns: ['n'], types: ['number'],
      rows: Array.from({ length: 300 }, (_, i) => ({ n: i })), finalQuery: 'big',
    }));
    const opts = {
      mode: 'org', connectionName: 'duckdb', query: 'SELECT hit', params: {}, policy: POLICY,
      execute: bigExec, blobStore: createQueryCacheBlobStore(fakeObjectStore()),
    };
    await getCachedResult(opts);                 // populate the blob (300 rows)
    const bounded = await getCachedResultBounded(opts, { maxRows: 5 });
    expect(bounded.meta.fromCache).toBe(true);
    expect(bounded.result.rows.length).toBe(5);  // bounded blob read
    expect(bounded.truncated).toBe(true);
    expect(bounded.meta.rowCount).toBe(300);     // authoritative full total from the cache row
    expect(bigExec).toHaveBeenCalledTimes(1);    // hit — no re-execute
  });

  it('getCachedResultBounded returns everything untruncated when under budget', async () => {
    const { opts } = makeOpts(); // 1 row
    const out = await getCachedResultBounded(opts, { maxRows: 100, maxBytes: 1_000_000 });
    expect(out.result.rows).toEqual([{ n: 1 }]);
    expect(out.truncated).toBe(false);
  });

  it('sweepExpiredBlobs deletes expired cache rows AND their orphaned blobs', async () => {
    const store = createQueryCacheBlobStore(fakeObjectStore());
    const opts = { mode: 'org', connectionName: 'duckdb', query: 'SELECT sweep', params: {}, policy: POLICY, execute: makeOpts().exec, blobStore: store };
    await getCachedResult(opts);            // populate a blob
    const key = await onlyKey();
    const row = (await import('../store.server')).getCacheRow;
    const blobRef = (await row(key))!.blobRef!;
    expect(await store.getResult(blobRef)).not.toBeNull(); // blob exists

    await age(key, { revalidateAt: 1, expireAt: 2 }); // hard-expired
    const deleted = await sweepExpiredBlobs(store, Date.now());
    expect(deleted).toContain(blobRef);
    expect(await store.getResult(blobRef)).toBeNull();     // blob gone
    const { getModules } = await import('@/lib/modules/registry');
    const rows = await getModules().db.exec('SELECT cache_key FROM query_cache WHERE cache_key = $1', [key]);
    expect(rows.rows.length).toBe(0);                       // row gone
  });

  it('maybeSweepExpired runs once then is throttled until the interval passes', async () => {
    _resetSweepThrottleForTest();
    const store = createQueryCacheBlobStore(fakeObjectStore());
    let sweeps = 0;
    const nowRef = { t: 1_000_000 };
    const run = () => maybeSweepExpired(store, nowRef.t, () => { sweeps++; return Promise.resolve([]); });
    await run(); await run(); await run();       // three calls, same instant
    expect(sweeps).toBe(1);                        // throttled to one
    nowRef.t += 11 * 60_000;                       // past the 10-min interval
    await run();
    expect(sweeps).toBe(2);                        // fires again
  });

  it('getCachedJsonlStream returns a JSONL body that decodes to the result', async () => {
    const { opts } = makeOpts();
    const { stream, meta } = await getCachedJsonlStream(opts);
    const chunks: Buffer[] = [];
    for await (const c of stream as Readable) chunks.push(Buffer.from(c));
    const decoded = decodeJsonl(Buffer.concat(chunks).toString('utf8'));
    expect(decoded.rows).toEqual([{ n: 1 }]);
    expect(meta.rowCount).toBe(1);
    // Second call streams from the cached blob.
    const again = await getCachedJsonlStream(opts);
    expect(again.meta.fromCache).toBe(true);
  });
});
