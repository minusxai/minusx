/**
 * Deduplicated requests must not leak an "Unhandled promise rejection" when they fail.
 *
 * Regression: the in-flight registry cleaned up with `promise.finally(() => delete)`. `.finally`
 * returns a NEW promise that inherits the original's rejection, and nothing awaited it — so a failed
 * deduplicated request (e.g. the feed_summary 500) surfaced as an unhandled rejection in the console
 * even though every real caller wrapped it in try/catch. Cleanup must not branch a floating chain.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchWithCache } from '@/lib/http/fetch-wrapper';

const DEDUP = { cacheStrategy: { ttl: 0, deduplicate: true } as const };

let unhandled: unknown[] = [];
const onUnhandled = (e: PromiseRejectionEvent) => { unhandled.push(e.reason); e.preventDefault?.(); };

beforeEach(() => {
  unhandled = [];
  if (typeof window !== 'undefined') window.addEventListener('unhandledrejection', onUnhandled);
});
afterEach(() => {
  if (typeof window !== 'undefined') window.removeEventListener('unhandledrejection', onUnhandled);
  vi.restoreAllMocks();
});

/** Let the microtask queue + the unhandledrejection callback (a macrotask) flush. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('fetchWithCache — deduplicated failures', () => {
  it('a rejecting deduplicated request produces NO unhandled rejection (all callers catch it)', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) }) as Response) as never;

    // Two concurrent callers of the same key → the second is deduplicated onto the first's promise.
    const a = fetchWithCache('/api/micro-task', { method: 'POST', body: '{}', ...DEDUP }).catch((e) => e);
    const b = fetchWithCache('/api/micro-task', { method: 'POST', body: '{}', ...DEDUP }).catch((e) => e);
    await Promise.all([a, b]);
    await flush();

    expect(unhandled).toEqual([]); // the cleanup chain must not reject unhandled
  });

  it('the in-flight entry is cleared after failure so a later call re-fetches', async () => {
    let calls = 0;
    global.fetch = vi.fn(async () => { calls++; return ({ ok: false, status: 500, json: async () => ({}) }) as Response; }) as never;

    await fetchWithCache('/api/x', { ...DEDUP }).catch(() => {});
    await flush();
    await fetchWithCache('/api/x', { ...DEDUP }).catch(() => {});
    expect(calls).toBe(2); // not deduplicated onto a settled+removed promise
  });

  it('the caller still receives the rejection (dedup does not swallow the error)', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: 'nope' }) }) as Response) as never;
    await expect(fetchWithCache('/api/y', { ...DEDUP })).rejects.toBeTruthy();
    await flush();
    expect(unhandled).toEqual([]);
  });
});
