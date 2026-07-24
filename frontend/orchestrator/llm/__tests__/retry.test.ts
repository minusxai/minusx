/**
 * Transient single-call LLM retry policy (the LLM-boundary fix for the "OpenAI Responses stream
 * ended before a terminal response event" flood). Pure-predicate matrix so the safety-critical
 * branches — never retry a user Stop, never retry after content has streamed — are proven
 * deterministically, without driving a real mid-stream drop.
 */
import {
  isRetryableStreamError,
  isContentStreamEvent,
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

describe('isContentStreamEvent', () => {
  it.each(['text_delta', 'thinking_delta', 'toolcall_delta', 'text_end', 'thinking_end', 'toolcall_end'])(
    'content event (would garble on retry): %s',
    (t) => expect(isContentStreamEvent(t)).toBe(true),
  );
  it.each(['start', 'text_start', 'thinking_start', 'toolcall_start', 'done', 'error'])(
    'structural / terminal event (safe): %s',
    (t) => expect(isContentStreamEvent(t)).toBe(false),
  );
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
