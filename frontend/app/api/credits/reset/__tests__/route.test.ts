vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));
vi.mock('@/lib/auth/auth-helpers', () => ({ getEffectiveUser: vi.fn() }));

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { POST } from '@/app/api/credits/reset/route';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { appEventRegistry } from '@/lib/app-event-registry';
import { AppEvents } from '@/lib/app-event-registry/events';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { NextRequest } from 'next/server';

const post = (body: unknown) =>
  POST(new NextRequest('http://localhost/api/credits/reset', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }), undefined as never);

describe('POST /api/credits/reset', () => {
  setupTestDb(getTestDbPath('credits_reset_route'));
  beforeEach(() => vi.clearAllMocks());

  it('publishes a CREDIT_RESET for an admin and returns ok', async () => {
    (getEffectiveUser as Mock).mockResolvedValue({ userId: 1, role: 'admin', email: 'a@x.co', mode: 'org' });
    const spy = vi.spyOn(appEventRegistry, 'publish');
    const res = await post({ scope: 'user', target: '42' });
    expect(res.status).toBe(200);
    const reset = spy.mock.calls.find((c) => c[0] === AppEvents.CREDIT_RESET);
    expect(reset?.[1]).toMatchObject({ scope: 'user', target: '42', actorEmail: 'a@x.co' });
  });

  it('defaults target to "company" for a company reset', async () => {
    (getEffectiveUser as Mock).mockResolvedValue({ userId: 1, role: 'admin', email: 'a@x.co', mode: 'org' });
    const spy = vi.spyOn(appEventRegistry, 'publish');
    await post({ scope: 'company' });
    expect(spy.mock.calls.find((c) => c[0] === AppEvents.CREDIT_RESET)?.[1]).toMatchObject({ scope: 'company', target: 'company' });
  });

  it('403s for a non-admin', async () => {
    (getEffectiveUser as Mock).mockResolvedValue({ userId: 2, role: 'viewer', email: 'v@x.co', mode: 'org' });
    expect((await post({ scope: 'company' })).status).toBe(403);
  });

  it('400s on an invalid scope or a missing user/role target', async () => {
    (getEffectiveUser as Mock).mockResolvedValue({ userId: 1, role: 'admin', email: 'a@x.co', mode: 'org' });
    expect((await post({ scope: 'galaxy' })).status).toBe(400);
    expect((await post({ scope: 'user' })).status).toBe(400); // no target
  });
});
