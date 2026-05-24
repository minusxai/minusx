import type { Mock } from 'vitest';
/**
 * Tests for the Slack OAuth 2.0 flow.
 *
 * The flow is split across two routes so the install finishes inside tenant
 * context without a domain-wide cookie:
 *   - oauth-start      — admin-gated; mints the HMAC-signed state.
 *   - oauth-callback   — lands on the root domain (Slack's fixed redirect_uri);
 *                        a thin HMAC-verifying forwarder. No DB writes. Redirects
 *                        to the tenant's finish URL (from the auth module).
 *   - oauth-callback-finish — runs on the tenant's host (auth-gated), re-verifies
 *                        the state + the logged-in admin, then exchanges the code
 *                        and writes the bot config in tenant context.
 *
 * Covers:
 *  1. buildState — payload encoding and HMAC structure
 *  2. oauth-callback — state verification + forwarding (no DB writes)
 *  3. oauth-callback-finish — token exchange, bot saved, admin/initiator check
 *  4. edge cases — user denied, Slack error, missing params, direct install
 *  5. oauth-start host-header handling — returnUrl encoding
 */

vi.mock('server-only', () => ({}));

vi.mock('@/lib/config', () => ({
  OBJECT_STORE_PUBLIC_URL: undefined,
  MX_NETWORK_LOG_EXCLUDE: '',
  NEXTAUTH_SECRET: 'test-secret-that-is-long-enough-32x',
  SLACK_CLIENT_ID: 'test-client-id',
  SLACK_CLIENT_SECRET: 'test-client-secret',
  AUTH_URL: 'https://minusx.app',
}));

vi.mock('@/lib/integrations/slack/config', () => ({
  isSlackOAuthConfigured: vi.fn(() => true),
  SLACK_BOT_SCOPES: ['app_mentions:read', 'chat:write'],
  buildOAuthUrl: vi.fn((state: string) => `https://slack.com/oauth/v2/authorize?state=${state}`),
}));

vi.mock('@/lib/integrations/slack/api', () => ({
  slackAuthTest: vi.fn(),
}));

vi.mock('@/lib/integrations/slack/store', () => ({
  upsertSlackBotConfig: vi.fn(),
}));

vi.mock('@/lib/auth/role-helpers', () => ({
  isAdmin: (role: string) => role === 'admin',
}));

// withAuth provides the authenticated tenant user to oauth-start and the finish
// route. Tests override `mockUser` to exercise the initiator/admin check.
const { mockUser } = vi.hoisted(() => ({
  mockUser: { value: { email: 'admin@acme.com', role: 'admin', mode: 'org' as const, userId: 1, home_folder: '/org' } },
}));
vi.mock('@/lib/api/with-auth', () => ({
  withAuth: (handler: (req: any, user: any) => Promise<any>) => async (request: any) =>
    handler(request, mockUser.value),
}));

// The root callback asks the auth module where to finalize the install. OSS returns
// nothing (finish on same host); proprietary returns the tenant subdomain URL.
const { getFinishUrlMock } = vi.hoisted(() => ({ getFinishUrlMock: vi.fn() }));
vi.mock('@/lib/modules/registry', () => ({
  getModules: () => ({ auth: { getSlackInstallFinishUrl: getFinishUrlMock } }),
}));

// Must be after vi.mock calls
import { NextRequest } from 'next/server';
import crypto from 'crypto';
import { buildState, GET as oauthStartHandler } from '../oauth-start/route';
import { GET as callbackHandler } from '../oauth-callback/route';
import { GET as finishHandler } from '../oauth-callback-finish/route';
import { slackAuthTest } from '@/lib/integrations/slack/api';
import { upsertSlackBotConfig } from '@/lib/integrations/slack/store';
import { isSlackOAuthConfigured } from '@/lib/integrations/slack/config';

// ─── Constants ──────────────────────────────────────────────────────────────

const CALLBACK_BASE = 'https://minusx.app/api/integrations/slack/oauth-callback';
const FINISH_BASE = 'https://acme.minusx.app/api/integrations/slack/oauth-callback-finish';

const MOCK_SLACK_OAUTH = {
  ok: true,
  access_token: 'xoxb-test-bot-token',
  bot_user_id: 'U_BOT',
  app_id: 'A_APP',
  team: { id: 'T_TEAM', name: 'Acme Workspace' },
};
const MOCK_AUTH_TEST = {
  url: 'https://acme.slack.com',
  team: 'Acme Workspace',
  user: 'minusx-bot',
  team_id: 'T_TEAM',
  user_id: 'U_BOT',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a valid signed state (mirrors the real buildState implementation). */
function makeState(overrides: {
  ts?: number;
  nonce?: string;
  returnUrl?: string;
  userEmail?: string;
} = {}): string {
  return buildState({
    ts: Date.now(),
    nonce: 'testnonce16bytes',
    returnUrl: 'https://acme.minusx.app/settings?tab=integrations',
    userEmail: 'admin@acme.com',
    ...overrides,
  });
}

/** Tamper with the encoded payload while keeping the original signature. */
function tamperPayload(state: string, newPayload: object): string {
  const lastDot = state.lastIndexOf('.');
  const sig = state.slice(lastDot + 1);
  const newEncoded = Buffer.from(JSON.stringify(newPayload)).toString('base64url');
  return `${newEncoded}.${sig}`;
}

function makeRequest(base: string, params: Record<string, string>): NextRequest {
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url.toString());
}

const makeCallbackRequest = (params: Record<string, string>) => makeRequest(CALLBACK_BASE, params);
const makeFinishRequest = (params: Record<string, string>) => makeRequest(FINISH_BASE, params);

// ─── Setup ───────────────────────────────────────────────────────────────────

let fetchMock: Mock;

beforeEach(() => {
  vi.clearAllMocks();

  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => MOCK_SLACK_OAUTH,
  });
  global.fetch = fetchMock;

  (slackAuthTest as Mock).mockResolvedValue(MOCK_AUTH_TEST);
  (upsertSlackBotConfig as Mock).mockResolvedValue(undefined);
  (isSlackOAuthConfigured as Mock).mockReturnValue(true);
  getFinishUrlMock.mockReturnValue(null);
  mockUser.value = { email: 'admin@acme.com', role: 'admin', mode: 'org', userId: 1, home_folder: '/org' };
});

// ─── 1. buildState ────────────────────────────────────────────────────────────

describe('buildState', () => {
  it('produces a base64url-payload.hex-sig format', () => {
    const state = makeState();
    const parts = state.split('.');
    // payload is base64url (no dots), sig is hex (64 chars)
    expect(parts.length).toBe(2);
    expect(parts[1]).toMatch(/^[0-9a-f]{64}$/);
  });

  it('payload round-trips correctly', () => {
    const state = makeState({ userEmail: 'bob@beta.com' });
    const lastDot = state.lastIndexOf('.');
    const decoded = JSON.parse(Buffer.from(state.slice(0, lastDot), 'base64url').toString());
    expect(decoded.userEmail).toBe('bob@beta.com');
  });

  it('two calls with same payload produce different states (nonce)', () => {
    const s1 = makeState({ nonce: 'nonce1' });
    const s2 = makeState({ nonce: 'nonce2' });
    expect(s1).not.toBe(s2);
  });
});

// ─── 2. oauth-callback — verification + forwarding ────────────────────────────

describe('oauth-callback — forwarding', () => {
  it('forwards a valid install to the finish route with code + state', async () => {
    const state = makeState();
    const res = await callbackHandler(makeCallbackRequest({ code: 'valid-code', state }));
    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/api/integrations/slack/oauth-callback-finish');
    expect(location.searchParams.get('code')).toBe('valid-code');
    expect(location.searchParams.get('state')).toBe(state);
  });

  it('never writes a bot config itself', async () => {
    const state = makeState();
    await callbackHandler(makeCallbackRequest({ code: 'valid-code', state }));
    expect(upsertSlackBotConfig).not.toHaveBeenCalled();
  });

  it('defaults the finish host to the root domain when the auth module returns nothing', async () => {
    getFinishUrlMock.mockReturnValue(null);
    const state = makeState();
    const res = await callbackHandler(makeCallbackRequest({ code: 'c', state }));
    expect(new URL(res.headers.get('location')!).host).toBe('minusx.app');
  });

  it('forwards to the tenant subdomain host supplied by the auth module', async () => {
    getFinishUrlMock.mockReturnValue('https://acme.minusx.app/api/integrations/slack/oauth-callback-finish');
    const state = makeState();
    const res = await callbackHandler(makeCallbackRequest({ code: 'c', state }));
    const location = new URL(res.headers.get('location')!);
    expect(location.host).toBe('acme.minusx.app');
    expect(getFinishUrlMock).toHaveBeenCalledWith('https://acme.minusx.app/settings?tab=integrations');
  });

  it('rejects a state with a tampered payload', async () => {
    const state = makeState({ userEmail: 'admin@acme.com' });
    const lastDot = state.lastIndexOf('.');
    const originalPayload = JSON.parse(Buffer.from(state.slice(0, lastDot), 'base64url').toString());
    const attackerState = tamperPayload(state, { ...originalPayload, returnUrl: 'https://evil.minusx.app' });

    const res = await callbackHandler(makeCallbackRequest({ code: 'code', state: attackerState }));
    expect(res.status).toBe(400);
    expect(getFinishUrlMock).not.toHaveBeenCalled();
  });

  it('rejects a state with a forged signature', async () => {
    const state = makeState();
    const lastDot = state.lastIndexOf('.');
    const encoded = state.slice(0, lastDot);
    const forgedSig = crypto.createHmac('sha256', 'wrong-secret').update(encoded).digest('hex');

    const res = await callbackHandler(makeCallbackRequest({ code: 'code', state: `${encoded}.${forgedSig}` }));
    expect(res.status).toBe(400);
    expect(getFinishUrlMock).not.toHaveBeenCalled();
  });

  it('rejects an expired state', async () => {
    const state = makeState({ ts: Date.now() - 11 * 60 * 1000 });
    const res = await callbackHandler(makeCallbackRequest({ code: 'code', state }));
    expect(res.status).toBe(400);
  });

  it('rejects a state with no dot separator', async () => {
    const res = await callbackHandler(makeCallbackRequest({ code: 'code', state: 'notavalidstate' }));
    expect(res.status).toBe(400);
  });
});

// ─── 3. oauth-callback-finish — token exchange + persistence ──────────────────

describe('oauth-callback-finish — happy path', () => {
  it('saves bot config with install_mode oauth and no signing_secret', async () => {
    const state = makeState();
    await finishHandler(makeFinishRequest({ code: 'code', state }));
    expect(upsertSlackBotConfig).toHaveBeenCalledWith(
      'org',
      expect.objectContaining({
        install_mode: 'oauth',
        bot_token: 'xoxb-test-bot-token',
        team_id: 'T_TEAM',
        installed_by: 'admin@acme.com',
        enabled: true,
      }),
    );
    // signing_secret must NOT be stored — shared env var is used instead
    const [, bot] = (upsertSlackBotConfig as Mock).mock.calls[0];
    expect(bot.signing_secret).toBeUndefined();
  });

  it('redirects to returnUrl with slack=installed', async () => {
    const returnUrl = 'https://acme.minusx.app/settings?tab=integrations';
    const res = await finishHandler(makeFinishRequest({ code: 'code', state: makeState({ returnUrl }) }));
    expect(res.headers.get('location')).toBe(`${returnUrl}&slack=installed`);
  });
});

describe('oauth-callback-finish — initiator check', () => {
  it('rejects when the logged-in user is not the admin who started the install', async () => {
    mockUser.value = { email: 'someoneelse@acme.com', role: 'admin', mode: 'org', userId: 2, home_folder: '/org' };
    const state = makeState({ userEmail: 'admin@acme.com' });
    const res = await finishHandler(makeFinishRequest({ code: 'code', state }));
    expect(res.status).toBe(403);
    expect(upsertSlackBotConfig).not.toHaveBeenCalled();
  });

  it('rejects when the logged-in user is not an admin', async () => {
    mockUser.value = { email: 'admin@acme.com', role: 'viewer', mode: 'org', userId: 1, home_folder: '/org' };
    const res = await finishHandler(makeFinishRequest({ code: 'code', state: makeState() }));
    expect(res.status).toBe(403);
    expect(upsertSlackBotConfig).not.toHaveBeenCalled();
  });

  it('rejects a tampered state before any token exchange', async () => {
    const state = makeState();
    const lastDot = state.lastIndexOf('.');
    const payload = JSON.parse(Buffer.from(state.slice(0, lastDot), 'base64url').toString());
    const tampered = tamperPayload(state, { ...payload, userEmail: 'attacker@evil.com' });
    const res = await finishHandler(makeFinishRequest({ code: 'code', state: tampered }));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(upsertSlackBotConfig).not.toHaveBeenCalled();
  });
});

// ─── 4. edge cases ────────────────────────────────────────────────────────────

describe('oauth-callback — edge cases', () => {
  it('redirects to returnUrl with slack=denied when user declines in Slack', async () => {
    const returnUrl = 'https://acme.minusx.app/settings?tab=integrations';
    const res = await callbackHandler(makeCallbackRequest({ error: 'access_denied', state: makeState({ returnUrl }) }));
    expect(res.headers.get('location')).toBe(`${returnUrl}&slack=denied`);
    expect(getFinishUrlMock).not.toHaveBeenCalled();
  });

  it('falls back to AUTH_URL for denied redirect when state is missing', async () => {
    const res = await callbackHandler(makeCallbackRequest({ error: 'access_denied' }));
    expect(res.headers.get('location')).toContain('slack=denied');
  });

  it('does not redirect to attacker URL when state has unverified returnUrl (open-redirect guard)', async () => {
    const maliciousPayload = Buffer.from(JSON.stringify({
      ts: Date.now(),
      nonce: 'x',
      returnUrl: 'https://evil.com',
      userEmail: 'attacker@evil.com',
    })).toString('base64url');
    const fakeState = `${maliciousPayload}.invalidsig`;
    const res = await callbackHandler(makeCallbackRequest({ error: 'access_denied', state: fakeState }));
    const location = res.headers.get('location') ?? '';
    expect(location).not.toContain('evil.com');
    expect(location).toContain('minusx.app');
  });

  it('returns 400 when code is missing', async () => {
    const res = await callbackHandler(makeCallbackRequest({ state: makeState() }));
    expect(res.status).toBe(400);
  });

  it('enters direct install path (not 400) when state is missing but code is present', async () => {
    const res = await callbackHandler(makeCallbackRequest({ code: 'code' }));
    expect(res.status).toBe(200);
  });

  it('returns 400 when OAuth is not configured', async () => {
    (isSlackOAuthConfigured as Mock).mockReturnValue(false);
    const res = await callbackHandler(makeCallbackRequest({ code: 'code', state: makeState() }));
    expect(res.status).toBe(400);
  });
});

describe('oauth-callback-finish — edge cases', () => {
  it('returns 500 when Slack token exchange fails', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: false, error: 'invalid_code' }) });
    const res = await finishHandler(makeFinishRequest({ code: 'bad-code', state: makeState() }));
    expect(res.status).toBe(500);
    expect(upsertSlackBotConfig).not.toHaveBeenCalled();
  });

  it('returns 400 when code is missing', async () => {
    const res = await finishHandler(makeFinishRequest({ state: makeState() }));
    expect(res.status).toBe(400);
  });
});

// ─── 5. oauth-start host-header handling ─────────────────────────────────────

describe('oauth-start — host header handling', () => {
  function makeStartRequest(host: string): NextRequest {
    return new NextRequest('https://minusx.app/api/integrations/slack/oauth-start', {
      headers: { host },
    });
  }

  function decodeState(redirectLocation: string): ReturnType<typeof JSON.parse> {
    const url = new URL(redirectLocation);
    const state = url.searchParams.get('state')!;
    const lastDot = state.lastIndexOf('.');
    return JSON.parse(Buffer.from(state.slice(0, lastDot), 'base64url').toString());
  }

  it('sets returnUrl to the originating subdomain', async () => {
    const res = await oauthStartHandler(makeStartRequest('acme.minusx.app'));
    expect(decodeState(res.headers.get('location')!).returnUrl).toBe('https://acme.minusx.app/settings?tab=integrations');
  });

  it('uses http protocol for localhost', async () => {
    const res = await oauthStartHandler(makeStartRequest('acme.localhost:3000'));
    expect(decodeState(res.headers.get('location')!).returnUrl).toMatch(/^http:\/\//);
  });

  it('includes userEmail from authenticated session in state', async () => {
    const res = await oauthStartHandler(makeStartRequest('acme.minusx.app'));
    expect(decodeState(res.headers.get('location')!).userEmail).toBe('admin@acme.com');
  });

  it('state produced by oauth-start verifies end to end (callback → finish)', async () => {
    const startRes = await oauthStartHandler(makeStartRequest('acme.minusx.app'));
    const state = new URL(startRes.headers.get('location')!).searchParams.get('state')!;

    // Root callback forwards it to the finish route...
    const callbackRes = await callbackHandler(makeCallbackRequest({ code: 'code', state }));
    const forwarded = new URL(callbackRes.headers.get('location')!);
    expect(forwarded.pathname).toBe('/api/integrations/slack/oauth-callback-finish');

    // ...and the finish route completes the install.
    const finishRes = await finishHandler(makeFinishRequest({
      code: forwarded.searchParams.get('code')!,
      state: forwarded.searchParams.get('state')!,
    }));
    expect(finishRes.headers.get('location')).toContain('slack=installed');
  });
});

// ─── 6. oauth-callback — direct install (no state) ────────────────────────────

describe('oauth-callback — direct install (no state)', () => {
  it('renders login HTML directing user to install via settings', async () => {
    const res = await callbackHandler(makeCallbackRequest({ code: 'slack-code' }));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('log in');
  });
});
