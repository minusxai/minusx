/**
 * Tests for network-logging utilities.
 *
 * Tests logNetworkRequest and logNetworkResponse — both fire-and-forget POSTs
 * to MX_API_BASE_URL/network. Errors are swallowed silently.
 */

import { logNetworkRequest, logNetworkResponse } from '../network-logging';

// Mock config so tests control MX_API_BASE_URL / MX_API_KEY
jest.mock('@/lib/config', () => ({
  MX_API_BASE_URL: 'http://mx-api.test',
  MX_API_KEY: 'test-key',
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({ ok: true });
});

describe('logNetworkRequest', () => {
  it('POSTs to MX_API_BASE_URL/network/request', async () => {
    await logNetworkRequest('req-123', {
      method: 'POST',
      protocol: 'https',
      domain: 'app.example.com',
      path: '/api/chat',
      headers: { 'content-type': 'application/json', 'authorization': 'Bearer secret' },
    }, { userId: 'user-1', mode: 'org' });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('http://mx-api.test/network/request');
    expect(options.method).toBe('POST');

    const body = JSON.parse(options.body);
    expect(body.request_id).toBe('req-123');
    expect(body.type).toBeUndefined();
    expect(body.method).toBe('POST');
    expect(body.path).toBe('/api/chat');
    expect(body.user_id).toBe('user-1');
    expect(body.mode).toBe('org');
  });

  it('strips sensitive headers (authorization, cookie, x-session-token, x-mx-api-key)', async () => {
    await logNetworkRequest('req-sanitize', {
      method: 'GET',
      path: '/api/files',
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer secret',
        'cookie': 'session=abc',
        'x-session-token': 'tok',
        'x-mx-api-key': 'apikey',
        'x-custom': 'kept',
      },
    }, null);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const sentHeaders = body.headers;
    expect(sentHeaders['content-type']).toBe('application/json');
    expect(sentHeaders['x-custom']).toBe('kept');
    expect(sentHeaders['authorization']).toBeUndefined();
    expect(sentHeaders['cookie']).toBeUndefined();
    expect(sentHeaders['x-session-token']).toBeUndefined();
    expect(sentHeaders['x-mx-api-key']).toBeUndefined();
  });

  it('sets mx-api-key header when MX_API_KEY is configured', async () => {
    await logNetworkRequest('req-auth', { method: 'GET', path: '/api/test', headers: {} }, null);

    const options = mockFetch.mock.calls[0][1];
    expect(options.headers['mx-api-key']).toBe('test-key');
  });

  it('sends null user context fields when user is null', async () => {
    await logNetworkRequest('req-anon', { method: 'GET', path: '/api/test', headers: {} }, null);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.user_id).toBeNull();
    expect(body.mode).toBeNull();
  });

  it('coerces numeric userId to string', async () => {
    await logNetworkRequest('req-numeric', { method: 'GET', path: '/api/test', headers: {} }, {
      userId: 99,
      mode: 'org',
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.user_id).toBe('99');
  });

  it('swallows fetch errors silently', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network failure'));

    // Should not throw
    await expect(
      logNetworkRequest('req-fail', { method: 'GET', path: '/', headers: {} }, null)
    ).resolves.toBeUndefined();
  });
});

describe('logNetworkResponse', () => {
  it('POSTs to MX_API_BASE_URL/network/response', async () => {
    await logNetworkResponse('req-456', { ok: true, data: [1, 2, 3] }, 200, false,
      { userId: 'user-2', mode: 'org' });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('http://mx-api.test/network/response');

    const body = JSON.parse(options.body);
    expect(body.request_id).toBe('req-456');
    expect(body.type).toBeUndefined();
    expect(body.status_code).toBe(200);
    expect(body.is_error).toBe(false);
    expect(body.response_body).toEqual({ ok: true, data: [1, 2, 3] });
    expect(body.user_id).toBe('user-2');
  });

  it('marks is_error true for error responses', async () => {
    await logNetworkResponse('req-err', { error: 'not found' }, 404, true, null);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.is_error).toBe(true);
    expect(body.status_code).toBe(404);
  });

  it('swallows fetch errors silently', async () => {
    mockFetch.mockRejectedValueOnce(new Error('timeout'));

    await expect(
      logNetworkResponse('req-fail', {}, 500, true, null)
    ).resolves.toBeUndefined();
  });
});

describe('logNetworkRequest when MX_API_BASE_URL is empty', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.mock('@/lib/config', () => ({
      MX_API_BASE_URL: '',
      MX_API_KEY: '',
      MX_NETWORK_LOG_EXCLUDE: '',
    }));
  });

  it('does nothing when MX_API_BASE_URL is empty', async () => {
    const { logNetworkRequest: log } = await import('../network-logging');
    await log('req-noop', { method: 'GET', path: '/', headers: {} }, null);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ── Path exclusion ────────────────────────────────────────────────────────────

describe('path exclusion — MX_NETWORK_LOG_EXCLUDE patterns', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.mock('@/lib/config', () => ({
      MX_API_BASE_URL: 'http://mx-api.test',
      MX_API_KEY: 'test-key',
      MX_NETWORK_LOG_EXCLUDE: '^/api/health,^/api/jobs/cron',
    }));
  });

  it('skips fetch for /api/health', async () => {
    const { logNetworkRequest: log } = await import('../network-logging');
    await log('req-health', { method: 'GET', path: '/api/health' }, null);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('skips fetch for /api/health/check (sub-path match)', async () => {
    const { logNetworkRequest: log } = await import('../network-logging');
    await log('req-health-check', { method: 'GET', path: '/api/health/check' }, null);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('skips fetch for /api/jobs/cron', async () => {
    const { logNetworkRequest: log } = await import('../network-logging');
    await log('req-cron', { method: 'GET', path: '/api/jobs/cron' }, null);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does NOT skip /api/chat (not excluded)', async () => {
    const { logNetworkRequest: log } = await import('../network-logging');
    await log('req-chat', { method: 'POST', path: '/api/chat' }, null);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('skips logNetworkResponse for excluded path', async () => {
    const { logNetworkResponse: logResp } = await import('../network-logging');
    await logResp('req-health-resp', { ok: true }, 200, false, null, '/api/health');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does NOT skip logNetworkResponse for non-excluded path', async () => {
    const { logNetworkResponse: logResp } = await import('../network-logging');
    await logResp('req-chat-resp', { ok: true }, 200, false, null, '/api/chat');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe('path exclusion — custom MX_NETWORK_LOG_EXCLUDE patterns', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.mock('@/lib/config', () => ({
      MX_API_BASE_URL: 'http://mx-api.test',
      MX_API_KEY: 'test-key',
      MX_NETWORK_LOG_EXCLUDE: '^/api/query-estimate,^/api/cache',
    }));
  });

  it('skips a path matching a custom exclusion pattern', async () => {
    const { logNetworkRequest: log } = await import('../network-logging');
    await log('req-estimate', { method: 'GET', path: '/api/query-estimate' }, null);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('skips a second custom pattern', async () => {
    const { logNetworkRequest: log } = await import('../network-logging');
    await log('req-cache', { method: 'POST', path: '/api/cache/clear' }, null);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('still logs paths not matching any pattern', async () => {
    const { logNetworkRequest: log } = await import('../network-logging');
    await log('req-chat', { method: 'POST', path: '/api/chat' }, null);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe('path exclusion — empty MX_NETWORK_LOG_EXCLUDE logs everything', () => {
  it('does NOT skip /api/health when env var is empty', async () => {
    // top-level mock has MX_NETWORK_LOG_EXCLUDE: '' — no patterns, nothing excluded
    await logNetworkRequest('req-health', { method: 'GET', path: '/api/health' }, null);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
