/**
 * Unit Tests: OAuth 2.1 — authorization codes and access tokens
 *
 * No database — auth codes are in-memory, access tokens are JWTs.
 */

jest.mock('next/cache', () => ({
  revalidateTag: jest.fn(),
  unstable_cache: jest.fn((fn: unknown) => fn),
}));

jest.mock('@/lib/config', () => ({
  NEXTAUTH_SECRET: 'test-secret-for-unit-tests',
}));

import { createHash, randomBytes } from 'crypto';
import { OAuthCodeDB, OAuthTokenDB } from '@/lib/oauth/db';

const USER_ID = 42;
const REDIRECT_URI = 'http://localhost:3000/oauth/callback';

function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('hex');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

// ---------------------------------------------------------------------------
// OAuthCodeDB
// ---------------------------------------------------------------------------

describe('OAuthCodeDB', () => {
  describe('create', () => {
    it('returns a non-empty plaintext code', async () => {
      const { challenge } = pkce();
      const code = await OAuthCodeDB.create(USER_ID, REDIRECT_URI, challenge);
      expect(typeof code).toBe('string');
      expect(code.length).toBeGreaterThan(10);
    });
  });

  describe('consume', () => {
    it('returns user data when code, redirect_uri, and PKCE verifier are correct', async () => {
      const { verifier, challenge } = pkce();
      const code = await OAuthCodeDB.create(USER_ID, REDIRECT_URI, challenge);

      const result = await OAuthCodeDB.consume(code, REDIRECT_URI, verifier);

      expect(result).not.toBeNull();
      expect(result!.userId).toBe(USER_ID);
    });

    it('returns null for an unknown code', async () => {
      const { verifier } = pkce();
      expect(await OAuthCodeDB.consume('not-a-real-code', REDIRECT_URI, verifier)).toBeNull();
    });

    it('returns null when PKCE verifier does not match', async () => {
      const { challenge } = pkce();
      const { verifier: wrongVerifier } = pkce();
      const code = await OAuthCodeDB.create(USER_ID, REDIRECT_URI, challenge);

      expect(await OAuthCodeDB.consume(code, REDIRECT_URI, wrongVerifier)).toBeNull();
    });

    it('returns null when redirect_uri does not match', async () => {
      const { verifier, challenge } = pkce();
      const code = await OAuthCodeDB.create(USER_ID, REDIRECT_URI, challenge);

      expect(await OAuthCodeDB.consume(code, 'http://evil.example.com/callback', verifier)).toBeNull();
    });

    it('returns null on second consume — code is single-use', async () => {
      const { verifier, challenge } = pkce();
      const code = await OAuthCodeDB.create(USER_ID, REDIRECT_URI, challenge);

      const first = await OAuthCodeDB.consume(code, REDIRECT_URI, verifier);
      expect(first).not.toBeNull();

      const second = await OAuthCodeDB.consume(code, REDIRECT_URI, verifier);
      expect(second).toBeNull();
    });

    it('preserves the optional scope value', async () => {
      const { verifier, challenge } = pkce();
      const code = await OAuthCodeDB.create(USER_ID, REDIRECT_URI, challenge, 'S256', 'read:schema');

      const result = await OAuthCodeDB.consume(code, REDIRECT_URI, verifier);
      expect(result!.scope).toBe('read:schema');
    });

    it('returns null scope when none provided', async () => {
      const { verifier, challenge } = pkce();
      const code = await OAuthCodeDB.create(USER_ID, REDIRECT_URI, challenge);

      const result = await OAuthCodeDB.consume(code, REDIRECT_URI, verifier);
      expect(result!.scope).toBeNull();
    });

    it('returns null for an expired code', async () => {
      const { verifier, challenge } = pkce();
      const code = await OAuthCodeDB.create(USER_ID, REDIRECT_URI, challenge);

      // Manually expire the entry by backdating it
      const store = (globalThis as Record<string, unknown>).__oauthCodes as Map<string, { expiresAt: number }>;
      const entry = store.get(code)!;
      entry.expiresAt = Date.now() - 1000;

      expect(await OAuthCodeDB.consume(code, REDIRECT_URI, verifier)).toBeNull();
    });
  });

  describe('cleanupExpired', () => {
    it('removes expired entries without error', async () => {
      const { challenge } = pkce();
      const code = await OAuthCodeDB.create(USER_ID, REDIRECT_URI, challenge);

      // Expire it
      const store = (globalThis as Record<string, unknown>).__oauthCodes as Map<string, { expiresAt: number }>;
      store.get(code)!.expiresAt = Date.now() - 1000;

      await expect(OAuthCodeDB.cleanupExpired()).resolves.toBeUndefined();

      // Entry should be gone
      expect(store.has(code)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// OAuthTokenDB
// ---------------------------------------------------------------------------

describe('OAuthTokenDB', () => {
  describe('create', () => {
    it('returns an access token with correct shape', async () => {
      const pair = await OAuthTokenDB.create(USER_ID);

      expect(typeof pair.accessToken).toBe('string');
      expect(pair.accessToken.length).toBeGreaterThan(10);
      expect(pair.tokenType).toBe('Bearer');
      expect(pair.expiresIn).toBe(3600);
    });

    it('issues unique tokens on each call', async () => {
      const a = await OAuthTokenDB.create(USER_ID);
      const b = await OAuthTokenDB.create(USER_ID);

      expect(a.accessToken).not.toBe(b.accessToken);
    });
  });

  describe('validateAccessToken', () => {
    it('returns user data for a fresh valid token', async () => {
      const { accessToken } = await OAuthTokenDB.create(USER_ID);

      const result = await OAuthTokenDB.validateAccessToken(accessToken);

      expect(result).not.toBeNull();
      expect(result!.userId).toBe(USER_ID);
    });

    it('returns null for a garbage string', async () => {
      expect(await OAuthTokenDB.validateAccessToken('not-a-jwt')).toBeNull();
    });

    it('returns null for a token signed with a different secret', async () => {
      // Sign with wrong secret using the same jwt library
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const jwt = require('jsonwebtoken') as typeof import('jsonwebtoken');
      const forged = jwt.sign({ userId: USER_ID, scope: null }, 'wrong-secret', { expiresIn: 3600 });

      expect(await OAuthTokenDB.validateAccessToken(forged)).toBeNull();
    });

    it('returns null for an expired token', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const jwt = require('jsonwebtoken') as typeof import('jsonwebtoken');
      const expired = jwt.sign(
        { userId: USER_ID, scope: null },
        'test-secret-for-unit-tests',
        { expiresIn: -1 }, // already expired
      );

      expect(await OAuthTokenDB.validateAccessToken(expired)).toBeNull();
    });

    it('preserves the optional scope in the returned data', async () => {
      const { accessToken } = await OAuthTokenDB.create(USER_ID, 'read:schema');

      const result = await OAuthTokenDB.validateAccessToken(accessToken);
      expect(result!.scope).toBe('read:schema');
    });

    it('returns null scope when none was set', async () => {
      const { accessToken } = await OAuthTokenDB.create(USER_ID);

      const result = await OAuthTokenDB.validateAccessToken(accessToken);
      expect(result!.scope).toBeNull();
    });
  });
});
