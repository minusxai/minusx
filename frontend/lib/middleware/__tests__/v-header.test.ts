// `?v=2` server-side propagation. Same shape as the existing as_user / mode
// flow in create-middleware.ts: read from search params, stamp `x-v` on
// forwarded headers if present.

import { extractVHeader } from '@/lib/middleware/create-middleware';

describe('extractVHeader — server-side mirror of getCurrentV', () => {
  it("returns 'x-v: 2' when ?v=2 is present", () => {
    const params = new URLSearchParams('v=2&mode=tutorial');
    expect(extractVHeader(params)).toEqual({ key: 'x-v', value: '2' });
  });

  it('returns null when v is absent', () => {
    const params = new URLSearchParams('mode=tutorial&as_user=alice@example.com');
    expect(extractVHeader(params)).toBeNull();
  });

  it('returns null when v is empty', () => {
    const params = new URLSearchParams('v=');
    expect(extractVHeader(params)).toBeNull();
  });

  it('passes through any non-empty v (e.g. v=1, v=foo)', () => {
    expect(extractVHeader(new URLSearchParams('v=1'))).toEqual({ key: 'x-v', value: '1' });
    expect(extractVHeader(new URLSearchParams('v=foo'))).toEqual({ key: 'x-v', value: 'foo' });
  });
});
