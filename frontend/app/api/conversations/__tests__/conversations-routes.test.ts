// In-process tests for the v3 conversation REST surface: create (POST), list (GET, unioned + tagged
// version:3), get-with-messages (GET :id), delete (DELETE :id), and owner/mode authorization.
// Auth is globally mocked to userId:1, mode:'org' (test/setup/vitest.setup.ts).

import { NextRequest } from 'next/server';
import { POST, GET as listConversationsRoute } from '@/app/api/conversations/route';
import { GET as getConversationRoute, DELETE as deleteConversationRoute } from '@/app/api/conversations/[id]/route';
import { createConversation, appendMessages } from '@/lib/data/conversations.server';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import type { ConversationLog } from '@/orchestrator/types';

const TEST_DB_PATH = getTestDbPath('conversations_routes');

const idCtx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
const post = (body: unknown) =>
  new NextRequest('http://localhost/api/conversations', { method: 'POST', body: JSON.stringify(body) });

const LOG: ConversationLog = ([
  { type: 'toolCall', id: 'root1', name: 'WebAnalystAgent', parent_id: null, arguments: { userMessage: 'hi' }, context: {} },
  { role: 'toolResult', parent_id: 'root1', toolCallId: 'tc1', toolName: 'ReadFiles', content: [{ type: 'text', text: '{}' }], isError: false, timestamp: 1 },
] as unknown as ConversationLog);

describe('v3 conversations REST', () => {
  setupTestDb(TEST_DB_PATH);

  it('POST creates a v3 conversation and returns its id', async () => {
    const res = await POST(post({ firstMessage: 'which month has max mrr?' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.id).toBe('number');
    expect(body.conversation.meta.version).toBe(3);
    expect(body.conversation.ownerUserId).toBe(1);
  });

  it('GET lists the user\'s conversations tagged version:3', async () => {
    const created = await (await POST(post({ firstMessage: 'list me' }))).json();
    await appendMessages(created.id, LOG, 0); // a conversation lists once it has a message (empty ones are hidden)
    const res = await listConversationsRoute(new NextRequest('http://localhost/api/conversations'));
    const body = await res.json();
    const found = body.conversations.find((c: { id: number }) => c.id === created.id);
    expect(found).toBeDefined();
    expect(found.version).toBe(3);
    expect(found.name).toBe('list me');
  });

  it('GET excludes empty (pre-created, never-messaged) conversations', async () => {
    const created = await (await POST(post({ firstMessage: 'empty draft' }))).json();
    const res = await listConversationsRoute(new NextRequest('http://localhost/api/conversations'));
    const body = await res.json();
    expect(body.conversations.find((c: { id: number }) => c.id === created.id)).toBeUndefined();
  });

  it('GET paginates via nextCursor (?limit + ?before&beforeId) with no overlap', async () => {
    for (let i = 0; i < 3; i++) {
      const c = await (await POST(post({ firstMessage: `page-${i}` }))).json();
      await appendMessages(c.id, LOG, 0);
    }
    const r1 = await (await listConversationsRoute(new NextRequest('http://localhost/api/conversations?limit=2'))).json();
    expect(r1.conversations).toHaveLength(2);
    expect(r1.nextCursor).toBeTruthy();
    const cur = r1.nextCursor;
    const url = `http://localhost/api/conversations?limit=2&before=${encodeURIComponent(cur.updatedAt)}&beforeId=${cur.id}`;
    const r2 = await (await listConversationsRoute(new NextRequest(url))).json();
    const ids1: number[] = r1.conversations.map((c: { id: number }) => c.id);
    const ids2: number[] = r2.conversations.map((c: { id: number }) => c.id);
    expect(ids1.some((id) => ids2.includes(id))).toBe(false); // pages don't overlap
  });

  it('GET ?q= filters server-side (matches across all pages, not just one)', async () => {
    const hit = await (await POST(post({ firstMessage: 'quarterly revenue report' }))).json();
    await appendMessages(hit.id, LOG, 0);
    const miss = await (await POST(post({ firstMessage: 'tomorrow weather forecast' }))).json();
    await appendMessages(miss.id, LOG, 0);
    const res = await listConversationsRoute(new NextRequest('http://localhost/api/conversations?q=revenue'));
    const ids: number[] = (await res.json()).conversations.map((c: { id: number }) => c.id);
    expect(ids).toContain(hit.id);
    expect(ids).not.toContain(miss.id);
  });

  it('GET :id returns the conversation + its message log', async () => {
    const created = await (await POST(post({ firstMessage: 'go' }))).json();
    await appendMessages(created.id, LOG, 0);

    const res = await getConversationRoute(new NextRequest(`http://localhost/api/conversations/${created.id}`), idCtx(created.id) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.conversation.id).toBe(created.id);
    expect(body.data.messages.map((m: { seq: number }) => m.seq)).toEqual([0, 1]);
    expect(body.data.messages[0].content.arguments.userMessage).toBe('hi');
  });

  it("GET :id on another user's conversation: allowed for admins, forbidden otherwise", async () => {
    const other = await createConversation({ ownerUserId: 999, mode: 'org', agent: 'WebAnalystAgent' });
    // The default test user is an admin → direct read access (see admin-read-access.test.ts).
    const asAdmin = await getConversationRoute(new NextRequest(`http://localhost/api/conversations/${other.id}`), idCtx(other.id) as never);
    expect(asAdmin.status).toBe(200);

    vi.mocked(getEffectiveUser).mockResolvedValueOnce({
      userId: 1, email: 'editor@example.com', name: 'Editor', role: 'editor', home_folder: '/org', mode: 'org',
    } as Awaited<ReturnType<typeof getEffectiveUser>>);
    const asEditor = await getConversationRoute(new NextRequest(`http://localhost/api/conversations/${other.id}`), idCtx(other.id) as never);
    expect(asEditor.status).toBe(403);
  });

  it('DELETE :id removes it (idempotent); 403 for another user\'s', async () => {
    const created = await (await POST(post({}))).json();
    const del = await deleteConversationRoute(new NextRequest(`http://localhost/api/conversations/${created.id}`, { method: 'DELETE' }), idCtx(created.id) as never);
    expect(del.status).toBe(200);
    // Now gone → GET 404.
    const after = await getConversationRoute(new NextRequest(`http://localhost/api/conversations/${created.id}`), idCtx(created.id) as never);
    expect(after.status).toBe(404);

    const other = await createConversation({ ownerUserId: 999, mode: 'org', agent: 'WebAnalystAgent' });
    const forbidden = await deleteConversationRoute(new NextRequest(`http://localhost/api/conversations/${other.id}`, { method: 'DELETE' }), idCtx(other.id) as never);
    expect(forbidden.status).toBe(403);
  });
});
