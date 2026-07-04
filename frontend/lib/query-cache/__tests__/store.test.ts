
import { describe, it, expect, beforeEach } from 'vitest';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import {
  claimLease, getCacheRow, markReady, releaseLease, waitForReady, sweepExpired, renewLease,
} from '../store.server';
import { QUERY_CACHE_LEASE_MS } from '@/lib/config';
import { classifyCacheRow } from '../swr';
import type { CachePolicy } from '../types';

const TEST_DB_PATH = getTestDbPath('query_cache_store');
const POLICY: CachePolicy = { revalidateMs: 1000, expiryMs: 5000 };
const INIT = { query: 'SELECT 1', connectionName: 'duckdb', params: {}, policy: POLICY };

async function clear() {
  const { getModules } = await import('@/lib/modules/registry');
  await getModules().db.exec('DELETE FROM query_cache');
}

describe('QueryCacheStore (lease + SWR windows)', () => {
  setupTestDb(TEST_DB_PATH);
  beforeEach(clear);

  it('first claim wins by inserting a pending row', async () => {
    const c = await claimLease('m:k1', INIT, 1000);
    expect(c.won).toBe(true);
    expect(c.row.status).toBe('pending');
    expect(c.row.blobRef).toBeNull();
    expect(c.row.revalidateAt).toBe(1000 + POLICY.revalidateMs);
    expect(c.row.expireAt).toBe(1000 + POLICY.expiryMs);
  });

  it('a concurrent claim loses while the lease is live', async () => {
    const a = await claimLease('m:k2', INIT, 1000);
    const b = await claimLease('m:k2', INIT, 1000); // lease still live (leaseExpiresAt > now)
    expect(a.won).toBe(true);
    expect(b.won).toBe(false);
    expect(b.row.cacheKey).toBe('m:k2');
  });

  it('markReady stores the blob + windows and frees the lease', async () => {
    await claimLease('m:k3', INIT, 1000);
    await markReady('m:k3', {
      blobRef: 'query-cache/abc.jsonl.gz', finalQuery: 'SELECT 1', rowCount: 1, colCount: 1, byteSize: 42, policy: POLICY,
    }, 2000);
    const row = (await getCacheRow('m:k3'))!;
    expect(row.status).toBe('ready');
    expect(row.blobRef).toBe('query-cache/abc.jsonl.gz');
    expect(row.rowCount).toBe(1);
    expect(row.byteSize).toBe(42);
    expect(row.revalidateAt).toBe(2000 + POLICY.revalidateMs);
    expect(row.leaseExpiresAt).toBe(0); // lease freed → re-claimable for next revalidation
  });

  it('a ready row is re-claimable (lease freed) — stale revalidation can win', async () => {
    await claimLease('m:k4', INIT, 1000);
    await markReady('m:k4', { blobRef: 'r', finalQuery: 'q', rowCount: 0, colCount: 0, byteSize: 1, policy: POLICY }, 2000);
    // A later revalidation claim wins because the lease was freed (0 < now).
    const reval = await claimLease('m:k4', INIT, 9000);
    expect(reval.won).toBe(true);
    // ...but it kept the existing blob_ref intact while refreshing.
    expect(reval.row.blobRef).toBe('r');
  });

  it('a live lease blocks even an expired-window row until the lease passes', async () => {
    await claimLease('m:k5', INIT, 1000); // lease until 1000 + LEASE_MS (minutes)
    const concurrent = await claimLease('m:k5', INIT, 1500);
    expect(concurrent.won).toBe(false);
  });

  it('classifyCacheRow maps windows to states', async () => {
    await claimLease('m:k6', INIT, 1000);
    await markReady('m:k6', { blobRef: 'r', finalQuery: 'q', rowCount: 0, colCount: 0, byteSize: 1, policy: POLICY }, 1000);
    const row = (await getCacheRow('m:k6'))!;
    expect(classifyCacheRow(row, 1500)).toBe('fresh');   // < revalidateAt (2000)
    expect(classifyCacheRow(row, 3000)).toBe('stale');   // < expireAt (6000)
    expect(classifyCacheRow(row, 7000)).toBe('expired'); // >= expireAt
    expect(classifyCacheRow(null, 1)).toBe('miss');
  });

  it('waitForReady resolves once the holder marks ready', async () => {
    // Use real wall-clock for this one so the lease (now + LEASE_MS) is genuinely
    // in the future relative to waitForReady's now() — mirrors production.
    const t0 = Date.now();
    await claimLease('m:k7', INIT, t0);
    const waiter = waitForReady('m:k7', { timeoutMs: 2000, intervalMs: 10, now: () => Date.now() });
    setTimeout(() => {
      void markReady('m:k7', { blobRef: 'r', finalQuery: 'q', rowCount: 0, colCount: 0, byteSize: 1, policy: POLICY }, Date.now());
    }, 40);
    const row = await waiter;
    expect(row?.status).toBe('ready');
    expect(row?.blobRef).toBe('r');
  });

  it('releaseLease lets the next caller re-claim after a failed execution', async () => {
    await claimLease('m:k8', INIT, 1000);
    await releaseLease('m:k8'); // execution failed
    const retry = await claimLease('m:k8', INIT, 1100);
    expect(retry.won).toBe(true);
  });

  it('renewLease pushes lease_expires_at forward without touching blob/status/windows', async () => {
    await claimLease('m:hb', INIT, 1000);
    await markReady('m:hb', { blobRef: 'r', finalQuery: 'q', rowCount: 2, colCount: 1, byteSize: 9, policy: POLICY }, 1000);
    // Re-claim (a revalidation) so there's a live lease to renew.
    await claimLease('m:hb', INIT, QUERY_CACHE_LEASE_MS + 2000);
    const before = (await getCacheRow('m:hb'))!;
    await renewLease('m:hb', before.leaseExpiresAt + 5000);
    const after = (await getCacheRow('m:hb'))!;
    expect(after.leaseExpiresAt).toBe(before.leaseExpiresAt + 5000 + QUERY_CACHE_LEASE_MS);
    expect(after.blobRef).toBe('r');          // untouched
    expect(after.rowCount).toBe(2);           // untouched
    expect(after.revalidateAt).toBe(before.revalidateAt); // SWR windows untouched
  });

  it('a heartbeat-renewed lease keeps blocking stealers PAST the original lease window', async () => {
    // The stampede fix: an executor running longer than one lease window renews its lease,
    // so a waiter cannot steal it and double-run mid-execution.
    await claimLease('m:hb2', INIT, 1000);
    // Simulate the executor heartbeating right before the original lease would lapse.
    await renewLease('m:hb2', 1000 + QUERY_CACHE_LEASE_MS - 1);
    // A stealer arriving just after the ORIGINAL lease window still loses (renewed lease is live).
    const stealer = await claimLease('m:hb2', INIT, 1000 + QUERY_CACHE_LEASE_MS + 10);
    expect(stealer.won).toBe(false);
  });

  it('renewLease is a no-op on a freed (ready) lease — never resurrects a completed row', async () => {
    await claimLease('m:hb3', INIT, 1000);
    await markReady('m:hb3', { blobRef: 'r', finalQuery: 'q', rowCount: 0, colCount: 0, byteSize: 1, policy: POLICY }, 1000);
    await renewLease('m:hb3', 9999); // lease is 0 (freed) — must not extend it
    const row = (await getCacheRow('m:hb3'))!;
    expect(row.leaseExpiresAt).toBe(0);
  });

  it('sweepExpired deletes expired rows and returns their blob refs', async () => {
    await claimLease('m:k9', INIT, 1000);
    await markReady('m:k9', { blobRef: 'blob-9', finalQuery: 'q', rowCount: 0, colCount: 0, byteSize: 1, policy: POLICY }, 1000);
    // expireAt = 1000 + 5000 = 6000
    const refs = await sweepExpired(7000);
    expect(refs).toContain('blob-9');
    expect(await getCacheRow('m:k9')).toBeNull();
  });
});
