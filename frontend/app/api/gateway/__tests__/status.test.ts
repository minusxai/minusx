/**
 * The gateway status route.
 *
 * The property that matters: the ORG SECRET must never reach the browser. It is
 * resolved server-side and used to call the gateway; only the resulting numbers
 * come back.
 */
import { it, expect, vi, beforeEach, afterEach } from 'vitest';

const ORIGINAL = { ...process.env };

const getEffectiveUser = vi.fn();
const getRawConfig = vi.fn();

vi.mock('@/lib/auth/auth-helpers', () => ({
  getEffectiveUser: (...a: unknown[]) => getEffectiveUser(...(a as [])),
}));
vi.mock('@/lib/data/configs.server', () => ({
  getRawConfig: (...a: unknown[]) => getRawConfig(...(a as [])),
}));
vi.mock('@/lib/secrets/config-secrets.server', () => ({
  resolveConfigSecrets: async (v: unknown) => ({
    ...(v as object), orgSecret: 'RAW-ORG-SECRET',
  }),
}));

async function load() {
  (process.env as Record<string, string>).MX_GATEWAY_URL = 'https://llm.minusx.ai';
  (process.env as Record<string, string>).MX_GATEWAY_SHARED_SECRET = 's';
  vi.resetModules();
  return import('../status/route');
}

beforeEach(() => {
  vi.clearAllMocks();
  getEffectiveUser.mockResolvedValue({ role: 'admin', email: 'a@co.com' });
});
afterEach(() => { process.env = { ...ORIGINAL }; });

it('reports disabled when this install has no gateway', async () => {
  getRawConfig.mockResolvedValue({});
  const { GET } = await load();

  const body = await (await GET()).json();
  expect(body.data).toEqual({ enabled: false });
});

it('returns the status and never the org secret', async () => {
  getRawConfig.mockResolvedValue({ gateway: { orgId: 'org_1', orgSecret: '@SECRETS/x' } });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(
    String(url).includes('/usage') ? [] : {
      org_id: 'org_1', subscribed: true, will_renew: true, plan: 'plus',
      balance_micro_usd: 7_500_000, percent_used: 0.25,
    }), { status: 200 })));
  const { GET } = await load();

  const raw = JSON.stringify(await (await GET()).json());
  expect(raw).toContain('org_1');
  expect(raw).not.toContain('RAW-ORG-SECRET');
  expect(raw).not.toContain('@SECRETS/x');
});

it('says unreachable rather than showing a stale zero when the gateway is down', async () => {
  getRawConfig.mockResolvedValue({ gateway: { orgId: 'org_1', orgSecret: '@SECRETS/x' } });
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
  const { GET } = await load();

  const body = await (await GET()).json();
  expect(body.data).toEqual({ enabled: true, reachable: false });
});

it('refuses a non-admin — spend is org-wide', async () => {
  getRawConfig.mockResolvedValue({ gateway: { orgId: 'org_1', orgSecret: '@SECRETS/x' } });
  getEffectiveUser.mockResolvedValue({ role: 'member', email: 'b@co.com' });
  const { GET } = await load();

  expect((await GET()).status).toBe(403);
});
