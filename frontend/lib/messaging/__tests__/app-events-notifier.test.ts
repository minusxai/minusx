/**
 * notifyAppEvent enrichment tests
 *
 * Verifies that every outgoing notification is automatically enriched with
 * requestPath, clientUrl, userEmail, and userRole — regardless of what the
 * call site passes — and that explicit call-site values are not overwritten.
 */

vi.mock('server-only', () => ({}));

const mockGet = vi.fn();
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: mockGet }),
}));

vi.mock('@/lib/auth/auth-helpers', () => ({
  getEffectiveUser: vi.fn(),
}));

vi.mock('@/lib/config', () => ({
  OBJECT_STORE_PUBLIC_URL: undefined,
  MX_NETWORK_LOG_EXCLUDE: '',
  MX_API_BASE_URL: 'https://notify.example.com',
  MX_API_KEY: 'test-key',
}));

import { notifyAppEvent } from '../app-events-notifier';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';

const mockFetch = vi.fn().mockResolvedValue({ ok: true } as Response);
global.fetch = mockFetch;

const mockGetEffectiveUser = getEffectiveUser as vi.Mock;

function sentBody(): Record<string, unknown> {
  const raw = mockFetch.mock.calls[0][1].body as string;
  return JSON.parse(raw);
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
  mockGetEffectiveUser.mockResolvedValue({
    userId: 7,
    email: 'alice@example.com',
    role: 'admin',
    mode: 'org',
    name: 'Alice',
    home_folder: '/org',
  });
});

describe('notifyAppEvent enrichment', () => {
  it('includes requestPath, clientUrl, userEmail, userRole in every outgoing payload', async () => {
    await notifyAppEvent('error', { mode: 'org', source: 'tool_handler', message: 'boom' });

    const body = sentBody();
    expect(body.requestPath).toBe('/api/chat/stream');
    expect(body.clientUrl).toBe('https://app.example.com/f/42');
    expect(body.userEmail).toBe('alice@example.com');
    expect(body.userRole).toBe('admin');
  });

  it('omits requestPath and clientUrl when headers are unavailable', async () => {
    mockGet.mockReturnValue(null);

    await notifyAppEvent('error', { mode: 'org', source: 'cron', message: 'nightly fail' });

    const body = sentBody();
    expect(body.requestPath).toBeUndefined();
    expect(body.clientUrl).toBeUndefined();
    expect(body.userEmail).toBe('alice@example.com');
  });

  it('omits userEmail and userRole when session is unavailable', async () => {
    mockGetEffectiveUser.mockResolvedValue(null);

    await notifyAppEvent('error', { mode: 'org', source: 'cron', message: 'no session' });

    const body = sentBody();
    expect(body.userEmail).toBeUndefined();
    expect(body.userRole).toBeUndefined();
    expect(body.requestPath).toBe('/api/chat/stream');
  });

  it('call-site payload overrides enriched defaults', async () => {
    await notifyAppEvent('user:logged_in', {
      mode: 'org',
      userEmail: 'explicit@example.com',
      userRole: 'viewer',
    });

    const body = sentBody();
    expect(body.userEmail).toBe('explicit@example.com');
    expect(body.userRole).toBe('viewer');
  });

  it('passes through call-site event fields untouched', async () => {
    await notifyAppEvent('error', {
      mode: 'org',
      source: 'tool_handler',
      message: 'invalid input syntax',
      context: { tool: 'SearchFiles' },
    });

    const body = sentBody();
    expect(body.type).toBe('error');
    expect(body.mode).toBe('org');
    expect(body.source).toBe('tool_handler');
    expect(body.message).toBe('invalid input syntax');
    expect(body.context).toEqual({ tool: 'SearchFiles' });
  });

  it('sends to the correct endpoint with the api key header', async () => {
    await notifyAppEvent('error', { mode: 'org', source: 'x', message: 'y' });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://notify.example.com/notify',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'mx-api-key': 'test-key' }),
      }),
    );
  });
});
