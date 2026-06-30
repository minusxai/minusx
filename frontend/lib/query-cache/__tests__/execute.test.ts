vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { getCachedResult, getCachedJsonlStream } from '../execute.server';
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
