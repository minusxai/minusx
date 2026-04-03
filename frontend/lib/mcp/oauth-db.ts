/**
 * OAuth 2.1 database operations for MCP and general API auth.
 *
 * Manages authorization codes and access/refresh tokens.
 * Tokens are stored as SHA-256 hashes — plaintext is never persisted.
 */

import 'server-only';
import { randomBytes, createHash } from 'crypto';
import { getAdapter } from '@/lib/database/adapter/factory';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function generateToken(): string {
  return randomBytes(32).toString('hex');
}

function generateCode(): string {
  return randomBytes(24).toString('hex');
}

// ---------------------------------------------------------------------------
// OAuthCodeDB — short-lived authorization codes
// ---------------------------------------------------------------------------

interface OAuthCodeRow {
  code: string;
  company_id: number;
  user_id: number;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  scope: string | null;
  created_at: string;
  expires_at: string;
  used: number | boolean;
}

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
    codeChallengeMethod: string = 'S256',
    scope?: string
  ): Promise<string> {
    const db = await getAdapter();
    const code = generateCode();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    await db.query(
      `INSERT INTO oauth_authorization_codes
        (code, company_id, user_id, redirect_uri, code_challenge, code_challenge_method, scope, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [code, companyId, userId, redirectUri, codeChallenge, codeChallengeMethod, scope ?? null, expiresAt]
    );

    return code;
  }

  /**
   * Consume a code: validate, mark as used, and return the associated data.
   * Returns null if code is invalid, expired, or already used.
   */
  static async consume(
    code: string,
    redirectUri: string,
    codeVerifier: string
  ): Promise<{ companyId: number; userId: number; scope: string | null } | null> {
    const db = await getAdapter();

    const result = await db.query<OAuthCodeRow>(
      'SELECT * FROM oauth_authorization_codes WHERE code = $1',
      [code]
    );

    if (result.rows.length === 0) return null;
    const row = result.rows[0];

    // Already used
    if (row.used === 1 || row.used === true) return null;

    // Expired
    if (new Date(row.expires_at) < new Date()) return null;

    // Redirect URI must match
    if (row.redirect_uri !== redirectUri) return null;

    // PKCE verification (S256: BASE64URL(SHA256(code_verifier)) === code_challenge)
    const verifierHash = createHash('sha256').update(codeVerifier).digest('base64url');
    if (verifierHash !== row.code_challenge) return null;

    // Mark as used
    await db.query('UPDATE oauth_authorization_codes SET used = 1 WHERE code = $1', [code]);

    return {
      companyId: row.company_id,
      userId: row.user_id,
      scope: row.scope,
    };
  }

  /** Delete expired codes (housekeeping). */
  static async cleanupExpired(): Promise<void> {
    const db = await getAdapter();
    await db.query(
      "DELETE FROM oauth_authorization_codes WHERE expires_at < CURRENT_TIMESTAMP OR used = 1",
      []
    );
  }
}

// ---------------------------------------------------------------------------
// OAuthTokenDB — access and refresh tokens
// ---------------------------------------------------------------------------

interface OAuthTokenRow {
  token_hash: string;
  refresh_token_hash: string | null;
  company_id: number;
  user_id: number;
  scope: string | null;
  created_at: string;
  expires_at: string;
  refresh_expires_at: string | null;
  revoked_at: string | null;
}

export interface OAuthTokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;       // seconds
  tokenType: 'Bearer';
}

export class OAuthTokenDB {
  /**
   * Issue a new access + refresh token pair.
   * Returns plaintext tokens (shown once). DB stores only hashes.
   */
  static async create(
    companyId: number,
    userId: number,
    scope?: string | null
  ): Promise<OAuthTokenPair> {
    const db = await getAdapter();

    const accessToken = generateToken();
    const refreshToken = generateToken();
    const accessHash = sha256(accessToken);
    const refreshHash = sha256(refreshToken);

    const expiresIn = 3600; // 1 hour
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days

    await db.query(
      `INSERT INTO oauth_tokens
        (token_hash, refresh_token_hash, company_id, user_id, scope, expires_at, refresh_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [accessHash, refreshHash, companyId, userId, scope ?? null, expiresAt, refreshExpiresAt]
    );

    return {
      accessToken,
      refreshToken,
      expiresIn,
      tokenType: 'Bearer',
    };
  }

  /**
   * Validate an access token. Returns user info or null.
   */
  static async validateAccessToken(
    accessToken: string
  ): Promise<{ companyId: number; userId: number; scope: string | null } | null> {
    const db = await getAdapter();
    const hash = sha256(accessToken);

    const result = await db.query<OAuthTokenRow>(
      'SELECT * FROM oauth_tokens WHERE token_hash = $1',
      [hash]
    );

    if (result.rows.length === 0) return null;
    const row = result.rows[0];

    // Revoked
    if (row.revoked_at) return null;

    // Expired
    if (new Date(row.expires_at) < new Date()) return null;

    return {
      companyId: row.company_id,
      userId: row.user_id,
      scope: row.scope,
    };
  }

  /**
   * Exchange a refresh token for a new token pair.
   * Revokes the old pair and issues fresh tokens.
   */
  static async refresh(
    refreshToken: string
  ): Promise<OAuthTokenPair | null> {
    const db = await getAdapter();
    const hash = sha256(refreshToken);

    const result = await db.query<OAuthTokenRow>(
      'SELECT * FROM oauth_tokens WHERE refresh_token_hash = $1',
      [hash]
    );

    if (result.rows.length === 0) return null;
    const row = result.rows[0];

    // Revoked
    if (row.revoked_at) return null;

    // Refresh expired
    if (row.refresh_expires_at && new Date(row.refresh_expires_at) < new Date()) return null;

    // Revoke old token pair
    await db.query(
      'UPDATE oauth_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE token_hash = $1',
      [row.token_hash]
    );

    // Issue new pair
    return OAuthTokenDB.create(row.company_id, row.user_id, row.scope);
  }

  /** Revoke a specific access token. */
  static async revoke(accessToken: string): Promise<void> {
    const db = await getAdapter();
    const hash = sha256(accessToken);
    await db.query(
      'UPDATE oauth_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE token_hash = $1',
      [hash]
    );
  }

  /** Delete expired and revoked tokens (housekeeping). */
  static async cleanupExpired(): Promise<void> {
    const db = await getAdapter();
    await db.query(
      "DELETE FROM oauth_tokens WHERE revoked_at IS NOT NULL OR (expires_at < CURRENT_TIMESTAMP AND (refresh_expires_at IS NULL OR refresh_expires_at < CURRENT_TIMESTAMP))",
      []
    );
  }
}
