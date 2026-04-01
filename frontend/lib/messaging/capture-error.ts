/**
 * Client-side utility for reporting frontend errors to the bug reporting channel.
 * Calls POST /api/capture-error, which forwards to the bug reporting channel server-side.
 * Safe for client imports — no server-only code here.
 */
export async function captureError(
  source: string,
  error: unknown,
  context?: Record<string, unknown>,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const stack   = error instanceof Error ? error.stack   : undefined;
  try {
    await fetch('/api/capture-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source,
        message,
        stack,
        context: { url: typeof window !== 'undefined' ? window.location.href : undefined, ...context },
      }),
    });
  } catch {
    // best effort — never throw from error reporter
  }
}
