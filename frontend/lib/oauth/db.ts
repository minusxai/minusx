/**
 * OAuth 2.1 — no database tables required.
 *
 * Auth codes: in-memory Map (5-min lifetime, ephemeral by design — lost on
 *   restart is acceptable; user simply re-authorizes).
 *
 * Access tokens: short-lived JWTs signed with NEXTAUTH_SECRET.
 *   Stateless — validated by signature check, no DB lookup.
 *   No refresh tokens in v1; clients re-run OAuth when the JWT expires.
 */

import 'server-only';
import { randomBytes, createHash } from 'crypto';
import jwt from 'jsonwebtoken';
import { NEXTAUTH_SECRET } from '@/lib/config';

// ---------------------------------------------------------------------------
// In-memory auth code store (survives HMR via globalThis)
// ---------------------------------------------------------------------------

interface CodeEntry {
  companyId: number;
  userId: number;
  redirectUri: string;
  codeChallenge: string;
  scope: string | null;
  expiresAt: number; // ms since epoch
}

const codeStore: Map<string, CodeEntry> = (
  (globalThis as Record<string, unknown>).__oauthCodes ??= new Map<string, CodeEntry>()
) as Map<string, CodeEntry>;

// ---------------------------------------------------------------------------
// OAuthCodeDB — short-lived PKCE authorization codes
// ---------------------------------------------------------------------------

export class OAuthCodeDB {
  /**
   * Create a new authorization code (5-minute lifetime).
   * Returns the plaintext code to send to the client.
   */
  static async create(
    companyId: number,
    userId: number,
    redirectUri: string,
    codeChallenge: string,
    _codeChallengeMethod = 'S256',
    scope?: string,
  ): Promise<string> {
    const code = randomBytes(24).toString('hex');
    codeStore.set(code, {
      companyId,
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
  ): Promise<{ companyId: number; userId: number; scope: string | null } | null> {
    const entry = codeStore.get(code);
    if (!entry) return null;

    // Always delete — prevents replay even on failed validation
    codeStore.delete(code);

    if (Date.now() > entry.expiresAt) return null;
    if (entry.redirectUri !== redirectUri) return null;

    const verifierHash = createHash('sha256').update(codeVerifier).digest('base64url');
    if (verifierHash !== entry.codeChallenge) return null;

    return { companyId: entry.companyId, userId: entry.userId, scope: entry.scope };
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
  companyId: number;
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

  /** Issue a signed JWT access token. */
  static async create(
    companyId: number,
    userId: number,
    scope?: string | null,
  ): Promise<OAuthTokenPair> {
    const expiresIn = 3600; // 1 hour
    const payload: AccessTokenPayload = { jti: randomBytes(16).toString('hex'), userId, companyId, scope: scope ?? null };
    const accessToken = jwt.sign(payload, OAuthTokenDB.secret, { expiresIn });
    return { accessToken, expiresIn, tokenType: 'Bearer' };
  }

  /** Verify a JWT access token. Returns user info or null if invalid/expired. */
  static async validateAccessToken(
    accessToken: string,
  ): Promise<{ companyId: number; userId: number; scope: string | null } | null> {
    try {
      const decoded = jwt.verify(accessToken, OAuthTokenDB.secret) as AccessTokenPayload;
      return { companyId: decoded.companyId, userId: decoded.userId, scope: decoded.scope };
    } catch {
      return null;
    }
  }
}
