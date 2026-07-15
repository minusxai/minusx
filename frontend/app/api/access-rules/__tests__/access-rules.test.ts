/**
 * /api/access-rules — the built-in-roles capability editor's API.
 * GET returns the effective matrix; PUT writes editor/viewer overrides into
 * the org config and MUST refuse admin changes (lockout guard).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getTestDbPath, initTestDatabase, cleanupTestDatabase } from '@/store/__tests__/test-utils';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

const { mockUser } = vi.hoisted(() => ({
  mockUser: { value: { userId: 1, email: 'a@x.co', name: 'A', role: 'admin', home_folder: '', mode: 'org' } as EffectiveUser },
}));
vi.mock('@/lib/http/with-auth', () => ({
  withAuth: (handler: (req: NextRequest, user: EffectiveUser) => Promise<Response>) =>
    async (request: NextRequest) => handler(request, mockUser.value),
}));

import { GET, PUT } from '../route';

const DB = getTestDbPath('access_rules_api');
const put = (body: unknown) => PUT(new NextRequest('http://x/api/access-rules', { method: 'PUT', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }));

describe('/api/access-rules', () => {
  beforeAll(async () => { await initTestDatabase(DB); }, 30_000);
  afterAll(async () => { await cleanupTestDatabase(DB); });

  it('GET returns the effective matrix with admin locked', async () => {
    const res = await GET(new NextRequest('http://x/api/access-rules'));
    const body = await res.json();
    const roles = body.data.roles;
    expect(roles.map((r: { role: string }) => r.role)).toEqual(['admin', 'editor', 'viewer']);
    expect(roles[0].locked).toBe(true);
    expect(roles[0].allowedTypes).toBe('*');
    expect(roles[1].allowedTypes).toContain('question');
  });

  it('PUT writes an editor override and GET reflects it', async () => {
    const res = await put({ accessRules: { editor: { viewTypes: ['question'] } } });
    expect(res.status).toBe(200);
    const after = await (await GET(new NextRequest('http://x/api/access-rules'))).json();
    const editor = after.data.roles.find((r: { role: string }) => r.role === 'editor');
    expect(editor.viewTypes).toEqual(['question']);
    expect(editor.overridden).toBe(true);
    await put({ accessRules: {} }); // note: merge semantics — override remains until replaced
  });

  it('PUT refuses admin overrides and junk shapes', async () => {
    expect((await put({ accessRules: { admin: { allowedTypes: ['question'] } } })).status).toBeGreaterThanOrEqual(400);
    expect((await put({ accessRules: { editor: { allowedTypes: 5 } } })).status).toBeGreaterThanOrEqual(400);
    expect((await put({})).status).toBeGreaterThanOrEqual(400);
  });

  it('non-admin callers are forbidden', async () => {
    mockUser.value = { ...mockUser.value, role: 'viewer' };
    try {
      expect((await GET(new NextRequest('http://x/api/access-rules'))).status).toBe(403);
      expect((await put({ accessRules: {} })).status).toBe(403);
    } finally {
      mockUser.value = { ...mockUser.value, role: 'admin' };
    }
  });
});
