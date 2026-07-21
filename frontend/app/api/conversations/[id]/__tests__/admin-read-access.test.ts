// Admin direct read access: an admin may GET any conversation by id (and its stream) —
// read-only. Mutations (turns/interrupt/DELETE/PATCH/fork) remain strictly owner-only,
// covered by stream-turns.test.ts. Non-admins remain owner-only for reads too.

import { NextRequest } from 'next/server';
import { GET as getRoute, DELETE as deleteRoute } from '@/app/api/conversations/[id]/route';
import { GET as streamRoute } from '@/app/api/conversations/[id]/stream/route';
import { createConversation, appendMessages } from '@/lib/data/conversations.server';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { fixtureLog } from '@/lib/data/__tests__/projection-fixtures';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';

const TEST_DB_PATH = getTestDbPath('admin_read_access');
const idCtx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) }) as never;

// The global test user (vitest.setup.ts) is userId 1, role 'admin', mode 'org'.
const asNonAdmin = () => vi.mocked(getEffectiveUser).mockResolvedValueOnce({
  userId: 1,
  email: 'editor@example.com',
  name: 'Editor',
  role: 'editor',
  home_folder: '/org',
  mode: 'org',
} as Awaited<ReturnType<typeof getEffectiveUser>>);

async function seedOtherUsersConversation(mode = 'org'): Promise<number> {
  const conv = await createConversation({ ownerUserId: 999, mode, agent: 'WebAnalystAgent' });
  await appendMessages(conv.id, fixtureLog, 0);
  return conv.id;
}

describe('admin direct read access to conversations', () => {
  setupTestDb(TEST_DB_PATH);

  it("admin can GET another user's conversation by id", async () => {
    const id = await seedOtherUsersConversation();
    const res = await getRoute(new NextRequest(`http://localhost/api/conversations/${id}`), idCtx(id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.messages).toHaveLength(fixtureLog.length);
  });

  it('admin can GET a conversation from a different mode', async () => {
    const id = await seedOtherUsersConversation('tutorial');
    const res = await getRoute(new NextRequest(`http://localhost/api/conversations/${id}`), idCtx(id));
    expect(res.status).toBe(200);
  });

  it("admin can stream another user's conversation", async () => {
    const id = await seedOtherUsersConversation();
    const res = await streamRoute(new NextRequest(`http://localhost/api/conversations/${id}/stream?since=-1`), idCtx(id));
    expect(res.status).toBe(200);
    await res.body?.cancel();
  });

  it("non-admin cannot GET another user's conversation", async () => {
    const id = await seedOtherUsersConversation();
    asNonAdmin();
    const res = await getRoute(new NextRequest(`http://localhost/api/conversations/${id}`), idCtx(id));
    expect(res.status).toBe(403);
  });

  it("admin still cannot DELETE another user's conversation (mutations stay owner-only)", async () => {
    const id = await seedOtherUsersConversation();
    const res = await deleteRoute(new NextRequest(`http://localhost/api/conversations/${id}`, { method: 'DELETE' }), idCtx(id));
    expect(res.status).toBe(403);
  });
});
