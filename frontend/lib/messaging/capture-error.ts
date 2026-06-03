/**
 * Client-side utility for reporting frontend errors to the bug reporting channel.
 * Calls POST /api/capture-error, which forwards to the bug reporting channel server-side.
 * Safe for client imports — no server-only code here.
 *
 * The report POST targets the same origin that may be down (the usual cause of
 * a client "Failed to fetch"), so a single send is easily lost. We retry with
 * exponential backoff + jitter so a transient outage that recovers within a
 * few minutes still gets the report through, giving up after a bounded number
 * of attempts. This is in-memory only — a reload drops pending retries.
 */

const DEDUP_WINDOW_MS = 60_000;

/** Total send attempts (1 initial + retries) before giving up. */
export const MAX_CAPTURE_ATTEMPTS = 5;
export const BASE_RETRY_DELAY_MS = 5_000;

// eslint-disable-next-line no-restricted-syntax -- client-side per-tab dedup cache; not shared across server requests
const recentlySent = new Map<string, number>();

async function postReport(body: string): Promise<void> {
  const res = await fetch('/api/capture-error', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  if (!res.ok) throw new Error(`capture-error responded ${res.status}`);
}

// attempt is 1-based for the send that just failed; schedules the next one.
function scheduleRetry(body: string, attempt: number): void {
  if (attempt >= MAX_CAPTURE_ATTEMPTS) return;
  const delay = BASE_RETRY_DELAY_MS * 2 ** (attempt - 1) + Math.random() * BASE_RETRY_DELAY_MS;
  setTimeout(() => { void sendWithRetry(body, attempt + 1); }, delay);
}

async function sendWithRetry(body: string, attempt: number): Promise<void> {
  try {
    await postReport(body);
  } catch {
    scheduleRetry(body, attempt); // best effort — never throw from error reporter
  }
}

export async function captureError(
  source: string,
  error: unknown,
  context?: Record<string, unknown>,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const stack   = error instanceof Error ? error.stack   : undefined;

  const key = `${source}:${message}`;
  const now = Date.now();
  if ((recentlySent.get(key) ?? 0) + DEDUP_WINDOW_MS > now) return;
  recentlySent.set(key, now);

  const body = JSON.stringify({
    source,
    message,
    stack,
    context: { url: typeof window !== 'undefined' ? window.location.href : undefined, ...context },
  });
  await sendWithRetry(body, 1);
}
