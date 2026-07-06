/**
 * Iframe-embedding support (e.g. embedding the app in a dev/staging dashboard).
 *
 * Enabled per-deploy via the `EMBED_ALLOWED_ORIGINS` env (read in `lib/config.ts`).
 * Two cooperating pieces, both gated by that env and OFF by default so production
 * is unaffected:
 *   1. Auth cookies become `SameSite=None; Secure` (`buildEmbedCookieConfig`), so
 *      the browser sends them inside a cross-site iframe — otherwise NextAuth's
 *      CSRF cookie is absent on the login POST and you get `?error=MissingCSRF`.
 *   2. A `Content-Security-Policy: frame-ancestors …` header (`parseFrameAncestors`)
 *      restricts which origins may embed the app.
 *
 * SECURITY: `SameSite=None` sends the session cookie in any cross-site iframe, so
 * only enable this on deploys you intend to embed, and prefer an explicit origin
 * list over `*` to limit clickjacking exposure.
 */

/**
 * Normalize `EMBED_ALLOWED_ORIGINS` into a CSP `frame-ancestors` value.
 *
 * `''` (disabled) and `'*'` (allow any) both return `''` → no `frame-ancestors`
 * header is emitted, leaving the app embeddable from any origin (including a
 * `file://` page, whose opaque origin `*` would NOT match). A specific,
 * whitespace/comma-separated list is normalized to a space-separated CSP value.
 */
export function parseFrameAncestors(raw: string | undefined): string {
  const v = (raw ?? '').trim();
  if (v === '' || v === '*') return '';
  return v.replace(/[\s,]+/g, ' ').trim();
}

interface EmbedCookieOption {
  name: string;
  options: { httpOnly?: boolean; sameSite: 'none'; path: string; secure: true };
}

export interface EmbedCookieConfig {
  sessionToken: EmbedCookieOption;
  callbackUrl: EmbedCookieOption;
  csrfToken: EmbedCookieOption;
}

/**
 * NextAuth `cookies` override for iframe embedding, or `undefined` to keep
 * NextAuth's defaults when embedding is disabled.
 *
 * Cookie names match NextAuth's own defaults — prefixed (`__Secure-`/`__Host-`)
 * outside dev, unprefixed in dev — so enabling embedding flips only the
 * `SameSite`/`Secure` flags and does NOT invalidate existing sessions.
 */
export function buildEmbedCookieConfig(enabled: boolean, isDev: boolean): EmbedCookieConfig | undefined {
  if (!enabled) return undefined;
  const securePrefix = isDev ? '' : '__Secure-';
  const hostPrefix = isDev ? '' : '__Host-';
  const shared = { sameSite: 'none', path: '/', secure: true } as const;
  return {
    sessionToken: { name: `${securePrefix}authjs.session-token`, options: { httpOnly: true, ...shared } },
    callbackUrl: { name: `${securePrefix}authjs.callback-url`, options: { ...shared } },
    csrfToken: { name: `${hostPrefix}authjs.csrf-token`, options: { httpOnly: true, ...shared } },
  };
}
