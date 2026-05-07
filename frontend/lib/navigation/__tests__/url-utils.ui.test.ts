// `?v=2` propagation tests. The `v` param gates chat-v2 surfaces; it must
// flow through the same `preserveParams` / `getCurrent*` / `setVInUrl`
// machinery that `as_user` and `mode` already use, so a `<Link>` click,
// a `useRouter().push`, or a manual `window.location.href` assignment all
// preserve the toggle.

import {
  preserveParams,
  getCurrentV,
  setVInUrl,
} from '@/lib/navigation/url-utils';

function setLocation(href: string): void {
  // jsdom: window.location is not directly assignable, but Object.defineProperty
  // works for replacing it with a fake that exposes pathname/search/href.
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
      // setter we can spy on; some impls assign window.location.href = …
      // The tests for setVInUrl don't need to assert .href = …; they verify
      // the returned string. The settings-toggle test does its own setter spy.
    } as unknown as Location,
  });
}

describe('preserveParams — v alongside as_user + mode', () => {
  afterEach(() => {
    setLocation('http://localhost:3000/');
  });

  it('preserves v=2 on the target when only v is in the current URL', () => {
    setLocation('http://localhost:3000/?v=2');
    expect(preserveParams('/chats')).toBe('/chats?v=2');
  });

  it('preserves v + mode + as_user together', () => {
    setLocation('http://localhost:3000/?v=2&mode=tutorial&as_user=alice@example.com');
    const out = preserveParams('/chats');
    // Param order isn't guaranteed but presence is. Assert via parsed search.
    const parsed = new URLSearchParams(out.split('?')[1] ?? '');
    expect(parsed.get('v')).toBe('2');
    expect(parsed.get('mode')).toBe('tutorial');
    expect(parsed.get('as_user')).toBe('alice@example.com');
    expect(out.split('?')[0]).toBe('/chats');
  });

  it('does NOT add v= when the current URL has no v', () => {
    setLocation('http://localhost:3000/?mode=tutorial');
    const out = preserveParams('/chats');
    const parsed = new URLSearchParams(out.split('?')[1] ?? '');
    expect(parsed.get('v')).toBeNull();
    expect(parsed.get('mode')).toBe('tutorial');
  });

  it('returns target unchanged when no relevant params are present', () => {
    setLocation('http://localhost:3000/');
    expect(preserveParams('/chats')).toBe('/chats');
  });
});

describe('getCurrentV', () => {
  afterEach(() => setLocation('http://localhost:3000/'));

  it('returns "2" when v=2 is in the URL', () => {
    setLocation('http://localhost:3000/foo?v=2');
    expect(getCurrentV()).toBe('2');
  });

  it('returns null when v is absent', () => {
    setLocation('http://localhost:3000/foo?mode=tutorial');
    expect(getCurrentV()).toBeNull();
  });
});

describe('setVInUrl — toggle controller', () => {
  afterEach(() => setLocation('http://localhost:3000/'));

  it('adds v=2 to the URL while preserving other params and pathname', () => {
    setLocation('http://localhost:3000/settings?mode=tutorial&as_user=alice@example.com');
    const out = setVInUrl(true);
    expect(out.split('?')[0]).toBe('/settings');
    const parsed = new URLSearchParams(out.split('?')[1] ?? '');
    expect(parsed.get('v')).toBe('2');
    expect(parsed.get('mode')).toBe('tutorial');
    expect(parsed.get('as_user')).toBe('alice@example.com');
  });

  it('removes v from the URL while preserving other params and pathname', () => {
    setLocation('http://localhost:3000/settings?v=2&mode=tutorial');
    const out = setVInUrl(false);
    expect(out.split('?')[0]).toBe('/settings');
    const parsed = new URLSearchParams(out.split('?')[1] ?? '');
    expect(parsed.get('v')).toBeNull();
    expect(parsed.get('mode')).toBe('tutorial');
  });

  it('toggling on from a clean URL produces /settings?v=2', () => {
    setLocation('http://localhost:3000/settings');
    expect(setVInUrl(true)).toBe('/settings?v=2');
  });

  it('toggling off from /settings?v=2 produces /settings', () => {
    setLocation('http://localhost:3000/settings?v=2');
    expect(setVInUrl(false)).toBe('/settings');
  });
});
