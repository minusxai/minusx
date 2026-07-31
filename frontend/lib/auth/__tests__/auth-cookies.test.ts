// The cookies the middleware CLEARS must be the cookies auth MINTS.
//
// When namespace resolution fails, the middleware redirects to /login and expires
// the session cookies — the intent is a forced logout. It was clearing NextAuth v4
// names (`next-auth.session-token`, …) on an app running Auth.js v5, which names
// them `authjs.*`. Expiring a cookie that does not exist is a no-op, so the
// session survived the redirect: the user was bounced to /login while still
// authenticated, and any request that did not go through that branch continued to
// work.
//
// This asserts the two sides agree, rather than booting the middleware — the
// clear list is exported for exactly that reason. It does not prove the redirect
// path runs; it proves that when it does, it names cookies that exist.

import { describe, it, expect } from 'vitest';
import { AUTH_COOKIE_NAMES } from '@/lib/auth/auth-cookies';
import { buildEmbedCookieConfig } from '@/lib/auth/embed';
import { CLEARED_SESSION_COOKIES } from '@/lib/middleware/create-middleware';

/** Every cookie name `buildEmbedCookieConfig` mints, across both environments. */
function mintedNames(): string[] {
  return [true, false].flatMap((isDev) => {
    const cfg = buildEmbedCookieConfig(true, isDev);
    return cfg ? Object.values(cfg).map((c) => (c as { name: string }).name) : [];
  });
}

describe('session cookie names', () => {
  it('clears every name the embed config can mint', () => {
    for (const name of mintedNames()) {
      expect(CLEARED_SESSION_COOKIES).toContain(name);
    }
  });

  it('clears the Auth.js v5 defaults, used whenever embedding is off', () => {
    // buildEmbedCookieConfig returns undefined when embedding is disabled, so
    // Auth.js falls back to its own naming — the common production case.
    expect(buildEmbedCookieConfig(false, false)).toBeUndefined();
    expect(CLEARED_SESSION_COOKIES).toContain('authjs.session-token');
    expect(CLEARED_SESSION_COOKIES).toContain('__Secure-authjs.session-token');
  });

  it('clears no NextAuth v4 name — this app is on Auth.js v5', () => {
    expect(CLEARED_SESSION_COOKIES.filter((n) => n.includes('next-auth'))).toEqual([]);
  });

  it('uses the shared list rather than a second hand-written copy', () => {
    expect([...CLEARED_SESSION_COOKIES].sort()).toEqual([...AUTH_COOKIE_NAMES].sort());
  });
});
