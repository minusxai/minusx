/**
 * OAuth 2.1 — no database tables required.
 *
 * Auth codes: in-memory Map (5-min lifetime, ephemeral by design — lost on
 *   restart is acceptable; user simply re-authorizes).
 *
 * Access tokens: short-lived JWTs (1 hour, type: 'access') signed with NEXTAUTH_SECRET.
 *   Stateless — validated by signature check, no DB lookup.
 *
 * Refresh tokens: long-lived JWTs (30 days, type: 'refresh') signed with the same
 *   secret. Also stateless — survive restarts and work across instances with no
 *   store. Tradeoff vs. opaque tokens: no server-side revocation or single-use
 *   rotation (a leaked refresh token is valid until it expires). The `type` claim
 *   keeps access and refresh tokens from being used in place of one another.
 */

import 'server-only';
import { randomBytes, createHash } from 'crypto';
import jwt from 'jsonwebtoken';
import { NEXTAUTH_SECRET } from '@/lib/config';

// ---------------------------------------------------------------------------
// In-memory auth code store (survives HMR via globalThis)
// ---------------------------------------------------------------------------

interface CodeEntry {
  userId: number;
  redirectUri: string;
  codeChallenge: string;
  scope: string | null;
  expiresAt: number; // ms since epoch
}

/* eslint-disable no-restricted-syntax -- globalThis used to survive HMR; in-process singleton is intentional */
const codeStore: Map<string, CodeEntry> = (
  (globalThis as Record<string, unknown>).__oauthCodes ??= new Map<string, CodeEntry>()
) as Map<string, CodeEntry>;
/* eslint-enable no-restricted-syntax */

// ---------------------------------------------------------------------------
// OAuthCodeDB — short-lived PKCE authorization codes
// ---------------------------------------------------------------------------

export class OAuthCodeDB {
  /**
   * Create a new authorization code (5-minute lifetime).
   * Returns the plaintext code to send to the client.
   */
  static async create(
    userId: number,
    redirectUri: string,
    codeChallenge: string,
    _codeChallengeMethod = 'S256',
    scope?: string,
  ): Promise<string> {
    const code = randomBytes(24).toString('hex');
    codeStore.set(code, {
      userId,
      redirectUri,
      codeChallenge,
      scope: scope ?? null,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });
    return code;
  }

  /**
   * Consume a code: validate, delete (single-use), and return the associated data.
   * Returns null if code is invalid, expired, or redirect_uri/PKCE mismatch.
   */
  static async consume(
    code: string,
    redirectUri: string,
    codeVerifier: string,
  ): Promise<{ userId: number; scope: string | null } | null> {
    const entry = codeStore.get(code);
    if (!entry) return null;

    // Always delete — prevents replay even on failed validation
    codeStore.delete(code);

    if (Date.now() > entry.expiresAt) return null;
    if (entry.redirectUri !== redirectUri) return null;

    const verifierHash = createHash('sha256').update(codeVerifier).digest('base64url');
    if (verifierHash !== entry.codeChallenge) return null;

    return { userId: entry.userId, scope: entry.scope };
  }

  /** Prune stale entries (bounded by 5-min TTL, so this is just housekeeping). */
  static async cleanupExpired(): Promise<void> {
    const now = Date.now();
    for (const [code, entry] of codeStore) {
      if (now > entry.expiresAt) codeStore.delete(code);
    }
  }
}

// ---------------------------------------------------------------------------
// OAuthTokenDB — JWT access tokens (stateless, no DB)
// ---------------------------------------------------------------------------

interface AccessTokenPayload {
  jti: string; // unique token ID — prevents identical JWTs when issued in the same second
  userId: number;
  scope: string | null;
}

export interface OAuthTokenPair {
  accessToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

export class OAuthTokenDB {
  private static get secret(): string {
    return NEXTAUTH_SECRET || 'dev-insecure-secret';
  }

  /** Issue a signed JWT access token. extra fields are spread directly into the payload. */
  static async create(
    userId: number,
    scope?: string | null,
    extra?: Record<string, unknown>,
  ): Promise<OAuthTokenPair> {
    const expiresIn = 3600; // 1 hour
    // `type: 'access'` is set last so it can't be overridden by `extra` — a
    // refresh token must never validate as an access token (see validateAccessToken).
    const payload = { jti: randomBytes(16).toString('hex'), userId, scope: scope ?? null, ...extra, type: 'access' };
    const accessToken = jwt.sign(payload, OAuthTokenDB.secret, { expiresIn });
    return { accessToken, expiresIn, tokenType: 'Bearer' };
  }

  /** Verify a JWT access token. Returns the decoded payload (including any extra fields) or null. */
  static async validateAccessToken(
    accessToken: string,
  ): Promise<{ userId: number; scope: string | null; [key: string]: unknown } | null> {
    try {
      const decoded = jwt.verify(accessToken, OAuthTokenDB.secret) as { userId: number; scope: string | null; type?: string; [key: string]: unknown };
      // A refresh token is a valid JWT under the same secret — reject it here so
      // it can never be used to authenticate. (Tokens predating the `type` claim
      // have no `type` and are still accepted.)
      if (decoded.type === 'refresh') return null;
      return decoded;
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// OAuthRefreshDB — long-lived refresh tokens as stateless JWTs (30-day)
// ---------------------------------------------------------------------------

const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

export class OAuthRefreshDB {
  private static get secret(): string {
    return NEXTAUTH_SECRET || 'dev-insecure-secret';
  }

  /** Issue a signed JWT refresh token for the given user. */
  static async create(userId: number, scope: string | null): Promise<string> {
    const payload = { jti: randomBytes(16).toString('hex'), userId, scope, type: 'refresh' as const };
    return jwt.sign(payload, OAuthRefreshDB.secret, { expiresIn: REFRESH_TOKEN_TTL_SECONDS });
  }

  /**
   * Validate a refresh token by signature + expiry and return its data.
   * Returns null if invalid, expired, or not a refresh-type token (e.g. an
   * access token replayed against the refresh grant).
   *
   * Note: JWTs are stateless, so this is NOT single-use — a valid refresh token
   * can be redeemed repeatedly until it expires. Revocation/rotation would
   * require server-side state (see header).
   */
  static async consume(token: string): Promise<{ userId: number; scope: string | null } | null> {
    try {
      const decoded = jwt.verify(token, OAuthRefreshDB.secret) as { userId: number; scope: string | null; type?: string };
      if (decoded.type !== 'refresh') return null;
      return { userId: decoded.userId, scope: decoded.scope ?? null };
    } catch {
      return null;
    }
  }
}
