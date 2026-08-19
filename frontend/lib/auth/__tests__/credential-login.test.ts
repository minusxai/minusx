/**
 * The two-factor gate.
 *
 * Second factors were previously decided by `/api/auth/check-2fa` and enforced nowhere:
 * `authorize()` never consulted the flag, so posting email+password straight at the
 * credentials provider skipped the code entirely. The load-bearing test here is
 * "password alone does not log in a 2FA account" — everything else guards the paths
 * around it, including the two password shortcuts that must not sit outside the gate.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { evaluateCredentials } from '@/lib/auth/credential-login';
import { requiresTwoFactor } from '@/lib/auth/two-factor';
import { createVerifiedToken } from '@/lib/auth/otp-utils';
import { hashPassword } from '@/lib/auth/password-utils';

const EMAIL = 'user@example.com';
let PASSWORD_HASH = '';

beforeEach(async () => {
  PASSWORD_HASH = await hashPassword('correct-horse');
  vi.unstubAllEnvs();
});

const plain = () => ({ email: EMAIL, password_hash: PASSWORD_HASH, role: 'editor', phone: null, state: null });
const twoFactor = () => ({
  email: EMAIL,
  password_hash: PASSWORD_HASH,
  role: 'editor',
  phone: '+15550001111',
  state: JSON.stringify({ twofa_phone_otp_enabled: true }),
});

describe('requiresTwoFactor', () => {
  it('is true for a phone-OTP account', () => {
    expect(requiresTwoFactor(twoFactor())).toBe(true);
  });

  it('is true for the legacy whatsapp flag', () => {
    expect(requiresTwoFactor({ phone: '+15550001111', state: JSON.stringify({ twofa_whatsapp_enabled: true }) })).toBe(true);
  });

  it('is false with the flag set but no number to send to', () => {
    // Enforcing an unperformable second factor would lock the account out entirely.
    expect(requiresTwoFactor({ phone: null, state: JSON.stringify({ twofa_phone_otp_enabled: true }) })).toBe(false);
  });

  it('is false for a plain account, a null state, and a malformed state', () => {
    expect(requiresTwoFactor(plain())).toBe(false);
    expect(requiresTwoFactor({ phone: '+1', state: null })).toBe(false);
    expect(requiresTwoFactor({ phone: '+1', state: '{not json' })).toBe(false);
  });
});

describe('evaluateCredentials — account WITHOUT a second factor', () => {
  it('accepts the right password', async () => {
    expect(await evaluateCredentials(plain(), { email: EMAIL, password: 'correct-horse' })).toEqual({ ok: true });
  });

  it('rejects the wrong password', async () => {
    expect(await evaluateCredentials(plain(), { email: EMAIL, password: 'nope' })).toEqual({ ok: false, reason: 'bad-password' });
  });

  it('rejects no credentials at all', async () => {
    expect(await evaluateCredentials(plain(), { email: EMAIL })).toEqual({ ok: false, reason: 'no-password' });
  });

  it('accepts a verified-OTP token alone (passwordless email login)', async () => {
    expect(await evaluateCredentials(plain(), { email: EMAIL, otp_verified_token: createVerifiedToken(EMAIL) }))
      .toEqual({ ok: true });
  });

  it('rejects a verified-OTP token minted for a different address', async () => {
    expect(await evaluateCredentials(plain(), { email: EMAIL, otp_verified_token: createVerifiedToken('someone-else@example.com') }))
      .toEqual({ ok: false, reason: 'otp-invalid' });
  });

  it('rejects a garbage token', async () => {
    expect(await evaluateCredentials(plain(), { email: EMAIL, otp_verified_token: 'not.a.jwt' }))
      .toEqual({ ok: false, reason: 'otp-invalid' });
  });
});

describe('evaluateCredentials — account WITH a second factor', () => {
  it('REFUSES a correct password on its own', async () => {
    // The whole point. This is what shipping the gate client-side allowed.
    expect(await evaluateCredentials(twoFactor(), { email: EMAIL, password: 'correct-horse' }))
      .toEqual({ ok: false, reason: 'otp-required' });
  });

  it('accepts password + completed code challenge', async () => {
    expect(await evaluateCredentials(twoFactor(), {
      email: EMAIL, password: 'correct-horse', otp_verified_token: createVerifiedToken(EMAIL),
    })).toEqual({ ok: true });
  });

  it('REFUSES a completed code challenge on its own', async () => {
    // A passwordless email code is one factor. It must not satisfy an account that has
    // been configured to require two, whichever channel delivered it.
    expect(await evaluateCredentials(twoFactor(), { email: EMAIL, otp_verified_token: createVerifiedToken(EMAIL) }))
      .toEqual({ ok: false, reason: 'no-password' });
  });

  it('refuses a wrong password even with a valid code challenge', async () => {
    expect(await evaluateCredentials(twoFactor(), {
      email: EMAIL, password: 'nope', otp_verified_token: createVerifiedToken(EMAIL),
    })).toEqual({ ok: false, reason: 'bad-password' });
  });

  it('refuses a code challenge minted for a different address', async () => {
    expect(await evaluateCredentials(twoFactor(), {
      email: EMAIL, password: 'correct-horse', otp_verified_token: createVerifiedToken('attacker@example.com'),
    })).toEqual({ ok: false, reason: 'otp-required' });
  });
});

describe('the password shortcuts sit inside the gate, not around it', () => {
  it('ADMIN_PWD does not bypass a second factor', async () => {
    vi.resetModules();
    vi.doMock('@/lib/config', async (orig) => ({
      ...(await orig<typeof import('@/lib/config')>()),
      ADMIN_PWD: 'super-secret-admin',
    }));
    const { evaluateCredentials: evaluate } = await import('@/lib/auth/credential-login');

    const admin = { ...twoFactor(), role: 'admin' };
    expect(await evaluate(admin, { email: EMAIL, password: 'super-secret-admin' }))
      .toEqual({ ok: false, reason: 'otp-required' });

    // ...and still works as a password when there is no second factor to satisfy.
    expect(await evaluate({ ...plain(), role: 'admin' }, { email: EMAIL, password: 'super-secret-admin' }))
      .toEqual({ ok: true });

    vi.doUnmock('@/lib/config');
    vi.resetModules();
  });

  it('the dev email-as-password shortcut does not bypass a second factor', async () => {
    vi.resetModules();
    vi.doMock('@/lib/constants', async (orig) => ({
      ...(await orig<typeof import('@/lib/constants')>()),
      IS_DEV: true,
    }));
    const { evaluateCredentials: evaluate } = await import('@/lib/auth/credential-login');

    expect(await evaluate(twoFactor(), { email: EMAIL, password: EMAIL }))
      .toEqual({ ok: false, reason: 'otp-required' });

    vi.doUnmock('@/lib/constants');
    vi.resetModules();
  });
});

describe('accounts with no password hash', () => {
  it('cannot log in with any password', async () => {
    const noHash = { email: EMAIL, password_hash: null, role: 'editor', phone: null, state: null };
    expect(await evaluateCredentials(noHash, { email: EMAIL, password: 'anything' }))
      .toEqual({ ok: false, reason: 'bad-password' });
  });

  it('can still log in with a completed code challenge', async () => {
    const noHash = { email: EMAIL, password_hash: null, role: 'editor', phone: null, state: null };
    expect(await evaluateCredentials(noHash, { email: EMAIL, otp_verified_token: createVerifiedToken(EMAIL) }))
      .toEqual({ ok: true });
  });
});
