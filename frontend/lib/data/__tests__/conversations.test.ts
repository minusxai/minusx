/**
 * Regression: `ConversationsAPI.get` used to return a malformed detail verbatim when a 2xx response
 * carried an unexpected body (empty/HTML/truncated body from a proxy or interrupted request). The
 * caller then did `detail.messages.map(...)` and crashed with the cryptic
 * `Cannot read properties of undefined (reading 'map')` (Sentry MINUSX-BI-2V,
 * chatListener:completeToolCall). `get` now validates the shape and throws a clear, retryable error.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ConversationsAPI } from '../conversations';

function mockFetch(body: unknown, ok = true, status = 200) {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
  }) as unknown as typeof fetch;
}

describe('ConversationsAPI.get — malformed response handling', () => {
  afterEach(() => vi.restoreAllMocks());

  it('throws a clear error when a 2xx body has no data envelope (empty/proxy body)', async () => {
    mockFetch({});
    await expect(ConversationsAPI.get(6798)).rejects.toThrow(/malformed conversation/i);
  });

  it('throws a clear error when data is present but messages/errors are missing', async () => {
    mockFetch({ data: { conversation: { id: 1 } } });
    let err: unknown;
    try { await ConversationsAPI.get(1); } catch (e) { err = e; }
    // The message must be meaningful — never a cryptic "reading 'map'" TypeError.
    expect(String((err as Error)?.message)).toMatch(/malformed conversation/i);
    expect(String((err as Error)?.message)).not.toMatch(/reading 'map'/);
  });

  it('resolves with the detail unchanged on a well-formed response', async () => {
    const detail = { conversation: { id: 1 }, messages: [{ content: {} }], errors: [] };
    mockFetch({ data: detail });
    await expect(ConversationsAPI.get(1)).resolves.toEqual(detail);
  });
});
