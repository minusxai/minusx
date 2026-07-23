/**
 * Two-way classification of a chat turn error into whether retrying it can plausibly succeed.
 *
 * The chat UI turns a failed turn into either a "Try again" affordance or a dead end. Retrying is
 * only worth offering when the failure was TRANSIENT (a blip that a clean re-run can clear); when the
 * failure is TERMINAL (the same request will deterministically fail again) we must NOT show "Try
 * again" — the historical bug was a large-context error where clicking "Try again" just re-failed,
 * because there is no context compaction to make the retry succeed. Those cases route the user to a
 * fresh conversation instead.
 *
 * Classification is string-based by necessity: the provider SDK errors (Anthropic/OpenAI via pi-ai)
 * surface only a `message` string, which embeds the status + error-type as a stringified JSON blob.
 * There is no structured status to switch on, so we match the message text.
 *
 * Default is TRANSIENT — an unrecognized error shows "Try again", the safe/forgiving choice (a retry
 * that can't help is a wasted click; hiding a retry that WOULD help is worse).
 */
export type ErrorRetryability = 'transient' | 'terminal';

/**
 * WHY a turn is terminal. Retryability alone is not enough to talk to the user: "start a new chat"
 * is the right move for a context overflow and useless for a bad API key, which re-fails in every
 * conversation until an admin fixes the provider credentials.
 */
export type TerminalErrorReason = 'context_length' | 'auth' | 'permission' | 'malformed';

/**
 * TERMINAL: retrying the identical request will fail the same way, so offer a new conversation, not
 * "Try again". Ordered groups — the FIRST match wins, so context length precedes malformed (a
 * context overflow arrives as a 400 `invalid_request_error` and must not be read as malformed):
 *  - context length: prompt/conversation exceeds the model window. THE original bug — never transient.
 *  - authentication: bad/expired/missing API key. A retry with the same creds fails identically.
 *  - permission: the account/key is not allowed to make this call.
 *  - malformed request: a 400 invalid_request that isn't a context overflow (still deterministic).
 * Rate-limit (429), overloaded (529), server (500 api_error), timeouts and transport drops are NOT
 * here — they are genuinely transient and fall through to the transient default.
 */
const TERMINAL_PATTERNS: { reason: TerminalErrorReason; patterns: RegExp[] }[] = [
  {
    reason: 'context_length',
    patterns: [
      /context[_ ]length/i,
      /context window/i,
      /prompt is too long/i,
      /maximum context/i,
      /too many tokens/i,
      /exceeds?.{0,20}(context|token)/i,
    ],
  },
  {
    reason: 'auth',
    patterns: [
      /authentication[_ ]error/i,
      /invalid[_ ]?api[_ ]?key/i,
      /invalid x-api-key/i,
      /\bunauthorized\b/i,
    ],
  },
  { reason: 'permission', patterns: [/permission[_ ]error/i, /\bforbidden\b/i] },
  // a 400 that isn't a rate limit / overload / server error
  { reason: 'malformed', patterns: [/invalid[_ ]request[_ ]error/i] },
];

/**
 * Why a chat turn error is terminal, or null when a retry may plausibly succeed. Unknown/empty →
 * null (the forgiving default: an unrecognized error stays retryable).
 */
export function classifyTerminalReason(errorMessage: string | null | undefined): TerminalErrorReason | null {
  if (!errorMessage) return null;
  for (const { reason, patterns } of TERMINAL_PATTERNS) {
    if (patterns.some((re) => re.test(errorMessage))) return reason;
  }
  return null;
}

/**
 * Classify a chat turn error message into transient (retry may succeed) vs terminal (retry will
 * re-fail — steer to a new conversation). Unknown/empty → transient (the forgiving default).
 */
export function classifyErrorRetryability(errorMessage: string | null | undefined): ErrorRetryability {
  return classifyTerminalReason(errorMessage) ? 'terminal' : 'transient';
}

/**
 * A narrow, POSITIVE allowlist of transient LLM stream / transport drops that a SILENT machine
 * auto-retry may replay. Deliberately stricter than `classifyErrorRetryability`, whose unknown →
 * transient default is right for a human "Try again" click (worst case: one wasted click) but WRONG
 * for an automatic replay: an unmatched message here → false, so we never auto-replay
 *  - an UNKNOWN error (could be a real bug, replaying just burns the retry budget + side effects),
 *  - a user CANCELLATION ("Request was aborted" — a Stop is not a failure to retry), or
 *  - a CONCURRENT-write conflict ("the conversation advanced underneath this run" — replaying a
 *    lost race is wrong).
 * Terminal errors (context-length / auth / permission / malformed) are excluded a fortiori via the
 * `classifyTerminalReason` short-circuit even if their text brushes a transient pattern.
 *
 * The patterns mirror the upstream provider/transport retry signals (pi-ai's
 * RETRYABLE_PROVIDER_ERROR_PATTERN): premature stream ends, provider overload / 5xx, rate limits,
 * and network/socket drops — the failure modes behind the "OpenAI Responses stream ended before a
 * terminal response event" flood this exists to absorb.
 *
 * NOTE: a user Stop can surface with transport-flavored text (e.g. "terminated") that DOES match
 * here — so the turn runner additionally gates on an explicit `cancelled` flag; this predicate is
 * the message-shape half of a two-part guard, not the whole of it.
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
  // Never auto-replay a terminal error, even if its text also brushes a transient pattern.
  if (classifyTerminalReason(errorMessage)) return false;
  return RETRYABLE_STREAM_ERROR_PATTERNS.some((re) => re.test(errorMessage));
}
