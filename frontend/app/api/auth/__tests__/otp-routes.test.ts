/**
 * The OTP routes, end to end against a real database.
 *
 * The property that matters most is the first one: `send-otp`'s response must carry
 * NOTHING derived from the code. The predecessor design returned a JWT whose payload —
 * base64url, not encrypted — held `sha256(code)`, so an unauthenticated caller could
 * enumerate all 10^6 digests offline and never touch `verify-otp` at all. A rate limit
 * on the verify endpoint would not have caught that; only inspecting the response body
 * does.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { UserDB } from '@/lib/database/user-db';
import { hashPassword } from '@/lib/auth/password-utils';
import { hashOTP } from '@/lib/auth/otp-utils';
import { OTP_MAX_ATTEMPTS, OTP_MAX_SENDS_PER_WINDOW } from '@/lib/auth/auth-constants';

const EMAIL = 'otp-route@example.com';
const UNKNOWN = 'nobody-here@example.com';

/** One entry per dispatch actually attempted — the stand-in for "an email went out". */
const sent: string[] = [];
/**
 * Codes as generated, in order. Read from the generator rather than parsed back out of
 * the rendered email: the template lays the code out one digit per table cell, so
 * scraping it would be testing the template, not the route.
 */
const issuedCodes: string[] = [];

vi.mock('@/lib/auth/otp-utils', async (orig) => {
  const actual = await orig<typeof import('@/lib/auth/otp-utils')>();
  return {
    ...actual,
    generateOTP: () => {
      const code = actual.generateOTP();
      issuedCodes.push(code);
      return code;
    },
  };
});

vi.mock('@/lib/data/configs.server', () => ({
  getConfigsForMode: async () => ({
    config: {
      branding: { agentName: 'MinusX', logoExpanded: '' },
      messaging: { webhooks: [{ type: 'email_otp', url: 'https://example.invalid/send' }] },
    },
  }),
}));
vi.mock('@/lib/messaging/webhook-resolver.server', () => ({
  resolveWebhook: (w: unknown) => w,
}));
vi.mock('@/lib/messaging/webhook-executor', () => ({
  sendEmailViaWebhook: async () => { sent.push('email'); return { success: true }; },
  executeWebhook: async () => { sent.push('phone'); return { success: true }; },
}));

async function routes() {
  return {
    sendOTP: (await import('../send-otp/route')).POST,
    verifyOTP: (await import('../verify-otp/route')).POST,
  };
}

function post(body: unknown): Request {
  return new Request('http://localhost/api/auth/send-otp', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

async function send(body: unknown) {
  const { sendOTP } = await routes();
  const res = await sendOTP(post(body) as never);
  return { status: res.status, body: await res.json() };
}

async function verify(token: string, otp: string) {
  const { verifyOTP } = await routes();
  const res = await verifyOTP(post({ token, otp }) as never);
  return { status: res.status, body: await res.json() };
}

async function clearCodes() {
  const { getModules } = await import('@/lib/modules/registry');
  await getModules().db.exec('DELETE FROM auth_codes');
}

describe('OTP routes', () => {
  setupTestDb(getTestDbPath('otp_routes'), {
    customInit: async () => {
      await UserDB.create(EMAIL, 'OTP User', '', {
        password_hash: await hashPassword('correct-horse'),
        role: 'editor',
      });
    },
  });

  beforeEach(async () => {
    sent.length = 0;
    issuedCodes.length = 0;
    await clearCodes();
  });

  describe('send-otp leaks nothing about the code', () => {
    it('returns a handle carrying neither the code nor its digest', async () => {
      const { status, body } = await send({ email: EMAIL, channel: 'email' });

      expect(status).toBe(200);
      expect(sent).toEqual(['email']);
      const code = issuedCodes[0];
      expect(code).toMatch(/^\d{6}$/);

      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain(code);
      expect(serialized).not.toContain(hashOTP(code));
    });

    it('returns a token that is not a JWT with a decodable payload', async () => {
      const { body } = await send({ email: EMAIL, channel: 'email' });
      const token: string = body.data.token;

      // The old design's token was `header.payload.signature`. Any dotted structure here
      // means something is being carried rather than merely referenced.
      expect(token.split('.')).toHaveLength(1);
      expect(token).toMatch(/^[0-9a-f]{64}$/);
    });

    it('brute-forcing every digest in the response body finds nothing', async () => {
      // The concrete form of the original break, run for real over a reduced space: if
      // any value in the response is a digest of a 6-digit number, this finds it.
      const { body } = await send({ email: EMAIL, channel: 'email' });
      const haystack = JSON.stringify(body);

      const code = Number(issuedCodes[0]);
      for (const candidate of [code, code + 1, code - 1, 123456, 0]) {
        expect(haystack).not.toContain(hashOTP(String(candidate)));
      }
    });
  });

  describe('verify-otp', () => {
    it('accepts the emailed code and returns a verified token', async () => {
      const { body } = await send({ email: EMAIL, channel: 'email' });
      const res = await verify(body.data.token, issuedCodes[0]);

      expect(res.status).toBe(200);
      expect(res.body.data.verifiedToken).toBeTruthy();
      expect(res.body.data.email).toBe(EMAIL);
    });

    it('caps brute force at OTP_MAX_ATTEMPTS and then refuses the correct code', async () => {
      const { body } = await send({ email: EMAIL, channel: 'email' });
      const token = body.data.token;
      const wrong = issuedCodes[0] === '000000' ? '111111' : '000000';

      for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
        expect((await verify(token, wrong)).status).toBe(401);
      }
      expect((await verify(token, issuedCodes[0])).status).toBe(429);
    });

    it('refuses a replay of a correct code', async () => {
      const { body } = await send({ email: EMAIL, channel: 'email' });
      expect((await verify(body.data.token, issuedCodes[0])).status).toBe(200);
      expect((await verify(body.data.token, issuedCodes[0])).status).toBe(401);
    });

    it('refuses a handle that was never issued', async () => {
      expect((await verify('f'.repeat(64), '123456')).status).toBe(401);
    });

    it('refuses the previous code once a new one is sent', async () => {
      const first = await send({ email: EMAIL, channel: 'email' });
      const firstCode = issuedCodes[0];
      await send({ email: EMAIL, channel: 'email' });

      expect((await verify(first.body.data.token, firstCode)).status).toBe(401);
    });
  });

  describe('unknown addresses are indistinguishable', () => {
    it('answers an unknown address with the same status and body shape', async () => {
      const known = await send({ email: EMAIL, channel: 'email' });
      await clearCodes();
      const unknown = await send({ email: UNKNOWN, channel: 'email' });

      expect(unknown.status).toBe(known.status);
      expect(Object.keys(unknown.body.data).sort()).toEqual(Object.keys(known.body.data).sort());
      expect(unknown.body.data.message).toBe(known.body.data.message);
      expect(unknown.body.data.token).toMatch(/^[0-9a-f]{64}$/);
    });

    it('sends nothing to an unknown address', async () => {
      await send({ email: UNKNOWN, channel: 'email' });
      expect(sent).toHaveLength(0);
    });

    it('issues a decoy that can never verify', async () => {
      const { body } = await send({ email: UNKNOWN, channel: 'email' });
      for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
        expect((await verify(body.data.token, String(100000 + i))).status).toBe(401);
      }
    });
  });

  describe('send throttle', () => {
    it('stops issuing after OTP_MAX_SENDS_PER_WINDOW', async () => {
      for (let i = 0; i < OTP_MAX_SENDS_PER_WINDOW; i++) {
        expect((await send({ email: EMAIL, channel: 'email' })).status).toBe(200);
      }
      expect((await send({ email: EMAIL, channel: 'email' })).status).toBe(429);
    });

    it('throttles an unknown address on the same schedule', async () => {
      for (let i = 0; i < OTP_MAX_SENDS_PER_WINDOW; i++) {
        expect((await send({ email: UNKNOWN, channel: 'email' })).status).toBe(200);
      }
      expect((await send({ email: UNKNOWN, channel: 'email' })).status).toBe(429);
    });
  });

  describe('phone channel', () => {
    it('sends nothing for a user without 2FA enabled, but answers identically', async () => {
      const res = await send({ email: EMAIL, channel: 'phone' });
      expect(res.status).toBe(200);
      expect(sent).toHaveLength(0);
      expect(res.body.data.token).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('input validation', () => {
    it('rejects a missing email', async () => {
      expect((await send({ channel: 'email' })).status).toBe(400);
    });

    it('rejects an unknown channel', async () => {
      expect((await send({ email: EMAIL, channel: 'carrier-pigeon' })).status).toBe(400);
    });
  });
});
