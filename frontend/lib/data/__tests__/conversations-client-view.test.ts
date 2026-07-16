/**
 * Conversations V2 — client ConversationsAPI.get view/since plumbing (see /conversations-v2.md).
 * `view: 'full'` and `sinceSeq` must land on the request URL; the default adds neither.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ConversationsAPI } from '../conversations';

const detail = { conversation: { id: 1 }, messages: [], errors: [] };

function mockFetch() {
  const fn = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: detail }) });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

function requestedUrl(fn: ReturnType<typeof vi.fn>): string {
  return String(fn.mock.calls[0][0]);
}

describe('ConversationsAPI.get — view/since params', () => {
  afterEach(() => vi.restoreAllMocks());

  it('default: no view/since params on the URL', async () => {
    const fn = mockFetch();
    await ConversationsAPI.get(42);
    const url = requestedUrl(fn);
    expect(url).toContain('/api/conversations/42');
    expect(url).not.toContain('view=');
    expect(url).not.toContain('since=');
  });

  it("view: 'full' → ?view=full", async () => {
    const fn = mockFetch();
    await ConversationsAPI.get(42, { view: 'full' });
    expect(requestedUrl(fn)).toContain('view=full');
  });

  it('sinceSeq → ?since=<seq>', async () => {
    const fn = mockFetch();
    await ConversationsAPI.get(42, { sinceSeq: 17 });
    expect(requestedUrl(fn)).toContain('since=17');
  });

  it("view: 'display' adds no param (it's the server default)", async () => {
    const fn = mockFetch();
    await ConversationsAPI.get(42, { view: 'display' });
    expect(requestedUrl(fn)).not.toContain('view=');
  });
});
