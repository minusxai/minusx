/**
 * LLM BOUNDARY — transient single-call retry policy.
 *
 * A streaming LLM request can die mid-flight with a transient transport failure — most notably
 * "OpenAI Responses stream ended before a terminal response event" (a premature SSE close), which
 * pi-ai surfaces as an `{ type: 'error', reason: 'error' }` stream event. The failure is a property
 * of ONE request, so the correct place to recover is around that one call (`Orchestrator.callLLM`) —
 * NOT by replaying the whole turn (which would re-execute tools, leave resume turns unfixable, and
 * cost the full context each time). This module is the pure, testable policy that call site consults.
 *
 * Self-contained by design: no dependency on the app layer (`lib/chat/*`). The engine owns its own
 * transient-failure handling so every consumer (agents, sub-agents, resume, headless, benchmark)
 * inherits it for free.
 */

/** How many times a single LLM call may be re-issued after a transient stream drop. Small on purpose:
 *  a DETERMINISTIC failure (e.g. context too large → always times out before first token) would just
 *  re-send the same request and fail again, at N× input cost. Retries rescue RANDOM blips, not that. */
export const MAX_LLM_CALL_RETRIES = 2;

/** Backoff before re-issuing the failed call (attempt is the 0-based index that just failed). */
export function retryBackoffMs(attempt: number): number {
  return 250 * 2 ** attempt; // 250ms, 500ms
}

/**
 * A POSITIVE allowlist of transient stream / transport drops worth re-issuing. Positive (not
 * "anything that isn't terminal") so an unknown error, a user cancellation, or a bad request never
 * silently re-runs. Terminal errors (context-length / auth / bad request) simply don't match any
 * pattern. Mirrors the upstream provider-transport retry signals (pi-ai's
 * RETRYABLE_PROVIDER_ERROR_PATTERN).
 */
const RETRYABLE_STREAM_ERROR_PATTERNS: RegExp[] = [
  // Premature stream termination — the reported flood and its siblings.
  /stream ended before/i,
  /ended without/i,
  /terminal response event/i,
  /premature (?:close|eof|end)/i,
  /unexpected (?:end|eof)/i,
  // Provider overload / server-side transient (5xx + Cloudflare 524).
  /\boverloaded\b/i,
  /\b(?:429|500|502|503|504|524)\b/i,
  /rate.?limit/i,
  /too many requests/i,
  /service.?unavailable/i,
  /server.?error/i,
  /internal.?error/i,
  // Network / transport drops.
  /fetch failed/i,
  /socket hang up/i,
  /connection (?:reset|refused|closed|error)/i,
  /econnreset|econnrefused|epipe|etimedout/i,
  /network.?error/i,
  /\btimed?.?out\b/i,
  /\btimeout\b/i,
  /\bterminated\b/i,
  /http2 request did not get a response/i,
];

export function isRetryableStreamError(errorMessage: string | null | undefined): boolean {
  if (!errorMessage) return false;
  return RETRYABLE_STREAM_ERROR_PATTERNS.some((re) => re.test(errorMessage));
}

/**
 * True for a stream event whose content is USER-VISIBLE mid-stream — the only emissions that make a
 * re-issue unsafe (a retry restarts the assistant message, so anything already shown would render
 * twice; there is no mid-turn delta reset). Concretely:
 *  - `text_*` / `thinking_*` deltas and finalized blocks with non-whitespace content ARE visible:
 *    the turn runner forwards text/thinking deltas to the client as live typing.
 *  - `toolcall_*` events are NOT: tool-call argument streaming never reaches a user surface — tool
 *    activity renders only from COMMITTED log entries, and a failed attempt's partial message is
 *    discarded (never logged, never committed). This is the common agentic-turn drop (mid
 *    tool-call args), so it stays retryable.
 *  - Structural events (`start`, `*_start`) and the terminal `done`/`error` carry no content.
 */
export function isUserVisibleStreamEvent(ev: { type: string; delta?: string; content?: string }): boolean {
  switch (ev.type) {
    case 'text_delta':
    case 'thinking_delta':
      return (ev.delta ?? '').trim() !== '';
    case 'text_end':
    case 'thinking_end':
      return (ev.content ?? '').trim() !== '';
    default:
      return false;
  }
}

/**
 * The complete decision to re-issue a failed LLM call — pure and fully testable.
 *  - `reason === 'error'` only: a `'aborted'` event is a user Stop, never retried (STRUCTURAL guard —
 *    pi-ai sets reason from `signal.aborted`, so we don't string-match "aborted"/"terminated").
 *  - `!aborted`: belt-and-suspenders for a Stop that lands between the event and this check.
 *  - `!emitted`: never retry after USER-VISIBLE content has streamed (see
 *    `isUserVisibleStreamEvent` — tool-arg deltas don't count, so mid-tool-call drops retry).
 *  - `attempt < maxRetries`: bounded so it always converges.
 *  - `isRetryableStreamError`: the transient-transport allowlist.
 */
export function shouldRetryLlmCall(opts: {
  reason: 'aborted' | 'error' | undefined;
  emitted: boolean;
  aborted: boolean;
  errorMessage: string | null | undefined;
  attempt: number;
  maxRetries: number;
}): boolean {
  const { reason, emitted, aborted, errorMessage, attempt, maxRetries } = opts;
  if (reason !== 'error') return false;
  if (aborted) return false;
  if (emitted) return false;
  if (attempt >= maxRetries) return false;
  return isRetryableStreamError(errorMessage);
}

/** A cancellable delay: resolves after `ms`, or immediately when `signal` aborts. */
export function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const onAbort = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
