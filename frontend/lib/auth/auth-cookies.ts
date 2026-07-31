/**
 * The names of the cookies that carry a session, in one place.
 *
 * These exist because two pieces of code have to agree on them and had no reason
 * to: `buildEmbedCookieConfig` MINTS them, and the middleware CLEARS them when it
 * rejects a request. The clear list was written against NextAuth v4 (`next-auth.*`)
 * while this app runs Auth.js v5, which names them `authjs.*` — so the clear
 * matched nothing and the "force a logout" path left the session intact. The
 * request was redirected to /login while still authenticated.
 *
 * Both prefixed and unprefixed forms are listed. Which one exists depends on
 * `secure`/host constraints at mint time, and clearing a cookie that was never set
 * is free — whereas missing the one that WAS set is the bug above.
 */

/** Base names Auth.js v5 uses (and that `buildEmbedCookieConfig` builds on). */
const BASE = ['authjs.session-token', 'authjs.csrf-token', 'authjs.callback-url'] as const;

/**
 * Every cookie name that could be holding a session, for expiry on logout/reject.
 *
 * `__Secure-` is the prefix Auth.js applies to the session token and callback URL
 * outside dev; `__Host-` is the stricter prefix it applies to the CSRF token.
 */
export const AUTH_COOKIE_NAMES: readonly string[] = [
  ...BASE,
  '__Secure-authjs.session-token',
  '__Secure-authjs.callback-url',
  '__Host-authjs.csrf-token',
];
