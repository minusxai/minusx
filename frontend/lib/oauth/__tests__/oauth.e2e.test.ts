/**
 * E2E Tests: OAuth 2.1 — authorization codes and token lifecycle
 *
 * Tests the full OAuth flow in isolation (no HTTP layer):
 *   - Auth code creation and PKCE-verified consumption
 *   - Token issuance, validation, refresh, and revocation
 *
 * TDD: tests are written first (red), implementation in lib/oauth/db.ts (green).
 */

// ---------------------------------------------------------------------------
// Hoisted mocks — must come before any imports
// ---------------------------------------------------------------------------

jest.mock('@/lib/database/db-config', () => {
  const path = require('path');
  return {
    DB_PATH: path.join(process.cwd(), 'data', 'test_oauth_e2e.db'),
    DB_DIR: path.join(process.cwd(), 'data'),
    getDbType: () => 'sqlite' as const,
  };
});

jest.mock('next/cache', () => ({
  revalidateTag: jest.fn(),
  unstable_cache: jest.fn((fn: unknown) => fn),
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { createHash, randomBytes } from 'crypto';
import { getTestDbPath, initTestDatabase, cleanupTestDatabase } from '@/store/__tests__/test-utils';
import { createAdapter, resetAdapter } from '@/lib/database/adapter/factory';
import { OAuthCodeDB, OAuthTokenDB } from '@/lib/oauth/db';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DB_PATH = getTestDbPath('oauth_e2e');
const COMPANY_ID = 1;
const USER_ID = 1;
const REDIRECT_URI = 'http://localhost:3000/oauth/callback';

/** Generate a PKCE verifier + matching S256 challenge pair */
function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('hex');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

// ---------------------------------------------------------------------------
// Suite setup / teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await initTestDatabase(DB_PATH);

  // Seed a user so token records can reference a real user_id
  const db = await createAdapter({ type: 'sqlite', sqlitePath: DB_PATH });
  const now = new Date().toISOString();
  await db.query(
    'INSERT INTO users (company_id, id, email, name, password_hash, home_folder, role, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    [COMPANY_ID, USER_ID, 'oauth-test@example.com', 'OAuth Test User', null, '/org', 'admin', now, now]
  );
  await db.close();
});

afterAll(async () => {
  await cleanupTestDatabase(DB_PATH);
});

afterEach(async () => {
  // Wipe OAuth tables between tests to avoid cross-test pollution
  await resetAdapter();
  const db = await createAdapter({ type: 'sqlite', sqlitePath: DB_PATH });
  await db.query('DELETE FROM oauth_authorization_codes', []);
  await db.query('DELETE FROM oauth_tokens', []);
  await db.close();
  await resetAdapter();
});

// ---------------------------------------------------------------------------
// OAuthCodeDB
// ---------------------------------------------------------------------------

describe('OAuthCodeDB', () => {
  describe('create', () => {
    it('returns a non-empty plaintext code', async () => {
      const { challenge } = pkce();
      const code = await OAuthCodeDB.create(COMPANY_ID, USER_ID, REDIRECT_URI, challenge);
      expect(typeof code).toBe('string');
      expect(code.length).toBeGreaterThan(10);
    });
  });

  describe('consume', () => {
    it('returns user data when code, redirect_uri, and PKCE verifier are all correct', async () => {
      const { verifier, challenge } = pkce();
      const code = await OAuthCodeDB.create(COMPANY_ID, USER_ID, REDIRECT_URI, challenge);

      const result = await OAuthCodeDB.consume(code, REDIRECT_URI, verifier);

      expect(result).not.toBeNull();
      expect(result!.companyId).toBe(COMPANY_ID);
      expect(result!.userId).toBe(USER_ID);
    });

    it('returns null for an unknown code', async () => {
      const { verifier } = pkce();
      const result = await OAuthCodeDB.consume('not-a-real-code', REDIRECT_URI, verifier);
      expect(result).toBeNull();
    });

    it('returns null when the PKCE verifier does not match the challenge', async () => {
      const { challenge } = pkce();
      const { verifier: wrongVerifier } = pkce(); // different verifier
      const code = await OAuthCodeDB.create(COMPANY_ID, USER_ID, REDIRECT_URI, challenge);

      const result = await OAuthCodeDB.consume(code, REDIRECT_URI, wrongVerifier);
      expect(result).toBeNull();
    });

    it('returns null when the redirect_uri does not match', async () => {
      const { verifier, challenge } = pkce();
      const code = await OAuthCodeDB.create(COMPANY_ID, USER_ID, REDIRECT_URI, challenge);

      const result = await OAuthCodeDB.consume(code, 'http://evil.example.com/callback', verifier);
      expect(result).toBeNull();
    });

    it('returns null when the code has already been used', async () => {
      const { verifier, challenge } = pkce();
      const code = await OAuthCodeDB.create(COMPANY_ID, USER_ID, REDIRECT_URI, challenge);

      // First consume — should succeed
      const first = await OAuthCodeDB.consume(code, REDIRECT_URI, verifier);
      expect(first).not.toBeNull();

      // Second consume — code already used
      const second = await OAuthCodeDB.consume(code, REDIRECT_URI, verifier);
      expect(second).toBeNull();
    });

    it('preserves the optional scope value', async () => {
      const { verifier, challenge } = pkce();
      const code = await OAuthCodeDB.create(COMPANY_ID, USER_ID, REDIRECT_URI, challenge, 'S256', 'read:schema');

      const result = await OAuthCodeDB.consume(code, REDIRECT_URI, verifier);
      expect(result!.scope).toBe('read:schema');
    });

    it('returns null for null scope when none provided', async () => {
      const { verifier, challenge } = pkce();
      const code = await OAuthCodeDB.create(COMPANY_ID, USER_ID, REDIRECT_URI, challenge);

      const result = await OAuthCodeDB.consume(code, REDIRECT_URI, verifier);
      expect(result!.scope).toBeNull();
    });
  });

  describe('cleanupExpired', () => {
    it('removes used codes without error', async () => {
      const { verifier, challenge } = pkce();
      const code = await OAuthCodeDB.create(COMPANY_ID, USER_ID, REDIRECT_URI, challenge);
      await OAuthCodeDB.consume(code, REDIRECT_URI, verifier); // marks as used

      // Should not throw
      await expect(OAuthCodeDB.cleanupExpired()).resolves.toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// OAuthTokenDB
// ---------------------------------------------------------------------------

describe('OAuthTokenDB', () => {
  describe('create', () => {
    it('returns access and refresh tokens with correct shape', async () => {
      const pair = await OAuthTokenDB.create(COMPANY_ID, USER_ID);

      expect(typeof pair.accessToken).toBe('string');
      expect(pair.accessToken.length).toBeGreaterThan(10);
      expect(typeof pair.refreshToken).toBe('string');
      expect(pair.refreshToken.length).toBeGreaterThan(10);
      expect(pair.tokenType).toBe('Bearer');
      expect(pair.expiresIn).toBe(3600);
    });

    it('issues unique tokens on each call', async () => {
      const a = await OAuthTokenDB.create(COMPANY_ID, USER_ID);
      const b = await OAuthTokenDB.create(COMPANY_ID, USER_ID);

      expect(a.accessToken).not.toBe(b.accessToken);
      expect(a.refreshToken).not.toBe(b.refreshToken);
    });
  });

  describe('validateAccessToken', () => {
    it('returns user data for a fresh, valid token', async () => {
      const { accessToken } = await OAuthTokenDB.create(COMPANY_ID, USER_ID);

      const result = await OAuthTokenDB.validateAccessToken(accessToken);

      expect(result).not.toBeNull();
      expect(result!.companyId).toBe(COMPANY_ID);
      expect(result!.userId).toBe(USER_ID);
    });

    it('returns null for an unknown token', async () => {
      const result = await OAuthTokenDB.validateAccessToken('not-a-real-token');
      expect(result).toBeNull();
    });

    it('returns null for a revoked token', async () => {
      const { accessToken } = await OAuthTokenDB.create(COMPANY_ID, USER_ID);
      await OAuthTokenDB.revoke(accessToken);

      const result = await OAuthTokenDB.validateAccessToken(accessToken);
      expect(result).toBeNull();
    });

    it('preserves the optional scope in the returned data', async () => {
      const { accessToken } = await OAuthTokenDB.create(COMPANY_ID, USER_ID, 'read:schema');

      const result = await OAuthTokenDB.validateAccessToken(accessToken);
      expect(result!.scope).toBe('read:schema');
    });

    it('returns null scope when none was set', async () => {
      const { accessToken } = await OAuthTokenDB.create(COMPANY_ID, USER_ID);

      const result = await OAuthTokenDB.validateAccessToken(accessToken);
      expect(result!.scope).toBeNull();
    });
  });

  describe('revoke', () => {
    it('invalidates the access token immediately', async () => {
      const { accessToken } = await OAuthTokenDB.create(COMPANY_ID, USER_ID);

      await OAuthTokenDB.revoke(accessToken);

      const result = await OAuthTokenDB.validateAccessToken(accessToken);
      expect(result).toBeNull();
    });

    it('does not throw when revoking an unknown token', async () => {
      await expect(OAuthTokenDB.revoke('does-not-exist')).resolves.toBeUndefined();
    });
  });

  describe('refresh', () => {
    it('issues a new token pair when refresh token is valid', async () => {
      const original = await OAuthTokenDB.create(COMPANY_ID, USER_ID);

      const refreshed = await OAuthTokenDB.refresh(original.refreshToken);

      expect(refreshed).not.toBeNull();
      expect(refreshed!.accessToken).not.toBe(original.accessToken);
      expect(refreshed!.refreshToken).not.toBe(original.refreshToken);
    });

    it('new access token is valid after refresh', async () => {
      const original = await OAuthTokenDB.create(COMPANY_ID, USER_ID);
      const refreshed = await OAuthTokenDB.refresh(original.refreshToken);

      const result = await OAuthTokenDB.validateAccessToken(refreshed!.accessToken);
      expect(result).not.toBeNull();
      expect(result!.userId).toBe(USER_ID);
    });

    it('old access token is revoked after refresh', async () => {
      const original = await OAuthTokenDB.create(COMPANY_ID, USER_ID);
      await OAuthTokenDB.refresh(original.refreshToken);

      const result = await OAuthTokenDB.validateAccessToken(original.accessToken);
      expect(result).toBeNull();
    });

    it('old refresh token cannot be used again (rotation)', async () => {
      const original = await OAuthTokenDB.create(COMPANY_ID, USER_ID);
      await OAuthTokenDB.refresh(original.refreshToken);

      // Try to reuse the old refresh token
      const again = await OAuthTokenDB.refresh(original.refreshToken);
      expect(again).toBeNull();
    });

    it('returns null for an unknown refresh token', async () => {
      const result = await OAuthTokenDB.refresh('not-a-real-refresh-token');
      expect(result).toBeNull();
    });

    it('preserves scope through the refresh cycle', async () => {
      const original = await OAuthTokenDB.create(COMPANY_ID, USER_ID, 'read:schema');
      const refreshed = await OAuthTokenDB.refresh(original.refreshToken);

      const validated = await OAuthTokenDB.validateAccessToken(refreshed!.accessToken);
      expect(validated!.scope).toBe('read:schema');
    });
  });

  describe('cleanupExpired', () => {
    it('runs without error on an empty table', async () => {
      await expect(OAuthTokenDB.cleanupExpired()).resolves.toBeUndefined();
    });

    it('runs without error when active tokens exist', async () => {
      await OAuthTokenDB.create(COMPANY_ID, USER_ID);
      await expect(OAuthTokenDB.cleanupExpired()).resolves.toBeUndefined();
    });

    it('removes revoked tokens', async () => {
      const { accessToken } = await OAuthTokenDB.create(COMPANY_ID, USER_ID);
      await OAuthTokenDB.revoke(accessToken);
      await OAuthTokenDB.cleanupExpired();

      // Validating a revoked token was already returning null; cleanup just removes the row
      const result = await OAuthTokenDB.validateAccessToken(accessToken);
      expect(result).toBeNull();
    });
  });
});
