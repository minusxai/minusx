/**
 * Transient single-call LLM retry policy (the LLM-boundary fix for the "OpenAI Responses stream
 * ended before a terminal response event" flood). Pure-predicate matrix so the safety-critical
 * branches — never retry a user Stop, never retry after content has streamed — are proven
 * deterministically, without driving a real mid-stream drop.
 */
import {
  isRetryableStreamError,
  isUserVisibleStreamEvent,
  shouldRetryLlmCall,
  MAX_LLM_CALL_RETRIES,
} from '@/orchestrator/llm/retry';

describe('isRetryableStreamError', () => {
  it.each([
    'OpenAI Responses stream ended before a terminal response event',
    'Anthropic stream ended before message_stop',
    'stream ended without a stop event',
    '529 Overloaded',
    '503 service unavailable',
    '524 a timeout occurred',
    '429 rate limit exceeded',
    'fetch failed',
    'socket hang up',
    'ECONNRESET',
    'The operation timed out',
  ])('retryable transient drop: %s', (msg) => {
    expect(isRetryableStreamError(msg)).toBe(true);
  });

  it.each([
    'prompt is too long: 250000 tokens > 200000 maximum', // context length — terminal
    'invalid x-api-key',
    'Request was aborted',
    'synthetic tool failure',
    'something totally unexpected',
    null,
    undefined,
    '',
  ])('NOT retryable: %s', (msg) => {
    expect(isRetryableStreamError(msg)).toBe(false);
  });
});

describe('isUserVisibleStreamEvent', () => {
  // USER-VISIBLE: text/thinking with actual content — these reach the client live (the turn
  // runner forwards text/thinking deltas as ephemeral typing), so a retry after them would
  // duplicate visible output.
  it.each([
    { type: 'text_delta', delta: 'hello' },
    { type: 'thinking_delta', delta: 'reasoning…' },
    { type: 'text_end', content: 'final text' },
    { type: 'thinking_end', content: 'final thought' },
  ])('user-visible (would garble on retry): $type', (ev) => {
    expect(isUserVisibleStreamEvent(ev)).toBe(true);
  });

  // NOT user-visible: tool-call arg streaming never reaches a user surface (only COMMITTED log
  // entries render tool activity, and a failed attempt is never committed); whitespace-only text
  // renders as nothing; structural/terminal events carry no content.
  it.each([
    { type: 'toolcall_delta', delta: '{"fileIds":[21' },
    { type: 'toolcall_end' },
    { type: 'toolcall_start' },
    { type: 'text_delta', delta: '  \n' },
    { type: 'thinking_delta', delta: '' },
    { type: 'text_end', content: ' ' },
    { type: 'start' },
    { type: 'text_start' },
    { type: 'thinking_start' },
    { type: 'done' },
    { type: 'error' },
  ])('not user-visible (safe to re-issue): $type', (ev) => {
    expect(isUserVisibleStreamEvent(ev)).toBe(false);
  });
});

describe('shouldRetryLlmCall', () => {
  const base = {
    reason: 'error' as const,
    emitted: false,
    aborted: false,
    errorMessage: 'OpenAI Responses stream ended before a terminal response event',
    attempt: 0,
    maxRetries: MAX_LLM_CALL_RETRIES,
  };

  it('retries a transient, pre-content drop under budget', () => {
    expect(shouldRetryLlmCall(base)).toBe(true);
  });

  it('never retries a user cancellation — reason "aborted" (structural guard, no string-matching)', () => {
    expect(shouldRetryLlmCall({ ...base, reason: 'aborted' })).toBe(false);
    // even if the abort surfaced with transport-flavored text that the allowlist would match:
    expect(shouldRetryLlmCall({ ...base, reason: 'aborted', errorMessage: 'terminated' })).toBe(false);
  });

  it('never retries once the abort signal has fired mid-flight', () => {
    expect(shouldRetryLlmCall({ ...base, aborted: true })).toBe(false);
  });

  it('never retries after content has already streamed (would garble the in-progress message)', () => {
    expect(shouldRetryLlmCall({ ...base, emitted: true })).toBe(false);
  });

  it('stops at the retry budget', () => {
    expect(shouldRetryLlmCall({ ...base, attempt: MAX_LLM_CALL_RETRIES - 1 })).toBe(true);
    expect(shouldRetryLlmCall({ ...base, attempt: MAX_LLM_CALL_RETRIES })).toBe(false);
  });

  it('never retries a non-transient error (terminal / unknown / missing)', () => {
    expect(shouldRetryLlmCall({ ...base, errorMessage: 'prompt is too long: 250000 tokens > 200000 maximum' })).toBe(false);
    expect(shouldRetryLlmCall({ ...base, errorMessage: 'synthetic tool failure' })).toBe(false);
    expect(shouldRetryLlmCall({ ...base, errorMessage: null })).toBe(false);
    expect(shouldRetryLlmCall({ ...base, reason: undefined })).toBe(false);
  });
});
