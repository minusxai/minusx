/**
 * classifyErrorRetryability — splits a failed chat turn into transient (a "Try again" that can
 * plausibly succeed) vs terminal (the identical request re-fails → steer to a new conversation).
 * The original bug: a large-context error showed "Try again", which just re-failed. Context-length
 * MUST be terminal; genuinely transient blips (network / 500 / 429 / timeout / unknown) stay
 * retryable.
 */
import { classifyErrorRetryability, classifyTerminalReason } from '@/lib/chat/error-retryability';

describe('classifyErrorRetryability', () => {
  describe('terminal — retry would deterministically re-fail', () => {
    // Real Anthropic context-overflow message shape (400 invalid_request_error).
    const contextLength = [
      '400 {"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long: 250000 tokens > 200000 maximum"}}',
      'This model\'s maximum context length is 200000 tokens',
      'context_length_exceeded',
      'The request exceeds the context window of the model',
      'too many tokens in the request',
      "callLLM: LLM stream errored (agent=AnalystAgent, reason='error'): prompt is too long: 300000 tokens > 200000 maximum",
    ];
    it.each(contextLength)('context-length: %s', (msg) => {
      expect(classifyErrorRetryability(msg)).toBe('terminal');
    });

    it.each([
      '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
      'invalid_api_key: incorrect API key provided',
      'Unauthorized',
    ])('authentication: %s', (msg) => {
      expect(classifyErrorRetryability(msg)).toBe('terminal');
    });

    it.each([
      '403 {"type":"error","error":{"type":"permission_error","message":"not allowed"}}',
      'Forbidden',
    ])('permission: %s', (msg) => {
      expect(classifyErrorRetryability(msg)).toBe('terminal');
    });

    it('malformed request (400 invalid_request that is not a context overflow)', () => {
      expect(classifyErrorRetryability(
        '400 {"type":"error","error":{"type":"invalid_request_error","message":"messages: at least one message is required"}}',
      )).toBe('terminal');
    });
  });

  describe('transient — a clean re-run may succeed', () => {
    it.each([
      'Network error',
      'fetch failed',
      'socket hang up',
      'ECONNRESET',
      'The operation timed out',
      '500 {"type":"error","error":{"type":"api_error","message":"internal server error"}}',
      '429 {"type":"error","error":{"type":"rate_limit_error","message":"rate limit exceeded"}}',
      '529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
      'concurrent turn — the conversation advanced underneath this run',
      "We couldn't complete that after several automatic retries. Please try again.",
      'chat error',
      'something totally unexpected',
    ])('transient: %s', (msg) => {
      expect(classifyErrorRetryability(msg)).toBe('transient');
    });

    it.each([null, undefined, ''])('empty/nullish defaults to transient: %s', (msg) => {
      expect(classifyErrorRetryability(msg)).toBe('transient');
    });
  });
});

// "Start a new chat" is the right move for a context overflow and useless for a bad API key — the
// next chat fails identically until an admin fixes the provider. The banner needs the REASON, not
// just the verdict, to say something true.
describe('classifyTerminalReason', () => {
  it('separates a context overflow from a malformed request (both are 400 invalid_request_error)', () => {
    expect(classifyTerminalReason(
      '400 {"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long: 250000 tokens > 200000 maximum"}}',
    )).toBe('context_length');
    expect(classifyTerminalReason(
      '400 {"type":"error","error":{"type":"invalid_request_error","message":"messages: at least one message is required"}}',
    )).toBe('malformed');
  });

  it.each([
    '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
    'invalid_api_key: incorrect API key provided',
    'Unauthorized',
  ])('auth: %s', (msg) => {
    expect(classifyTerminalReason(msg)).toBe('auth');
  });

  it.each([
    '403 {"type":"error","error":{"type":"permission_error","message":"not allowed"}}',
    'Forbidden',
  ])('permission: %s', (msg) => {
    expect(classifyTerminalReason(msg)).toBe('permission');
  });

  it.each(['Network error', '429 rate_limit_error', null, undefined, ''])(
    'null when a retry may succeed: %s',
    (msg) => {
      expect(classifyTerminalReason(msg)).toBeNull();
    },
  );
});
