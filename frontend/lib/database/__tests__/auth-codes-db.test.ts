/**
 * The guarantees that make a 6-digit code a secret.
 *
 * A 10^6 space is only unguessable while the number of guesses is bounded, so these
 * tests are about the bound, not about the happy path: attempts are capped per code,
 * issuing a new code retires the previous one (or the real budget is attempts × sends),
 * a correct code works exactly once, and the send rate is capped per address.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { AuthCodesDB } from '@/lib/database/auth-codes-db';
import { hashOTP } from '@/lib/auth/otp-utils';
import {
  OTP_MAX_ATTEMPTS,
  OTP_MAX_SENDS_PER_WINDOW,
  OTP_RETENTION_MS,
  OTP_SEND_WINDOW_MS,
  OTP_TTL_MS,
} from '@/lib/auth/auth-constants';

const EMAIL = 'otp-user@example.com';
const NOW = 1_800_000_000_000;

async function clear() {
  const { getModules } = await import('@/lib/modules/registry');
  await getModules().db.exec('DELETE FROM auth_codes');
}

async function rowFor(handle: string) {
  const { getModules } = await import('@/lib/modules/registry');
  const r = await getModules().db.exec<{ code_hash: string; attempts: number; consumed_at: string | number | null }>(
    'SELECT code_hash, attempts, consumed_at FROM auth_codes WHERE handle = $1',
    [handle],
  );
  return r.rows[0] ?? null;
}

/** Issue a real code and return its handle, failing loudly if throttled. */
async function issue(code: string, opts: { now?: number; email?: string; channel?: 'email' | 'phone' } = {}) {
  const res = await AuthCodesDB.issue({
    email: opts.email ?? EMAIL,
    channel: opts.channel ?? 'email',
    code,
    now: opts.now ?? NOW,
  });
  if ('throttled' in res) throw new Error('unexpectedly throttled');
  return res.handle;
}

describe('AuthCodesDB', () => {
  setupTestDb(getTestDbPath('auth_codes'));
  beforeEach(clear);

  describe('the code never leaves the server', () => {
    it('stores a digest, and the handle is not derived from the code', async () => {
      const handle = await issue('123456');
      const row = await rowFor(handle);

      expect(row!.code_hash).toBe(hashOTP('123456'));
      // The handle is the only thing the client receives. Nothing about the code may be
      // recoverable from it — this is the defect the predecessor JWT design had.
      expect(handle).not.toContain('123456');
      expect(handle).not.toContain(hashOTP('123456'));
      expect(handle).toMatch(/^[0-9a-f]{64}$/);
    });

    it('issues a different handle every time', async () => {
      const handles = new Set<string>();
      for (let i = 0; i < 20; i++) {
        await clear();
        handles.add(await issue('123456'));
      }
      expect(handles.size).toBe(20);
    });
  });

  describe('attempt cap', () => {
    it('accepts the correct code', async () => {
      const handle = await issue('123456');
      expect(await AuthCodesDB.verify(handle, '123456', NOW)).toEqual({
        ok: true, email: EMAIL, channel: 'email',
      });
    });

    it('stops accepting guesses after OTP_MAX_ATTEMPTS wrong ones', async () => {
      const handle = await issue('123456');

      for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
        expect(await AuthCodesDB.verify(handle, '000000', NOW)).toEqual({ ok: false, reason: 'invalid' });
      }

      // The budget is spent — and crucially the CORRECT code no longer works either,
      // or the cap would only be slowing an attacker down rather than stopping them.
      expect(await AuthCodesDB.verify(handle, '000000', NOW)).toEqual({ ok: false, reason: 'exhausted' });
      expect(await AuthCodesDB.verify(handle, '123456', NOW)).toEqual({ ok: false, reason: 'exhausted' });
    });

    it('counts the attempt before comparing, so a wrong guess always costs budget', async () => {
      const handle = await issue('123456');
      await AuthCodesDB.verify(handle, '000000', NOW);
      expect((await rowFor(handle))!.attempts).toBe(1);
    });

    it('never counts more attempts than the cap allows, however they arrive', async () => {
      const handle = await issue('123456');
      await Promise.all(
        Array.from({ length: 10 }, () => AuthCodesDB.verify(handle, '000000', NOW)),
      );
      expect((await rowFor(handle))!.attempts).toBe(OTP_MAX_ATTEMPTS);
      // NOTE: this does NOT prove the increment is race-free. `PgliteAdapter` funnels
      // every query through a promise chain, so `Promise.all` here runs sequentially and
      // a naive SELECT-then-UPDATE would pass too. The atomicity comes from the single
      // guarded `UPDATE … RETURNING` in `verify`, and only real Postgres could observe
      // it. What this pins is the cap arithmetic.
    });
  });

  describe('single use', () => {
    it('consumes the code on success, so it cannot be replayed', async () => {
      const handle = await issue('123456');

      expect(await AuthCodesDB.verify(handle, '123456', NOW)).toMatchObject({ ok: true });
      expect(await AuthCodesDB.verify(handle, '123456', NOW)).toEqual({ ok: false, reason: 'invalid' });
    });

    it('lets exactly one of two correct submissions win', async () => {
      const handle = await issue('123456');
      const results = await Promise.all([
        AuthCodesDB.verify(handle, '123456', NOW),
        AuthCodesDB.verify(handle, '123456', NOW),
      ]);
      expect(results.filter(r => r.ok)).toHaveLength(1);
      // As above: PGLite serializes these, so this pins the single-use rule rather than
      // the concurrency guard (`WHERE consumed_at IS NULL` on the consuming UPDATE).
    });
  });

  describe('expiry', () => {
    it('refuses a code past its TTL', async () => {
      const handle = await issue('123456');
      expect(await AuthCodesDB.verify(handle, '123456', NOW + OTP_TTL_MS + 1)).toEqual({
        ok: false, reason: 'invalid',
      });
    });

    it('accepts a code just inside its TTL', async () => {
      const handle = await issue('123456');
      expect(await AuthCodesDB.verify(handle, '123456', NOW + OTP_TTL_MS - 1000)).toMatchObject({ ok: true });
    });
  });

  describe('issuing retires the previous code', () => {
    it('kills the old code, so the attempt budget cannot be multiplied by re-sending', async () => {
      const first = await issue('111111');
      const second = await issue('222222');

      expect(await AuthCodesDB.verify(first, '111111', NOW)).toEqual({ ok: false, reason: 'invalid' });
      expect(await AuthCodesDB.verify(second, '222222', NOW)).toMatchObject({ ok: true });
    });

    it('retires across channels — one live code per address, not one per channel', async () => {
      const emailCode = await issue('111111', { channel: 'email' });
      await issue('222222', { channel: 'phone' });

      expect(await AuthCodesDB.verify(emailCode, '111111', NOW)).toEqual({ ok: false, reason: 'invalid' });
    });

    it('does not retire another address\'s code', async () => {
      const mine = await issue('111111');
      await issue('222222', { email: 'someone-else@example.com' });

      expect(await AuthCodesDB.verify(mine, '111111', NOW)).toMatchObject({ ok: true });
    });

    it('a DECOY does not retire a live code — naming an address must not cancel its login', async () => {
      const real = await issue('111111');
      await AuthCodesDB.issue({ email: EMAIL, channel: 'email', code: null, now: NOW });

      expect(await AuthCodesDB.verify(real, '111111', NOW)).toMatchObject({ ok: true });
    });

    it('a decoy can never be verified', async () => {
      const res = await AuthCodesDB.issue({ email: EMAIL, channel: 'email', code: null, now: NOW });
      const handle = 'handle' in res ? res.handle : '';

      // Exhaust every guess a caller is allowed; none may match.
      for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
        expect(await AuthCodesDB.verify(handle, String(100000 + i), NOW)).toEqual({ ok: false, reason: 'invalid' });
      }
    });
  });

  describe('send throttle', () => {
    it('caps how many codes one address can have sent to it in a window', async () => {
      for (let i = 0; i < OTP_MAX_SENDS_PER_WINDOW; i++) {
        expect(await AuthCodesDB.issue({ email: EMAIL, channel: 'email', code: '123456', now: NOW + i })).toHaveProperty('handle');
      }
      expect(await AuthCodesDB.issue({ email: EMAIL, channel: 'email', code: '123456', now: NOW + 99 }))
        .toEqual({ throttled: true });
    });

    it('counts decoys too, so an unknown address is throttled identically', async () => {
      for (let i = 0; i < OTP_MAX_SENDS_PER_WINDOW; i++) {
        await AuthCodesDB.issue({ email: EMAIL, channel: 'email', code: null, now: NOW + i });
      }
      expect(await AuthCodesDB.issue({ email: EMAIL, channel: 'email', code: '123456', now: NOW + 99 }))
        .toEqual({ throttled: true });
    });

    it('throttles per address, not globally', async () => {
      for (let i = 0; i < OTP_MAX_SENDS_PER_WINDOW; i++) {
        await AuthCodesDB.issue({ email: EMAIL, channel: 'email', code: '123456', now: NOW + i });
      }
      expect(await AuthCodesDB.issue({ email: 'other@example.com', channel: 'email', code: '123456', now: NOW + 99 }))
        .toHaveProperty('handle');
    });

    it('frees budget once the window has passed', async () => {
      for (let i = 0; i < OTP_MAX_SENDS_PER_WINDOW; i++) {
        await AuthCodesDB.issue({ email: EMAIL, channel: 'email', code: '123456', now: NOW + i });
      }
      expect(await AuthCodesDB.issue({ email: EMAIL, channel: 'email', code: '123456', now: NOW + OTP_SEND_WINDOW_MS + 1 }))
        .toHaveProperty('handle');
    });

    it('keeps counting a row whose CODE has expired but whose window has not', async () => {
      // The two clocks are different on purpose. Pruning on code expiry (minutes) would
      // hand back send budget long before the throttle window (longer) closed.
      for (let i = 0; i < OTP_MAX_SENDS_PER_WINDOW; i++) {
        await AuthCodesDB.issue({ email: EMAIL, channel: 'email', code: '123456', now: NOW + i });
      }
      const afterCodesExpired = NOW + OTP_TTL_MS + 1000;
      expect(afterCodesExpired).toBeLessThan(NOW + OTP_SEND_WINDOW_MS);
      expect(await AuthCodesDB.issue({ email: EMAIL, channel: 'email', code: '123456', now: afterCodesExpired }))
        .toEqual({ throttled: true });
    });
  });

  describe('retention', () => {
    it('prunes rows older than the retention window', async () => {
      const { getModules } = await import('@/lib/modules/registry');
      await issue('111111');

      await AuthCodesDB.issue({
        email: 'later@example.com', channel: 'email', code: '222222',
        now: NOW + OTP_RETENTION_MS + 1,
      });

      const { rows } = await getModules().db.exec<{ email: string }>('SELECT email FROM auth_codes');
      expect(rows.map(r => r.email)).toEqual(['later@example.com']);
    });
  });

  describe('unknown handles', () => {
    it('rejects a handle that was never issued', async () => {
      expect(await AuthCodesDB.verify('f'.repeat(64), '123456', NOW)).toEqual({ ok: false, reason: 'invalid' });
    });

    it('rejects an empty handle', async () => {
      expect(await AuthCodesDB.verify('', '123456', NOW)).toEqual({ ok: false, reason: 'invalid' });
    });
  });
});
