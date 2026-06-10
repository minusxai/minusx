import { describe, it, expect } from 'vitest';
import { parseFrameAncestors, buildEmbedCookieConfig } from '../embed';

describe('parseFrameAncestors', () => {
  it('returns empty for disabled (undefined / empty)', () => {
    expect(parseFrameAncestors(undefined)).toBe('');
    expect(parseFrameAncestors('')).toBe('');
    expect(parseFrameAncestors('   ')).toBe('');
  });

  it('returns empty for the wildcard so no restrictive header is emitted', () => {
    // '*' = allow any origin; emitting `frame-ancestors *` would break file:// embeds,
    // so we deliberately emit no header at all.
    expect(parseFrameAncestors('*')).toBe('');
  });

  it('normalizes a comma/space-separated list into a space-separated CSP value', () => {
    expect(parseFrameAncestors('https://a.com, https://b.com')).toBe('https://a.com https://b.com');
    expect(parseFrameAncestors('https://a.com   https://b.com')).toBe('https://a.com https://b.com');
  });
});

describe('buildEmbedCookieConfig', () => {
  it('returns undefined when embedding is disabled (NextAuth keeps its defaults)', () => {
    expect(buildEmbedCookieConfig(false, false)).toBeUndefined();
    expect(buildEmbedCookieConfig(false, true)).toBeUndefined();
  });

  it('uses SameSite=None; Secure on all auth cookies when enabled', () => {
    const cfg = buildEmbedCookieConfig(true, false)!;
    for (const c of [cfg.sessionToken, cfg.callbackUrl, cfg.csrfToken]) {
      expect(c.options.sameSite).toBe('none');
      expect(c.options.secure).toBe(true);
    }
  });

  it('uses NextAuth-default prefixed names outside dev (so existing sessions survive)', () => {
    const cfg = buildEmbedCookieConfig(true, false)!;
    expect(cfg.sessionToken.name).toBe('__Secure-authjs.session-token');
    expect(cfg.callbackUrl.name).toBe('__Secure-authjs.callback-url');
    expect(cfg.csrfToken.name).toBe('__Host-authjs.csrf-token');
  });

  it('uses unprefixed names in dev (matching NextAuth dev defaults)', () => {
    const cfg = buildEmbedCookieConfig(true, true)!;
    expect(cfg.sessionToken.name).toBe('authjs.session-token');
    expect(cfg.csrfToken.name).toBe('authjs.csrf-token');
  });

  it('keeps httpOnly on session/csrf but not on callbackUrl', () => {
    const cfg = buildEmbedCookieConfig(true, false)!;
    expect(cfg.sessionToken.options.httpOnly).toBe(true);
    expect(cfg.csrfToken.options.httpOnly).toBe(true);
    expect(cfg.callbackUrl.options.httpOnly).toBeUndefined();
  });
});
