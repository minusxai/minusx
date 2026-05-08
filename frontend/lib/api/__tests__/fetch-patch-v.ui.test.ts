// fetch-patch.ts auto-installs on import and wraps window.fetch so every
// `/api/*` call carries `as_user` / `mode` from the URL. We're adding `v`
// to that machinery so chat-v2 calls keep `?v=2` server-side too.

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

function setLocation(href: string): void {
  const url = new URL(href);
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: {
      href: url.href,
      origin: url.origin,
      pathname: url.pathname,
      search: url.search,
      hash: url.hash,
    } as unknown as Location,
  });
}

describe('fetch-patch — appends v alongside as_user / mode', () => {
  let originalFetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    // Reset modules so installPatch re-captures our stub as originalFetch.
    vi.resetModules();
    originalFetchSpy = vi.fn(async (_input: RequestInfo | URL) =>
      new Response('{}', { status: 200 }),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as unknown as { fetch: typeof fetch }).fetch = originalFetchSpy as any;
  });

  afterEach(() => {
    setLocation('http://localhost:3000/');
  });

  it('appends v=2 to /api/* URLs when ?v=2 is in window.location', async () => {
    setLocation('http://localhost:3000/?v=2');
    await import('@/lib/api/fetch-patch'); // installs patch using our stub

    await window.fetch('/api/chat/v2/stream');

    expect(originalFetchSpy).toHaveBeenCalledTimes(1);
    const calledWith = originalFetchSpy.mock.calls[0][0];
    const calledUrl = typeof calledWith === 'string' ? calledWith : (calledWith as URL).toString();
    expect(calledUrl).toContain('v=2');
  });

  it('does NOT add v= when window.location has no v', async () => {
    setLocation('http://localhost:3000/');
    await import('@/lib/api/fetch-patch');

    await window.fetch('/api/chat/v2/new');

    const calledWith = originalFetchSpy.mock.calls[0][0];
    const calledUrl = typeof calledWith === 'string' ? calledWith : (calledWith as URL).toString();
    expect(calledUrl).not.toContain('v=');
  });

  it('preserves v alongside mode + as_user when all three are present', async () => {
    setLocation('http://localhost:3000/?v=2&mode=tutorial&as_user=alice@example.com');
    await import('@/lib/api/fetch-patch');

    await window.fetch('/api/files/123');

    const calledWith = originalFetchSpy.mock.calls[0][0];
    const calledUrl = typeof calledWith === 'string' ? calledWith : (calledWith as URL).toString();
    const parsed = new URL(calledUrl, 'http://localhost:3000');
    expect(parsed.searchParams.get('v')).toBe('2');
    expect(parsed.searchParams.get('mode')).toBe('tutorial');
    expect(parsed.searchParams.get('as_user')).toBe('alice@example.com');
  });
});
