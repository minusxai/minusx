/**
 * captureError — retries a failed report with backoff.
 *
 * The report POST goes to the same origin that may be down (that's exactly
 * what produces a client "Failed to fetch"). A single best-effort POST is lost
 * if the backend is briefly unreachable. captureError now retries with
 * exponential backoff so a transient outage that recovers within a few minutes
 * still gets the report through, while a permanently-down backend gives up
 * after a bounded number of attempts.
 */

import { captureError, MAX_CAPTURE_ATTEMPTS, BASE_RETRY_DELAY_MS } from '@/lib/messaging/capture-error';

function captureCallCount(fetchMock: ReturnType<typeof vi.fn>): number {
  return fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/capture-error')).length;
}

// First retry fires in [BASE, 2*BASE) thanks to jitter. These bounds are
// jitter-safe: strictly below BASE it can't have fired; at/after 2*BASE it must have.
const BEFORE_FIRST_RETRY = BASE_RETRY_DELAY_MS - 1_000;
const AFTER_FIRST_RETRY = BASE_RETRY_DELAY_MS * 2;
// Generous window to step past every backoff delay (incl. jitter) in one go.
const ADVANCE_ALL_MS = 30 * 60_000;

describe('captureError — retry with backoff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('sends exactly once when the first POST succeeds (no retry scheduled)', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }) as Response);
    vi.stubGlobal('fetch', fetchMock);

    await captureError('retry-test:ok', new Error('boom-ok'));
    expect(captureCallCount(fetchMock)).toBe(1);

    // No retry should ever fire after a success.
    await vi.advanceTimersByTimeAsync(ADVANCE_ALL_MS);
    expect(captureCallCount(fetchMock)).toBe(1);
  });

  it('waits for the backoff window before retrying a failed POST', async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('Failed to fetch'); // backend briefly down
      return { ok: true, status: 200 } as Response;            // recovered
    });
    vi.stubGlobal('fetch', fetchMock);

    await captureError('retry-test:recover', new Error('boom-recover'));
    // Initial attempt fired immediately; nothing else yet.
    expect(captureCallCount(fetchMock)).toBe(1);

    // The retry must NOT fire before the backoff delay elapses.
    await vi.advanceTimersByTimeAsync(BEFORE_FIRST_RETRY);
    expect(captureCallCount(fetchMock)).toBe(1);

    // After the backoff window, the retry fires and succeeds — no further attempts.
    await vi.advanceTimersByTimeAsync(AFTER_FIRST_RETRY);
    expect(captureCallCount(fetchMock)).toBe(2);

    await vi.advanceTimersByTimeAsync(ADVANCE_ALL_MS);
    expect(captureCallCount(fetchMock)).toBe(2);
  });

  it('gives up after MAX_CAPTURE_ATTEMPTS when every POST fails', async () => {
    const fetchMock = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    vi.stubGlobal('fetch', fetchMock);

    await captureError('retry-test:down', new Error('boom-down'));
    await vi.advanceTimersByTimeAsync(ADVANCE_ALL_MS);

    expect(captureCallCount(fetchMock)).toBe(MAX_CAPTURE_ATTEMPTS);
  });
});
