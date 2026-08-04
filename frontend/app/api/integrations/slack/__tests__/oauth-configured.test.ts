/**
 * `oauth-configured` reports what the CLIENT can offer, and it used to report only half of it.
 *
 * There are two ways to connect Slack. Hosted OAuth needs SLACK_CLIENT_ID/SECRET on the server.
 * Self-hosting your own Slack app needs only a public HTTPS base URL — `selfHostedEnabled`,
 * enforced server-side by `manifest/route.ts` and `manual-install/route.ts`, which 403 without it.
 *
 * Nothing ever told the browser about that second flag. Settings therefore rendered the whole
 * manual guide on an instance with no public URL (localhost) and only revealed the truth when
 * "Generate manifest" came back 403 at step two, and the onboarding Slack step could not tell
 * "you can self-host this" apart from "Slack cannot work here at all".
 *
 * Both facts now ship together so each surface can render an honest state.
 */

vi.mock('server-only', () => ({}));

const { capabilitiesMock, oauthConfiguredMock } = vi.hoisted(() => ({
  capabilitiesMock: vi.fn(() => ({ selfHostedEnabled: true, baseUrl: 'https://acme.minusx.app' })),
  oauthConfiguredMock: vi.fn(() => true),
}));

vi.mock('@/lib/integrations/slack/config', () => ({
  isSlackOAuthConfigured: oauthConfiguredMock,
  getSlackCapabilities: capabilitiesMock,
}));

vi.mock('@/lib/auth/role-helpers', () => ({
  isAdmin: (role: string) => role === 'admin',
}));

const { mockUser } = vi.hoisted(() => ({
  mockUser: { value: { email: 'admin@acme.com', role: 'admin', mode: 'org' as const, userId: 1, home_folder: '/org' } },
}));
vi.mock('@/lib/http/with-auth', () => ({
  withAuth: (handler: (req: unknown, user: unknown) => Promise<Response>) => async (request: unknown) =>
    handler(request, mockUser.value),
}));

import { NextRequest } from 'next/server';
import { GET as oauthConfiguredHandler } from '../oauth-configured/route';

async function call() {
  const res = await oauthConfiguredHandler(
    new NextRequest('https://acme.minusx.app/api/integrations/slack/oauth-configured')
  );
  return { status: res.status, body: await res.json() };
}

describe('GET /api/integrations/slack/oauth-configured', () => {
  beforeEach(() => {
    mockUser.value = { email: 'admin@acme.com', role: 'admin', mode: 'org', userId: 1, home_folder: '/org' };
    oauthConfiguredMock.mockReturnValue(true);
    capabilitiesMock.mockReturnValue({ selfHostedEnabled: true, baseUrl: 'https://acme.minusx.app' });
  });

  it('reports hosted OAuth availability', async () => {
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body.data.configured).toBe(true);
  });

  it('also reports whether a self-hosted Slack app is possible', async () => {
    const { body } = await call();
    expect(body.data.selfHostedEnabled).toBe(true);
  });

  it('distinguishes "self-host it yourself" from "Slack cannot work here"', async () => {
    oauthConfiguredMock.mockReturnValue(false);

    // Public HTTPS URL but no hosted credentials — the manual flow is genuinely available.
    capabilitiesMock.mockReturnValue({ selfHostedEnabled: true, baseUrl: 'https://acme.minusx.app' });
    expect((await call()).body.data).toMatchObject({ configured: false, selfHostedEnabled: true });

    // No public URL — Slack cannot deliver events here at all, so neither flow works.
    capabilitiesMock.mockReturnValue({ selfHostedEnabled: false, baseUrl: 'http://localhost:3000' });
    expect((await call()).body.data).toMatchObject({ configured: false, selfHostedEnabled: false });
  });

  it('stays admin-only', async () => {
    mockUser.value = { ...mockUser.value, role: 'viewer' };
    expect((await call()).status).toBe(403);
  });
});
