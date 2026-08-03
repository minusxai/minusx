// PUT /api/users/[id] must publish user:updated (audit trail for role/2FA/
// home_folder changes — previously only DELETE published). Field NAMES only,
// never values. UserDB is mocked so the test exercises the ROUTE's behavior.

vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/database/user-db', () => ({
  UserDB: { getById: vi.fn(), update: vi.fn() },
}));

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { PUT } from '@/app/api/users/[id]/route';
import { auth } from '@/auth';
import { UserDB } from '@/lib/database/user-db';
import { appEventRegistry, AppEvents } from '@/lib/app-event-registry';
import { NextRequest } from 'next/server';

const captured: { event: string; payload: Record<string, unknown> }[] = [];
appEventRegistry.subscribeAll((event, payload) => {
  captured.push({ event, payload: payload as unknown as Record<string, unknown> });
});

const TARGET = { id: 5, email: 'target@x.co', name: 'T', phone: null, state: null, role: 'editor', home_folder: '/org' };

const put = (body: Record<string, unknown>) =>
  PUT(
    new NextRequest('http://localhost/api/users/5', { method: 'PUT', body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: '5' }) },
  );

beforeEach(() => {
  captured.length = 0;
  (auth as Mock).mockResolvedValue({ user: { userId: 1, role: 'admin', email: 'admin@x.co' } });
  (UserDB.getById as Mock).mockResolvedValue(TARGET);
  (UserDB.update as Mock).mockResolvedValue(undefined);
});

describe('PUT /api/users/[id] audit event', () => {
  it('publishes user:updated with changed field NAMES and the acting admin', async () => {
    const res = await put({ role: 'editor', home_folder: '/org/team' });
    expect(res.status).toBe(200);

    const events = captured.filter((c) => c.event === AppEvents.USER_UPDATED);
    expect(events).toHaveLength(1);
    expect(events[0].payload.userId).toBe(5);
    expect(events[0].payload.userEmail).toBe('target@x.co');
    expect(events[0].payload.changedFields).toEqual(['role', 'home_folder']);
    expect(events[0].payload.updatedBy).toBe('admin@x.co');
  });

  it('never leaks values — a password change reports the field name only', async () => {
    const res = await put({ password: 'hunter2-secret' });
    expect(res.status).toBe(200);

    const events = captured.filter((c) => c.event === AppEvents.USER_UPDATED);
    expect(events).toHaveLength(1);
    // The route hashes `password` into `password_hash` before updating.
    expect(events[0].payload.changedFields).toEqual(['password_hash']);
    expect(JSON.stringify(events[0].payload)).not.toContain('hunter2-secret');
  });

  it('publishes nothing when the update is rejected (non-admin editing another user)', async () => {
    (auth as Mock).mockResolvedValue({ user: { userId: 99, role: 'viewer', email: 'v@x.co' } });
    const res = await put({ role: 'admin' });
    expect(res.status).toBe(403);
    expect(captured.filter((c) => c.event === AppEvents.USER_UPDATED)).toHaveLength(0);
  });
});
