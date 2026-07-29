/**
 * The gateway client.
 *
 * The behaviour that matters here is the SWITCH: with `MX_GATEWAY_URL` unset,
 * none of this may run and registration must be untouched. A bug that quietly
 * reaches out to a hosted service from an install that never asked for one is
 * the worst outcome this module has.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { MICRO_PER_USD } from '../gateway-types';

const ORIGINAL = { ...process.env };

function setEnv(env: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete (process.env as Record<string, string | undefined>)[k];
    else (process.env as Record<string, string>)[k] = v;
  }
}

/**
 * `lib/config.ts` snapshots `process.env` at module load — that is the repo's
 * established pattern, and the reason ESLint forbids reading `process.env`
 * anywhere else. So a test that varies env has to reset the module registry and
 * re-import, not just mutate the environment.
 */
async function loadClient(env: Record<string, string | undefined>) {
  setEnv({ MX_GATEWAY_URL: undefined, MX_GATEWAY_SHARED_SECRET: undefined, ...env });
  vi.resetModules();
  return import('../gateway-client.server');
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

const ON = { MX_GATEWAY_URL: 'https://llm.minusx.ai', MX_GATEWAY_SHARED_SECRET: 'shhh' };

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('the switch', () => {
  it('is off when MX_GATEWAY_URL is unset', async () => {
    const { gatewayEnabled } = await loadClient({});
    expect(gatewayEnabled()).toBe(false);
  });

  it('is off when the URL is set but the shared secret is not', async () => {
    // Half-configured is OFF, not a runtime error at registration time:
    // setting one variable by accident must still leave registration working.
    const { gatewayEnabled } = await loadClient({ MX_GATEWAY_URL: 'https://llm.minusx.ai' });
    expect(gatewayEnabled()).toBe(false);
  });

  it('is on only when both are set', async () => {
    const { gatewayEnabled } = await loadClient(ON);
    expect(gatewayEnabled()).toBe(true);
  });

  it('never calls out when disabled', async () => {
    const { createGatewayOrg } = await loadClient({});
    const fetchMock = mockFetch(200, {});
    expect(await createGatewayOrg({ email: 'a@co.com', workspaceName: 'Acme' })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('createGatewayOrg', () => {
  it('registers the workspace and returns the four credentials', async () => {
    const { createGatewayOrg } = await loadClient(ON);
    const fetchMock = mockFetch(200, {
      org_id: 'org_1', org_secret: 'osec', key_id: 'key_1', key: 'mxk1_abc',
    });

    const creds = await createGatewayOrg({ email: 'a@co.com', workspaceName: 'Acme' });

    expect(creds).toEqual({
      orgId: 'org_1', orgSecret: 'osec', keyId: 'key_1', key: 'mxk1_abc',
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://llm.minusx.ai/orgs');
    expect((init.headers as Record<string, string>)['x-mx-shared-secret']).toBe('shhh');
    // No `kind`: the account type is the gateway's to decide from the
    // credential we present, never something this client asks for.
    expect(JSON.parse(init.body as string)).toEqual({
      email: 'a@co.com', props: { workspace_name: 'Acme' },
    });
  });

  it('returns null rather than throwing when the gateway is down', async () => {
    // Registration has already committed by the time this runs. Failing it
    // would leave a workspace that cannot be re-registered, so a gateway
    // outage must degrade to "no gateway config" and not to a broken signup.
    const { createGatewayOrg } = await loadClient(ON);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    expect(await createGatewayOrg({ email: 'a@co.com', workspaceName: 'Acme' })).toBeNull();
  });

  it('returns null on a non-2xx without throwing', async () => {
    const { createGatewayOrg } = await loadClient(ON);
    mockFetch(409, { detail: 'Email already registered' });
    expect(await createGatewayOrg({ email: 'a@co.com', workspaceName: 'Acme' })).toBeNull();
  });

  it('trims a trailing slash off the base URL', async () => {
    const { createGatewayOrg } = await loadClient({ ...ON, MX_GATEWAY_URL: 'https://llm.minusx.ai/' });
    const fetchMock = mockFetch(200, {
      org_id: 'o', org_secret: 's', key_id: 'k', key: 'mxk1_x',
    });
    await createGatewayOrg({ email: 'a@co.com', workspaceName: 'Acme' });
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[0]).toBe('https://llm.minusx.ai/orgs');
  });
});

describe('fetchOrgStatus', () => {
  it('maps the snake_case wire shape to camelCase', async () => {
    const { fetchOrgStatus } = await loadClient(ON);
    mockFetch(200, {
      org_id: 'org_1', subscribed: true, will_renew: true,
      access_expires_at: '2026-08-05T00:00:00Z',
      plan: 'plus', next_plan: 'plus', balance_micro_usd: 7_500_000,
      expiring_soon_micro_usd: 0, period_granted_micro_usd: 10_000_000,
      period_used_micro_usd: 2_500_000, percent_used: 0.25,
    });

    const status = await fetchOrgStatus('osec');

    expect(status).toMatchObject({
      orgId: 'org_1', subscribed: true, plan: 'plus',
      balanceMicroUsd: 7.5 * MICRO_PER_USD, percentUsed: 0.25,
    });
  });

  it('carries will_renew through — the panel needs it to say renews vs ends', async () => {
    const { fetchOrgStatus } = await loadClient(ON);
    mockFetch(200, { org_id: 'o', subscribed: true, will_renew: false, balance_micro_usd: 1 });

    expect((await fetchOrgStatus('osec'))!.willRenew).toBe(false);
  });

  it('sends the ORG secret, not the shared one', async () => {
    const { fetchOrgStatus } = await loadClient(ON);
    const fetchMock = mockFetch(200, { org_id: 'o', subscribed: false, balance_micro_usd: 0 });
    await fetchOrgStatus('osec');

    const headers = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
    expect(headers['x-mx-org-secret']).toBe('osec');
    expect(headers['x-mx-shared-secret']).toBeUndefined();
  });

  it('returns null when the org secret is rejected', async () => {
    const { fetchOrgStatus } = await loadClient(ON);
    mockFetch(401, { detail: 'Invalid org secret' });
    expect(await fetchOrgStatus('wrong')).toBeNull();
  });
});

describe('buildGatewayLlmConfig', () => {
  it('points every grade at the gateway with the minted key', async () => {
    const { buildGatewayLlmConfig } = await loadClient(ON);
    const config = buildGatewayLlmConfig('mxk1_abc');

    expect(config.providers).toHaveLength(1);
    const provider = config.providers![0];
    expect(provider.provider).toBe('minusx');
    expect(provider.apiKey).toBe('mxk1_abc');

    // Every grade, so a fresh company is usable immediately rather than
    // landing on "no model configured" for two of three grades.
    for (const grade of ['lite', 'core', 'advanced'] as const) {
      expect(config.grades![grade]!.providerName).toBe(provider.name);
    }
  });

  it('uses the auto sentinel so the gateway picks the model', async () => {
    const { buildGatewayLlmConfig } = await loadClient(ON);
    const config = buildGatewayLlmConfig('mxk1_abc');
    for (const grade of ['lite', 'core', 'advanced'] as const) {
      expect(config.grades![grade]!.model).toBe('minusx-auto');
    }
  });
});
