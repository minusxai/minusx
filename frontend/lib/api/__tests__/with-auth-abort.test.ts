/**
 * withAuth must rethrow client-abort errors without publishing AppEvents.ERROR
 * (Slack/Sentry); real server errors keep being published. (Sentry MINUSX-BI-1Q)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { appEventRegistry, AppEvents } from '@/lib/app-event-registry';

vi.mock('@/lib/auth/auth-helpers', () => ({
  getEffectiveUser: vi.fn().mockResolvedValue({
    userId: 1,
    email: 'test@example.com',
    name: 'Test',
    role: 'admin',
    home_folder: '',
    mode: 'org',
  }),
}));

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/validate-sql', { method: 'POST' });
}

describe('withAuth error reporting', () => {
  let publishSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    publishSpy = vi.spyOn(appEventRegistry, 'publish').mockImplementation(() => {});
  });

  afterEach(() => {
    publishSpy.mockRestore();
  });

  function errorPublishes() {
    return publishSpy.mock.calls.filter((c: unknown[]) => c[0] === AppEvents.ERROR);
  }

  it('rethrows but does not publish Node http "aborted" (ECONNRESET) errors', async () => {
    const abort = Object.assign(new Error('aborted'), { code: 'ECONNRESET' });
    const wrapped = withAuth(async () => { throw abort; });

    await expect(wrapped(makeRequest())).rejects.toThrow('aborted');
    expect(errorPublishes()).toHaveLength(0);
  });

  it('rethrows but does not publish a bare "aborted" error (no code)', async () => {
    const wrapped = withAuth(async () => { throw new Error('aborted'); });

    await expect(wrapped(makeRequest())).rejects.toThrow('aborted');
    expect(errorPublishes()).toHaveLength(0);
  });

  it('rethrows but does not publish AbortError', async () => {
    const abort = Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
    const wrapped = withAuth(async () => { throw abort; });

    await expect(wrapped(makeRequest())).rejects.toThrow();
    expect(errorPublishes()).toHaveLength(0);
  });

  it('still publishes real server errors and rethrows them', async () => {
    const wrapped = withAuth(async () => { throw new Error('database exploded'); });

    await expect(wrapped(makeRequest())).rejects.toThrow('database exploded');
    const calls = errorPublishes();
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toMatchObject({
      source: 'server:/api/validate-sql',
      message: 'database exploded',
    });
  });

  it('does not treat errors merely containing "aborted" in a longer message as aborts', async () => {
    const wrapped = withAuth(async () => { throw new Error('transaction aborted by deadlock detector'); });

    await expect(wrapped(makeRequest())).rejects.toThrow();
    expect(errorPublishes()).toHaveLength(1);
  });

  it('passes through successful responses untouched', async () => {
    const wrapped = withAuth(async () => NextResponse.json({ ok: true }));
    const res = await wrapped(makeRequest());
    expect(res.status).toBe(200);
    expect(errorPublishes()).toHaveLength(0);
  });
});
