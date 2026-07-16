// Conversations V2 — lazy screenshot endpoint (see /conversations-v2.md).
// GET /api/conversations/:id/screenshots/:callId serves the first inline image from that tool
// call's RESPONSE content (generic — no tool names), gated by the same ownership check as the
// conversation itself, with immutable caching. The slim GET rewrites `details.screenshotUrl`
// to this URL so the conversation JSON stops carrying pixels.

import { NextRequest } from 'next/server';
import { GET as screenshotRoute } from '@/app/api/conversations/[id]/screenshots/[callId]/route';
import { GET as getRoute } from '@/app/api/conversations/[id]/route';
import { createConversation, appendMessages } from '@/lib/data/conversations.server';
import { fixtureLog, big } from '@/lib/data/__tests__/projection-fixtures';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';

const TEST_DB_PATH = getTestDbPath('screenshots_route');
const ctx = (id: number, callId: string) =>
  ({ params: Promise.resolve({ id: String(id), callId }) }) as never;

async function seedConversation(ownerUserId = 1): Promise<number> {
  const conv = await createConversation({ ownerUserId, mode: 'org', agent: 'WebAnalystAgent' });
  await appendMessages(conv.id, fixtureLog, 0);
  return conv.id;
}

describe('GET /api/conversations/:id/screenshots/:callId', () => {
  setupTestDb(TEST_DB_PATH);

  it('serves the tool result image bytes with mime type + immutable caching', async () => {
    const id = await seedConversation();
    const res = await screenshotRoute(
      new NextRequest(`http://localhost/api/conversations/${id}/screenshots/tc-edit-1`),
      ctx(id, 'tc-edit-1'),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
    expect(res.headers.get('Cache-Control')).toContain('immutable');
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.equals(Buffer.from(big(60_000, 'i'), 'base64'))).toBe(true);
  });

  it('404s for a tool call whose response has no image', async () => {
    const id = await seedConversation();
    const res = await screenshotRoute(
      new NextRequest(`http://localhost/api/conversations/${id}/screenshots/tc-search-1`),
      ctx(id, 'tc-search-1'),
    );
    expect(res.status).toBe(404);
  });

  it('404s for an unknown call id', async () => {
    const id = await seedConversation();
    const res = await screenshotRoute(
      new NextRequest(`http://localhost/api/conversations/${id}/screenshots/nope`),
      ctx(id, 'nope'),
    );
    expect(res.status).toBe(404);
  });

  it("403s on someone else's conversation (same gate as the conversation GET)", async () => {
    const id = await seedConversation(2); // effective test user is userId 1
    const res = await screenshotRoute(
      new NextRequest(`http://localhost/api/conversations/${id}/screenshots/tc-edit-1`),
      ctx(id, 'tc-edit-1'),
    );
    expect(res.status).toBe(403);
  });

  it('slim conversation GET rewrites details.screenshotUrl to this endpoint', async () => {
    const id = await seedConversation();
    const res = await getRoute(
      new NextRequest(`http://localhost/api/conversations/${id}`),
      ({ params: Promise.resolve({ id: String(id) }) }) as never,
    );
    const body = await res.json();
    const edit = body.data.messages[2].content as { details: { screenshotUrl: string } };
    expect(edit.details.screenshotUrl).toBe(`/api/conversations/${id}/screenshots/tc-edit-1?mode=org`);
  });
});
