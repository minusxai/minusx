/**
 * The failed-password limiter.
 *
 * `/api/auth/check-2fa` answers "is this the password for this account" with 200 vs 401,
 * unauthenticated and — until this — unlimited. Throttling that one route would only
 * have moved the question, because the NextAuth credentials callback answers it too, so
 * the counter sits under the shared decision and these tests drive it from there.
 *
 * The load-bearing cases are the two that make it a real limit rather than a speed bump:
 * an UNKNOWN address is counted exactly like a real one (or being rate-limited is itself
 * a user-existence oracle), and the lock covers a correct password too (or it merely
 * slows a guesser down).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { attemptCredentialLogin } from '@/lib/auth/credential-login';
import { LoginAttemptsDB } from '@/lib/database/login-attempts-db';
import { createVerifiedToken } from '@/lib/auth/otp-utils';
import { hashPassword } from '@/lib/auth/password-utils';
import { LOGIN_FAILURE_WINDOW_MS, LOGIN_MAX_FAILURES } from '@/lib/auth/auth-constants';

const EMAIL = 'limiter@example.com';
const NOW = 1_800_000_000_000;
let PASSWORD_HASH = '';

async function clear() {
  const { getModules } = await import('@/lib/modules/registry');
  await getModules().db.exec('DELETE FROM login_attempts');
}

const plain = () => ({ email: EMAIL, password_hash: PASSWORD_HASH, role: 'editor', phone: null, state: null });
const twoFactor = () => ({
  ...plain(),
  phone: '+15550001111',
  state: JSON.stringify({ twofa_phone_otp_enabled: true }),
});

/** Burn the whole budget with wrong passwords. */
async function exhaust(user: Parameters<typeof attemptCredentialLogin>[0], email = EMAIL) {
  for (let i = 0; i < LOGIN_MAX_FAILURES; i++) {
    await attemptCredentialLogin(user, { email, password: 'wrong' }, NOW);
  }
}

describe('login rate limit', () => {
  setupTestDb(getTestDbPath('login_attempts'));

  beforeEach(async () => {
    PASSWORD_HASH = await hashPassword('correct-horse');
    await clear();
  });

  it('allows the correct password through when nothing is counted', async () => {
    expect(await attemptCredentialLogin(plain(), { email: EMAIL, password: 'correct-horse' }, NOW))
      .toEqual({ ok: true });
  });

  it('locks the address after LOGIN_MAX_FAILURES wrong passwords', async () => {
    await exhaust(plain());
    expect(await attemptCredentialLogin(plain(), { email: EMAIL, password: 'wrong' }, NOW))
      .toEqual({ ok: false, reason: 'rate-limited' });
  });

  it('refuses the CORRECT password while locked', async () => {
    // Without this the cap only slows a guesser down: they would still learn which
    // password is right the moment they hit it.
    await exhaust(plain());
    expect(await attemptCredentialLogin(plain(), { email: EMAIL, password: 'correct-horse' }, NOW))
      .toEqual({ ok: false, reason: 'rate-limited' });
  });

  it('counts an UNKNOWN address identically, so being locked reveals no account', async () => {
    const unknown = 'ghost@example.com';
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) {
      expect(await attemptCredentialLogin(null, { email: unknown, password: 'wrong' }, NOW))
        .toEqual({ ok: false, reason: 'bad-password' });
    }
    expect(await attemptCredentialLogin(null, { email: unknown, password: 'wrong' }, NOW))
      .toEqual({ ok: false, reason: 'rate-limited' });
  });

  it('an unknown address answers as a wrong password does, up to the cap', async () => {
    const a = await attemptCredentialLogin(null, { email: 'ghost@example.com', password: 'x' }, NOW);
    const b = await attemptCredentialLogin(plain(), { email: EMAIL, password: 'wrong' }, NOW);
    expect(a).toEqual(b);
  });

  it('is per address, not global', async () => {
    await exhaust(plain());
    expect(await attemptCredentialLogin(
      { ...plain(), email: 'other@example.com' },
      { email: 'other@example.com', password: 'correct-horse' },
      NOW,
    )).toEqual({ ok: true });
  });

  it('cannot be reset by varying the case of the address', async () => {
    await exhaust(plain());
    expect(await attemptCredentialLogin(plain(), { email: EMAIL.toUpperCase(), password: 'wrong' }, NOW))
      .toEqual({ ok: false, reason: 'rate-limited' });
  });

  it('frees the address once the window has passed', async () => {
    await exhaust(plain());
    expect(await attemptCredentialLogin(plain(), { email: EMAIL, password: 'correct-horse' }, NOW + LOGIN_FAILURE_WINDOW_MS + 1))
      .toEqual({ ok: true });
  });

  it('does not extend the window on every new failure', async () => {
    // A fixed window, not a sliding one: a steady drip of guesses must not hold an
    // address locked forever.
    await exhaust(plain());
    await attemptCredentialLogin(plain(), { email: EMAIL, password: 'wrong' }, NOW + LOGIN_FAILURE_WINDOW_MS - 1);
    expect(await attemptCredentialLogin(plain(), { email: EMAIL, password: 'correct-horse' }, NOW + LOGIN_FAILURE_WINDOW_MS + 1))
      .toEqual({ ok: true });
  });

  describe('what counts as a failure', () => {
    it('a correct password clears the count', async () => {
      for (let i = 0; i < LOGIN_MAX_FAILURES - 1; i++) {
        await attemptCredentialLogin(plain(), { email: EMAIL, password: 'wrong' }, NOW);
      }
      await attemptCredentialLogin(plain(), { email: EMAIL, password: 'correct-horse' }, NOW);

      // The budget is back to full, not one away from a lock.
      for (let i = 0; i < LOGIN_MAX_FAILURES; i++) {
        expect(await attemptCredentialLogin(plain(), { email: EMAIL, password: 'wrong' }, NOW))
          .toEqual({ ok: false, reason: 'bad-password' });
      }
    });

    it('a correct password awaiting its second factor also clears the count', async () => {
      // Otherwise every completed 2FA sign-in would spend login budget.
      for (let i = 0; i < LOGIN_MAX_FAILURES - 1; i++) {
        await attemptCredentialLogin(twoFactor(), { email: EMAIL, password: 'wrong' }, NOW);
      }
      expect(await attemptCredentialLogin(twoFactor(), { email: EMAIL, password: 'correct-horse' }, NOW))
        .toEqual({ ok: false, reason: 'otp-required' });

      expect(await LoginAttemptsDB.isLocked(EMAIL, NOW)).toBe(false);
      expect(await attemptCredentialLogin(twoFactor(), { email: EMAIL, password: 'wrong' }, NOW))
        .toEqual({ ok: false, reason: 'bad-password' });
    });

    it('a code-only attempt does not burn login budget', async () => {
      // A stranger must not be able to lock an address out through an endpoint that
      // never sees a password.
      for (let i = 0; i < LOGIN_MAX_FAILURES * 2; i++) {
        await attemptCredentialLogin(plain(), { email: EMAIL, otp_verified_token: 'garbage' }, NOW);
      }
      expect(await attemptCredentialLogin(plain(), { email: EMAIL, password: 'correct-horse' }, NOW))
        .toEqual({ ok: true });
    });

    it('a passwordless code login still works while the count is partly spent', async () => {
      await attemptCredentialLogin(plain(), { email: EMAIL, password: 'wrong' }, NOW);
      expect(await attemptCredentialLogin(plain(), { email: EMAIL, otp_verified_token: createVerifiedToken(EMAIL) }, NOW))
        .toEqual({ ok: true });
    });
  });
});
