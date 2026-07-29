/**
 * Wiring the gateway into workspace registration.
 *
 * The invariant under test is that registration SURVIVES anything the gateway
 * does. It has already committed by the time this runs, so a throw here would
 * leave a workspace that cannot be registered again.
 */
import { it, expect, vi, beforeEach, afterEach } from 'vitest';

const ORIGINAL = { ...process.env };

const saveRawConfig = vi.fn(async () => {});
const getRawConfig = vi.fn(async () => ({ existing: true }));

vi.mock('@/lib/data/configs.server', () => ({
  getRawConfig: (...a: unknown[]) => getRawConfig(...(a as [])),
  saveRawConfig: (...a: unknown[]) => saveRawConfig(...(a as [])),
}));

async function load(env: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries({
    MX_GATEWAY_URL: undefined, MX_GATEWAY_SHARED_SECRET: undefined, ...env,
  })) {
    if (v === undefined) delete (process.env as Record<string, string | undefined>)[k];
    else (process.env as Record<string, string>)[k] = v;
  }
  vi.resetModules();
  return import('../gateway-register.server');
}

const ON = { MX_GATEWAY_URL: 'https://llm.minusx.ai', MX_GATEWAY_SHARED_SECRET: 's' };

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => {
  vi.clearAllMocks();
  getRawConfig.mockResolvedValue({ existing: true } as never);
});
afterEach(() => { process.env = { ...ORIGINAL }; });

it('does nothing at all when the gateway is disabled', async () => {
  const { registerCompanyWithGateway } = await load({});
  const fetchMock = mockFetch(200, {});

  expect(await registerCompanyWithGateway({ email: 'a@co.com', workspaceName: 'Acme' })).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(saveRawConfig).not.toHaveBeenCalled();
});

it('persists the credentials and wires the provider', async () => {
  const { registerCompanyWithGateway } = await load(ON);
  mockFetch(200, { org_id: 'org_1', org_secret: 'osec', key_id: 'key_1', key: 'mxk1_abc' });

  const creds = await registerCompanyWithGateway({ email: 'a@co.com', workspaceName: 'Acme' });
  expect(creds?.orgId).toBe('org_1');

  const [, saved] = saveRawConfig.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
  // Existing config is preserved, not clobbered.
  expect(saved.existing).toBe(true);
  expect(saved.gateway).toEqual({ orgId: 'org_1', keyId: 'key_1', orgSecret: 'osec' });

  const llm = saved.llm as { providers: Array<{ apiKey: string }> };
  expect(llm.providers[0].apiKey).toBe('mxk1_abc');
});

it('writes nothing when the gateway call fails', async () => {
  const { registerCompanyWithGateway } = await load(ON);
  mockFetch(500, { detail: 'boom' });

  expect(await registerCompanyWithGateway({ email: 'a@co.com', workspaceName: 'Acme' })).toBeNull();
  expect(saveRawConfig).not.toHaveBeenCalled();
});

it('never throws, even if persisting the config blows up', async () => {
  const { registerCompanyWithGateway } = await load(ON);
  mockFetch(200, { org_id: 'o', org_secret: 's', key_id: 'k', key: 'mxk1_x' });
  saveRawConfig.mockRejectedValueOnce(new Error('disk full') as never);

  await expect(
    registerCompanyWithGateway({ email: 'a@co.com', workspaceName: 'Acme' }),
  ).resolves.toBeNull();
});

it('never leaves the org secret raw in the config document', async () => {
  // The org secret manages the gateway org — rotate it, mint inference keys,
  // read spend. A real registration against a live gateway showed it sitting in
  // plaintext while only the inference key was extracted, which is how this
  // test came to exist.
  const { extractConfigSecrets } = await import('@/lib/secrets/config-secrets.server');
  const { isSecretRef } = await import('@/lib/secrets/secret-refs');

  const extracted = await extractConfigSecrets('org', {
    gateway: { orgId: 'org_1', keyId: 'key_1', orgSecret: 'raw-secret-value' },
  }) as { gateway: { orgSecret: string; orgId: string } };

  expect(isSecretRef(extracted.gateway.orgSecret)).toBe(true);
  expect(JSON.stringify(extracted)).not.toContain('raw-secret-value');
  // Public ids stay readable — they are not credentials.
  expect(extracted.gateway.orgId).toBe('org_1');
});
