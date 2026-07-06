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
 * TERMINAL: retrying the identical request will fail the same way, so offer a new conversation, not
 * "Try again". Ordered groups (all → terminal; grouped for clarity + future divergence):
 *  - context length: prompt/conversation exceeds the model window. THE original bug — never transient.
 *  - authentication: bad/expired/missing API key. A retry with the same creds fails identically.
 *  - permission: the account/key is not allowed to make this call.
 *  - malformed request: a 400 invalid_request that isn't a context overflow (still deterministic).
 * Rate-limit (429), overloaded (529), server (500 api_error), timeouts and transport drops are NOT
 * here — they are genuinely transient and fall through to the transient default.
 */
const TERMINAL_PATTERNS: RegExp[] = [
  // context length / prompt too long / token overflow
  /context[_ ]length/i,
  /context window/i,
  /prompt is too long/i,
  /maximum context/i,
  /too many tokens/i,
  /exceeds?.{0,20}(context|token)/i,
  // authentication
  /authentication[_ ]error/i,
  /invalid[_ ]?api[_ ]?key/i,
  /invalid x-api-key/i,
  /\bunauthorized\b/i,
  // permission
  /permission[_ ]error/i,
  /\bforbidden\b/i,
  // malformed request (a 400 that isn't a rate limit / overload / server error)
  /invalid[_ ]request[_ ]error/i,
];

/**
 * Classify a chat turn error message into transient (retry may succeed) vs terminal (retry will
 * re-fail — steer to a new conversation). Unknown/empty → transient (the forgiving default).
 */
export function classifyErrorRetryability(errorMessage: string | null | undefined): ErrorRetryability {
  if (!errorMessage) return 'transient';
  return TERMINAL_PATTERNS.some((re) => re.test(errorMessage)) ? 'terminal' : 'transient';
}
