/**
 * Tests for the Slack OAuth 2.0 flow.
 *
 * Covers:
 *  1. buildState — payload encoding and HMAC structure
 *  2. oauth-callback security — tampered payload, tampered sig, expired state
 *  3. oauth-callback happy path — company lookup, bot saved, redirect to returnUrl
 *  4. oauth-callback edge cases — null subdomain, user denied, Slack error, missing params
 *  5. oauth-start host-header handling — subdomain and returnUrl encoding
 */

jest.mock('server-only', () => ({}));

jest.mock('@/lib/config', () => ({
  NEXTAUTH_SECRET: 'test-secret-that-is-long-enough-32x',
  SLACK_CLIENT_ID: 'test-client-id',
  SLACK_CLIENT_SECRET: 'test-client-secret',
  AUTH_URL: 'https://minusx.app',
}));

jest.mock('@/lib/integrations/slack/config', () => ({
  isSlackOAuthConfigured: jest.fn(() => true),
  SLACK_BOT_SCOPES: ['app_mentions:read', 'chat:write'],
  buildOAuthUrl: jest.fn((state: string) => `https://slack.com/oauth/v2/authorize?state=${state}`),
}));

jest.mock('@/lib/database/company-db', () => ({
  CompanyDB: {
    getBySubdomain: jest.fn(),
    getDefaultCompany: jest.fn(),
  },
}));

jest.mock('@/lib/integrations/slack/api', () => ({
  slackAuthTest: jest.fn(),
}));

jest.mock('@/lib/integrations/slack/store', () => ({
  upsertSlackBotConfig: jest.fn(),
}));

jest.mock('@/lib/api/with-auth', () => ({
  withAuth: (handler: Function) => async (request: any) =>
    handler(request, {
      email: 'admin@acme.com',
      role: 'admin',
      companyId: 42,
      mode: 'org' as const,
      userId: 1,
      home_folder: '/org',
      companyName: 'acme',
    }),
}));

// Must be after jest.mock calls
import { NextRequest } from 'next/server';
import crypto from 'crypto';
import { buildState, GET as oauthStartHandler } from '../oauth-start/route';
import { GET as callbackHandler } from '../oauth-callback/route';
import { CompanyDB } from '@/lib/database/company-db';
import { slackAuthTest } from '@/lib/integrations/slack/api';
import { upsertSlackBotConfig } from '@/lib/integrations/slack/store';
import { isSlackOAuthConfigured } from '@/lib/integrations/slack/config';

// ─── Constants ──────────────────────────────────────────────────────────────

const TEST_SECRET = 'test-secret-that-is-long-enough-32x';
const CALLBACK_BASE = 'https://minusx.app/api/integrations/slack/oauth-callback';

const MOCK_COMPANY = { id: 42, name: 'acme', subdomain: 'acme', display_name: 'Acme Inc' };
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
  subdomain?: string | null;
  returnUrl?: string;
  userEmail?: string;
} = {}): string {
  return buildState({
    ts: Date.now(),
    nonce: 'testnonce16bytes',
    subdomain: 'acme',
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

/** Build a callback NextRequest with given query params. */
function makeCallbackRequest(params: Record<string, string>): NextRequest {
  const url = new URL(CALLBACK_BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url.toString());
}

// ─── Setup ───────────────────────────────────────────────────────────────────

let fetchMock: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();

  fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => MOCK_SLACK_OAUTH,
  });
  global.fetch = fetchMock;

  (CompanyDB.getBySubdomain as jest.Mock).mockResolvedValue(MOCK_COMPANY);
  (CompanyDB.getDefaultCompany as jest.Mock).mockResolvedValue(MOCK_COMPANY);
  (slackAuthTest as jest.Mock).mockResolvedValue(MOCK_AUTH_TEST);
  (upsertSlackBotConfig as jest.Mock).mockResolvedValue(undefined);
  (isSlackOAuthConfigured as jest.Mock).mockReturnValue(true);
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
    const state = makeState({ subdomain: 'beta', userEmail: 'bob@beta.com' });
    const lastDot = state.lastIndexOf('.');
    const decoded = JSON.parse(Buffer.from(state.slice(0, lastDot), 'base64url').toString());
    expect(decoded.subdomain).toBe('beta');
    expect(decoded.userEmail).toBe('bob@beta.com');
  });

  it('encodes null subdomain for root-domain requests', () => {
    const state = makeState({ subdomain: null });
    const lastDot = state.lastIndexOf('.');
    const decoded = JSON.parse(Buffer.from(state.slice(0, lastDot), 'base64url').toString());
    expect(decoded.subdomain).toBeNull();
  });

  it('two calls with same payload produce different states (nonce)', () => {
    const s1 = makeState({ nonce: 'nonce1' });
    const s2 = makeState({ nonce: 'nonce2' });
    expect(s1).not.toBe(s2);
  });
});

// ─── 2. oauth-callback security ──────────────────────────────────────────────

describe('oauth-callback — state verification', () => {
  it('accepts a valid state', async () => {
    const state = makeState();
    const req = makeCallbackRequest({ code: 'valid-code', state });
    const res = await callbackHandler(req);
    // Should redirect (not return 4xx)
    expect(res.headers.get('location')).toContain('slack=installed');
  });

  it('rejects a state with a tampered payload', async () => {
    const state = makeState({ subdomain: 'acme' });
    const lastDot = state.lastIndexOf('.');
    const originalPayload = JSON.parse(Buffer.from(state.slice(0, lastDot), 'base64url').toString());
    const attackerState = tamperPayload(state, { ...originalPayload, subdomain: 'victim' });

    const req = makeCallbackRequest({ code: 'code', state: attackerState });
    const res = await callbackHandler(req);
    expect(res.status).toBe(400);
    expect(upsertSlackBotConfig).not.toHaveBeenCalled();
  });

  it('rejects a state with a forged signature', async () => {
    const state = makeState();
    const lastDot = state.lastIndexOf('.');
    const encoded = state.slice(0, lastDot);
    const forgedSig = crypto.createHmac('sha256', 'wrong-secret').update(encoded).digest('hex');
    const attackerState = `${encoded}.${forgedSig}`;

    const req = makeCallbackRequest({ code: 'code', state: attackerState });
    const res = await callbackHandler(req);
    expect(res.status).toBe(400);
    expect(upsertSlackBotConfig).not.toHaveBeenCalled();
  });

  it('rejects an expired state', async () => {
    const elevenMinutesAgo = Date.now() - 11 * 60 * 1000;
    const state = makeState({ ts: elevenMinutesAgo });
    const req = makeCallbackRequest({ code: 'code', state });
    const res = await callbackHandler(req);
    expect(res.status).toBe(400);
    expect(upsertSlackBotConfig).not.toHaveBeenCalled();
  });

  it('rejects a state with no dot separator', async () => {
    const req = makeCallbackRequest({ code: 'code', state: 'notavalidstate' });
    const res = await callbackHandler(req);
    expect(res.status).toBe(400);
  });
});

// ─── 3. oauth-callback happy path ────────────────────────────────────────────

describe('oauth-callback — happy path', () => {
  it('looks up company by subdomain from state', async () => {
    const state = makeState({ subdomain: 'acme' });
    await callbackHandler(makeCallbackRequest({ code: 'code', state }));
    expect(CompanyDB.getBySubdomain).toHaveBeenCalledWith('acme');
    expect(CompanyDB.getDefaultCompany).not.toHaveBeenCalled();
  });

  it('saves bot config with install_mode oauth and no signing_secret', async () => {
    const state = makeState();
    await callbackHandler(makeCallbackRequest({ code: 'code', state }));
    expect(upsertSlackBotConfig).toHaveBeenCalledWith(
      42, 'org',
      expect.objectContaining({
        install_mode: 'oauth',
        bot_token: 'xoxb-test-bot-token',
        team_id: 'T_TEAM',
        installed_by: 'admin@acme.com',
        enabled: true,
      }),
    );
    // signing_secret must NOT be stored — shared env var is used instead
    const [,, bot] = (upsertSlackBotConfig as jest.Mock).mock.calls[0];
    expect(bot.signing_secret).toBeUndefined();
  });

  it('redirects to returnUrl with slack=installed', async () => {
    const returnUrl = 'https://acme.minusx.app/settings?tab=integrations';
    const state = makeState({ returnUrl });
    const res = await callbackHandler(makeCallbackRequest({ code: 'code', state }));
    expect(res.headers.get('location')).toBe(`${returnUrl}&slack=installed`);
  });
});

// ─── 4. oauth-callback edge cases ────────────────────────────────────────────

describe('oauth-callback — edge cases', () => {
  it('falls back to getDefaultCompany when subdomain is null', async () => {
    const state = makeState({ subdomain: null });
    await callbackHandler(makeCallbackRequest({ code: 'code', state }));
    expect(CompanyDB.getDefaultCompany).toHaveBeenCalled();
    expect(CompanyDB.getBySubdomain).not.toHaveBeenCalled();
    expect(upsertSlackBotConfig).toHaveBeenCalled();
  });

  it('returns 404 when company subdomain is not found', async () => {
    (CompanyDB.getBySubdomain as jest.Mock).mockResolvedValue(null);
    const state = makeState({ subdomain: 'unknown' });
    const res = await callbackHandler(makeCallbackRequest({ code: 'code', state }));
    expect(res.status).toBe(404);
    expect(upsertSlackBotConfig).not.toHaveBeenCalled();
  });

  it('redirects to returnUrl with slack=denied when user declines in Slack', async () => {
    const returnUrl = 'https://acme.minusx.app/settings?tab=integrations';
    const state = makeState({ returnUrl });
    const req = makeCallbackRequest({ error: 'access_denied', state });
    const res = await callbackHandler(req);
    expect(res.headers.get('location')).toBe(`${returnUrl}&slack=denied`);
    expect(upsertSlackBotConfig).not.toHaveBeenCalled();
  });

  it('falls back to AUTH_URL for denied redirect when state is missing', async () => {
    const req = makeCallbackRequest({ error: 'access_denied' });
    const res = await callbackHandler(req);
    expect(res.headers.get('location')).toContain('slack=denied');
  });

  it('returns 400 when code is missing', async () => {
    const state = makeState();
    const res = await callbackHandler(makeCallbackRequest({ state }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when state is missing', async () => {
    const res = await callbackHandler(makeCallbackRequest({ code: 'code' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when OAuth is not configured', async () => {
    (isSlackOAuthConfigured as jest.Mock).mockReturnValue(false);
    const state = makeState();
    const res = await callbackHandler(makeCallbackRequest({ code: 'code', state }));
    expect(res.status).toBe(400);
  });

  it('returns 500 when Slack token exchange fails', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false, error: 'invalid_code' }),
    });
    const state = makeState();
    const res = await callbackHandler(makeCallbackRequest({ code: 'bad-code', state }));
    expect(res.status).toBe(500);
    expect(upsertSlackBotConfig).not.toHaveBeenCalled();
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

  it('encodes subdomain from Host header into state', async () => {
    const res = await oauthStartHandler(makeStartRequest('acme.minusx.app'));
    const location = res.headers.get('location')!;
    const decoded = decodeState(location);
    expect(decoded.subdomain).toBe('acme');
  });

  it('sets returnUrl to the originating subdomain', async () => {
    const res = await oauthStartHandler(makeStartRequest('acme.minusx.app'));
    const decoded = decodeState(res.headers.get('location')!);
    expect(decoded.returnUrl).toBe('https://acme.minusx.app/settings?tab=integrations');
  });

  it('encodes null subdomain when request arrives on root domain', async () => {
    const res = await oauthStartHandler(makeStartRequest('minusx.app'));
    const decoded = decodeState(res.headers.get('location')!);
    expect(decoded.subdomain).toBeNull();
  });

  it('uses http protocol for localhost', async () => {
    const res = await oauthStartHandler(makeStartRequest('acme.localhost:3000'));
    const decoded = decodeState(res.headers.get('location')!);
    expect(decoded.returnUrl).toMatch(/^http:\/\//);
  });

  it('includes userEmail from authenticated session in state', async () => {
    const res = await oauthStartHandler(makeStartRequest('acme.minusx.app'));
    const decoded = decodeState(res.headers.get('location')!);
    expect(decoded.userEmail).toBe('admin@acme.com');
  });

  it('state produced by oauth-start verifies in oauth-callback', async () => {
    const startRes = await oauthStartHandler(makeStartRequest('acme.minusx.app'));
    const startLocation = startRes.headers.get('location')!;
    const state = new URL(startLocation).searchParams.get('state')!;

    const callbackReq = makeCallbackRequest({ code: 'code', state });
    const callbackRes = await callbackHandler(callbackReq);
    expect(callbackRes.headers.get('location')).toContain('slack=installed');
  });
});
