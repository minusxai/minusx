import type { Mock } from 'vitest';
/**
 * App-event forwarding: enrichEventPayload (request/session context) +
 * forwardToWebhooks (EVENTS_FORWARD_RULES regex → webhook fan-out, Slack-formatted
 * for hooks.slack.com, raw JSON otherwise).
 */

vi.mock('server-only', () => ({}));

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: mockGet }),
}));

vi.mock('@/lib/auth/auth-helpers', () => ({
  getEffectiveUser: vi.fn(),
}));

vi.mock('@/lib/config', () => ({
  EVENTS_FORWARD_RULES: [
    { pattern: /^error$/, url: 'https://hooks.slack.com/services/errors' },
    { pattern: /^share:lead$/, url: 'https://hooks.slack.com/services/leads' },
    { pattern: /^user:.*/, url: 'https://central.example.com/ingest' },
  ],
}));

import { enrichEventPayload, forwardToWebhooks } from '../app-events-notifier';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';

const mockFetch = vi.fn().mockResolvedValue({ ok: true } as Response);
global.fetch = mockFetch;
const mockGetEffectiveUser = getEffectiveUser as Mock;

function callTo(url: string) {
  const call = mockFetch.mock.calls.find(c => c[0] === url);
  return call ? JSON.parse(call[1].body as string) : undefined;
}

beforeEach(() => {
  mockFetch.mockClear();
  mockGet.mockReset();
  mockGetEffectiveUser.mockReset();
  mockGet.mockImplementation((key: string) => {
    if (key === 'x-request-path') return '/api/chat/stream';
    if (key === 'referer') return 'https://app.example.com/f/42';
    return null;
  });
  mockGetEffectiveUser.mockResolvedValue({ userId: 7, email: 'alice@example.com', role: 'admin', mode: 'org', name: 'Alice', home_folder: '/org' });
});

describe('enrichEventPayload', () => {
  it('adds requestPath, clientUrl, userEmail, userRole + sets type', async () => {
    const e = await enrichEventPayload('error', { mode: 'org', source: 'tool', message: 'boom' });
    expect(e).toMatchObject({
      type: 'error', requestPath: '/api/chat/stream', clientUrl: 'https://app.example.com/f/42',
      userEmail: 'alice@example.com', userRole: 'admin', source: 'tool', message: 'boom',
    });
  });

  it('omits requestPath/clientUrl when headers unavailable', async () => {
    mockGet.mockReturnValue(null);
    const e = await enrichEventPayload('error', { mode: 'org', message: 'cron' });
    expect(e.requestPath).toBeUndefined();
    expect(e.clientUrl).toBeUndefined();
    expect(e.userEmail).toBe('alice@example.com');
  });

  it('omits userEmail/userRole when session unavailable', async () => {
    mockGetEffectiveUser.mockResolvedValue(null);
    const e = await enrichEventPayload('error', { mode: 'org', message: 'x' });
    expect(e.userEmail).toBeUndefined();
    expect(e.userRole).toBeUndefined();
    expect(e.requestPath).toBe('/api/chat/stream');
  });

  it('call-site payload overrides enriched defaults', async () => {
    const e = await enrichEventPayload('user:login', { mode: 'org', userEmail: 'explicit@x.com', userRole: 'viewer' });
    expect(e.userEmail).toBe('explicit@x.com');
    expect(e.userRole).toBe('viewer');
  });
});

describe('forwardToWebhooks', () => {
  it('posts a matched event to its webhook only (regex match)', async () => {
    await forwardToWebhooks('error', { type: 'error', mode: 'org', message: 'boom' });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe('https://hooks.slack.com/services/errors');
  });

  it('formats Slack webhooks as { text: "*type*\\n• k: v" }', async () => {
    await forwardToWebhooks('share:lead', { type: 'share:lead', mode: 'org', email: 'jane@acme.test', name: 'Jane' });
    const body = callTo('https://hooks.slack.com/services/leads');
    expect(Object.keys(body)).toEqual(['text']);
    expect(body.text).toContain('*share:lead*');
    expect(body.text).toContain('• email: jane@acme.test');
    expect(body.text).not.toContain('• type:'); // header line only
  });

  it('posts raw enriched JSON to non-Slack webhooks (e.g. central ingest)', async () => {
    await forwardToWebhooks('user:login', { type: 'user:login', mode: 'org', userEmail: 'a@b.com' });
    const body = callTo('https://central.example.com/ingest');
    expect(body).toMatchObject({ type: 'user:login', mode: 'org', userEmail: 'a@b.com' });
    expect(body.text).toBeUndefined(); // not Slack-formatted
  });

  it('does nothing when no rule matches', async () => {
    await forwardToWebhooks('file:viewed', { type: 'file:viewed', mode: 'org', fileId: 1 });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
