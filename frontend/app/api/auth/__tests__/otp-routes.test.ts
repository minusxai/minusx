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
const TWOFA_EMAIL = 'otp-2fa@example.com';
const UNKNOWN = 'nobody-here@example.com';

/** One entry per dispatch actually attempted — the stand-in for "an email went out". */
const sent: string[] = [];
/**
 * Codes as generated, in order. Read from the generator rather than parsed back out of
 * the rendered email: the template lays the code out one digit per table cell, so
 * scraping it would be testing the template, not the route.
 */
const issuedCodes: string[] = [];
/** Lets a test make delivery fail, or hold it open to prove the response never waits. */
const h = {
  sendFails: false,
  sendGate: null as PromiseWithResolvers<void> | null,
  webhooks: [] as Array<Record<string, unknown>>,
};
const DEFAULT_WEBHOOKS = [{ type: 'email_otp', url: 'https://email.invalid/send' }];
/** Every dispatch, with the webhook it was routed to and the vars it substituted. */
const dispatched: Array<{ webhookType: unknown; vars: Record<string, string> }> = [];

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
      messaging: { webhooks: h.webhooks },
    },
  }),
}));
vi.mock('@/lib/messaging/webhook-resolver.server', () => ({
  resolveWebhook: (w: unknown) => w,
}));
async function dispatch(kind: 'email' | 'phone', webhook: unknown, vars: Record<string, string>) {
  if (h.sendGate) await h.sendGate.promise;
  dispatched.push({ webhookType: (webhook as { type?: unknown })?.type, vars });
  if (h.sendFails) return { success: false, error: 'smtp exploded' };
  sent.push(kind);
  return { success: true };
}
vi.mock('@/lib/messaging/webhook-executor', () => ({
  sendEmailViaWebhook: (w: unknown, to: string) => dispatch('email', w, { EMAIL_TO: to }),
  executeWebhook: (w: unknown, vars: Record<string, string>) => dispatch('phone', w, vars),
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
      await UserDB.create(TWOFA_EMAIL, 'Two Factor User', '', {
        password_hash: await hashPassword('correct-horse'),
        role: 'editor',
        phone: '+15550001111',
        state: JSON.stringify({ twofa_phone_otp_enabled: true }),
      });
    },
  });

  beforeEach(async () => {
    sent.length = 0;
    issuedCodes.length = 0;
    h.sendFails = false;
    h.sendGate = null;
    h.webhooks = [...DEFAULT_WEBHOOKS];
    dispatched.length = 0;
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

    it('tells the client a password is still needed for a 2FA account', async () => {
      // Otherwise the Email Code entry point dead-ends: the code verifies, the sign-in
      // is then refused for having only one factor, and the user is left with a generic
      // failure and no way forward. Disclosing this to someone who has just proven
      // control of the mailbox reveals nothing they could not learn by trying to log in.
      const { body } = await send({ email: TWOFA_EMAIL, channel: 'email' });
      const res = await verify(body.data.token, issuedCodes[0]);

      expect(res.status).toBe(200);
      expect(res.body.data.passwordRequired).toBe(true);
    });

    it('does not ask for a password on a plain account', async () => {
      const { body } = await send({ email: EMAIL, channel: 'email' });
      const res = await verify(body.data.token, issuedCodes[0]);

      expect(res.body.data.passwordRequired).toBe(false);
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

    it('answers identically when the webhook FAILS for a real recipient', async () => {
      // The 500 this used to return was reachable only for an address that actually has
      // a code dispatched to it, which made "did the send blow up" a user-existence
      // oracle — the one the decoy exists to close. The endpoint already declines to
      // confirm delivery, so reporting a delivery failure contradicted its own design.
      h.sendFails = true;
      const real = await send({ email: EMAIL, channel: 'email' });
      const unknown = await send({ email: UNKNOWN, channel: 'email' });

      expect(real.status).toBe(unknown.status);
      expect(real.body.data.message).toBe(unknown.body.data.message);
      expect(Object.keys(real.body.data).sort()).toEqual(Object.keys(unknown.body.data).sort());
    });

    it('does not wait on the webhook before responding', async () => {
      // Dispatch latency was the other half of the leak: a real recipient cost a network
      // round-trip and a decoy returned at once. The send is detached, so the response
      // is produced before it has been attempted.
      h.sendGate = Promise.withResolvers<void>();
      const responded = await send({ email: EMAIL, channel: 'email' });

      expect(responded.status).toBe(200);
      expect(sent).toHaveLength(0);   // still blocked on the gate

      h.sendGate.resolve();
      await vi.waitFor(() => expect(sent).toEqual(['email']));
      h.sendGate = null;
    });

    it('runs the detached send inside the request\'s context runner', async () => {
      // `app_events` is a per-namespace table, so the failure report below is a
      // namespaced write happening after the response. A deployment that implements the
      // namespace seam supplies `getContextRunner`, and the dispatch must go through it
      // or that write lands outside the namespace the request belonged to. In this
      // single-workspace build the hook is absent and the wrapper is identity — which is
      // exactly why nothing here would notice the omission without this test.
      const { getModules } = await import('@/lib/modules/registry');
      const real = getModules();
      let wrapped = 0;
      const spy = vi.spyOn(await import('@/lib/modules/registry'), 'getModules').mockReturnValue({
        ...real,
        auth: {
          ...real.auth,
          getContextRunner: async () => (fn: () => Promise<unknown>) => { wrapped += 1; return fn(); },
        },
      } as ReturnType<typeof getModules>);

      try {
        await send({ email: EMAIL, channel: 'email' });
        await vi.waitFor(() => expect(sent).toEqual(['email']));
        expect(wrapped).toBe(1);
      } finally {
        spy.mockRestore();
      }
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

  describe('phone channel dispatch', () => {
    const PHONE_HOOK = { type: 'phone_otp', url: 'https://sms.invalid/{{USER_NUMBER}}/{{AUTH_OTP}}' };

    it('routes a 2FA user\'s code to the phone_otp webhook with the number and code', async () => {
      h.webhooks = [...DEFAULT_WEBHOOKS, PHONE_HOOK];
      const res = await send({ email: TWOFA_EMAIL, channel: 'phone' });

      expect(res.status).toBe(200);
      await vi.waitFor(() => expect(dispatched).toHaveLength(1));
      expect(dispatched[0].webhookType).toBe('phone_otp');
      expect(dispatched[0].vars).toEqual({ USER_NUMBER: '+15550001111', AUTH_OTP: issuedCodes[0] });
    });

    it('picks phone_otp by TYPE, not by position', async () => {
      // The email webhook is first in the array; selection must not depend on order.
      h.webhooks = [{ type: 'slack_alert', url: 'https://slack.invalid' }, ...DEFAULT_WEBHOOKS, PHONE_HOOK];
      await send({ email: TWOFA_EMAIL, channel: 'phone' });

      await vi.waitFor(() => expect(dispatched).toHaveLength(1));
      expect(dispatched[0].webhookType).toBe('phone_otp');
    });

    it('refuses to send when no phone_otp webhook is configured', async () => {
      // Only `phone_otp` is templated with {{USER_NUMBER}}/{{AUTH_OTP}} — and it has no
      // keyword alias, so it must be configured explicitly. Falling back to whatever
      // webhook happens to be first fires an email or Slack endpoint with placeholders
      // it does not declare: the request goes out, no code reaches the phone, and the
      // account is locked out because the second factor is now enforced.
      h.webhooks = [...DEFAULT_WEBHOOKS, { type: 'slack_alert', url: 'https://slack.invalid' }];
      const res = await send({ email: TWOFA_EMAIL, channel: 'phone' });

      expect(res.status).toBe(400);
      await new Promise(r => setTimeout(r, 50));
      expect(dispatched).toHaveLength(0);
    });

    it('never routes a phone code through an email webhook', async () => {
      h.webhooks = [...DEFAULT_WEBHOOKS];
      await send({ email: TWOFA_EMAIL, channel: 'phone' });

      await new Promise(r => setTimeout(r, 50));
      expect(dispatched.map(d => d.webhookType)).not.toContain('email_otp');
    });
  });

  describe('phone channel', () => {
    it('sends nothing for a user without 2FA enabled, but answers identically', async () => {
      h.webhooks = [...DEFAULT_WEBHOOKS, { type: 'phone_otp', url: 'https://sms.invalid' }];
      const res = await send({ email: EMAIL, channel: 'phone' });
      expect(res.status).toBe(200);
      expect(sent).toHaveLength(0);
      expect(res.body.data.token).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('a missing channel webhook is a deployment fact, not a user fact', () => {
    it('answers the same for a known and an unknown address', async () => {
      h.webhooks = [...DEFAULT_WEBHOOKS];   // no phone_otp
      const known = await send({ email: TWOFA_EMAIL, channel: 'phone' });
      const unknown = await send({ email: UNKNOWN, channel: 'phone' });

      expect(known.status).toBe(unknown.status);
      expect(known.body.error.message).toBe(unknown.body.error.message);
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
