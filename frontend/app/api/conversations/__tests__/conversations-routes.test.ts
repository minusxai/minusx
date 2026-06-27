// In-process tests for the v3 conversation REST surface: create (POST), list (GET, unioned + tagged
// version:3), get-with-messages (GET :id), delete (DELETE :id), and owner/mode authorization.
// Auth is globally mocked to userId:1, mode:'org' (test/setup/vitest.setup.ts).
vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

import { NextRequest } from 'next/server';
import { POST, GET as listConversationsRoute } from '@/app/api/conversations/route';
import { GET as getConversationRoute, DELETE as deleteConversationRoute } from '@/app/api/conversations/[id]/route';
import { createConversation, appendMessages } from '@/lib/data/conversations.server';
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
    const res = await listConversationsRoute(new NextRequest('http://localhost/api/conversations'));
    const body = await res.json();
    const found = body.conversations.find((c: { id: number }) => c.id === created.id);
    expect(found).toBeDefined();
    expect(found.version).toBe(3);
    expect(found.name).toBe('list me');
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

  it('GET :id is forbidden for a conversation owned by another user', async () => {
    const other = await createConversation({ ownerUserId: 999, mode: 'org', agent: 'WebAnalystAgent' });
    const res = await getConversationRoute(new NextRequest(`http://localhost/api/conversations/${other.id}`), idCtx(other.id) as never);
    expect(res.status).toBe(403);
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
