// Conversations V2 — wire projection on the read routes (see /conversations-v2.md).
// GET /api/conversations/:id defaults to the slim `display` view; `?view=full` returns the
// verbatim log; `?since=<seq>` returns only newer rows. The stream's catch-up applies the same
// projection. Seeds rows directly via appendMessages (no LLM involved).

import { NextRequest } from 'next/server';
import { GET as getRoute } from '@/app/api/conversations/[id]/route';
import { GET as streamRoute } from '@/app/api/conversations/[id]/stream/route';
import { createConversation, appendMessages } from '@/lib/data/conversations.server';
import type { ConversationStreamEvent, MessageRow } from '@/lib/data/conversations.types';
import { fixtureLog, rootInvocation, editFileResult } from '@/lib/data/__tests__/projection-fixtures';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';

const TEST_DB_PATH = getTestDbPath('get_view_projection');
const idCtx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) }) as never;

type AnyEntry = Record<string, any>;

async function seedConversation(): Promise<number> {
  const conv = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });
  await appendMessages(conv.id, fixtureLog, 0);
  return conv.id;
}

async function getMessages(id: number, qs = ''): Promise<MessageRow[]> {
  const res = await getRoute(new NextRequest(`http://localhost/api/conversations/${id}${qs}`), idCtx(id));
  expect(res.status).toBe(200);
  const body = await res.json();
  return body.data.messages as MessageRow[];
}

async function readEvents(res: Response): Promise<ConversationStreamEvent[]> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const events: ConversationStreamEvent[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const line = chunk.split('\n').find((l) => l.startsWith('data: '));
      if (line) events.push(JSON.parse(line.slice(6)) as ConversationStreamEvent);
    }
  }
  return events;
}

describe('GET /api/conversations/:id — display projection + view/since params', () => {
  setupTestDb(TEST_DB_PATH);

  it('default view is slim: context stripped, EditFile content dropped, entry count preserved', async () => {
    const id = await seedConversation();
    const messages = await getMessages(id);
    expect(messages).toHaveLength(fixtureLog.length);

    const root = messages[0].content as AnyEntry;
    expect(root.arguments).toEqual({ userMessage: 'polish the story' });
    expect(Object.keys(root.context).sort()).toEqual(['attachments', 'currentTime']);

    const edit = messages[2].content as AnyEntry;
    expect(edit.content).toEqual([]);
    expect(edit.details.__status).toBeUndefined();
    expect(edit.details.screenshotUrl).toBe((editFileResult as AnyEntry).details.screenshotUrl);

    // The wire payload must be a fraction of the stored log (what remains is dominated by the
    // rendered screenshotUrl + capped diff — see the projection unit tests).
    expect(JSON.stringify(messages).length).toBeLessThan(JSON.stringify(fixtureLog).length * 0.3);
  });

  it('?view=full returns the verbatim stored log', async () => {
    const id = await seedConversation();
    const messages = await getMessages(id, '?view=full');
    expect(messages).toHaveLength(fixtureLog.length);
    messages.forEach((row, i) => {
      expect(JSON.parse(JSON.stringify(row.content))).toEqual(JSON.parse(JSON.stringify(fixtureLog[i])));
    });
    const root = messages[0].content as AnyEntry;
    expect(root.context.appState).toBeDefined();
    expect(root.context.resolvedContextDocs).toBeDefined();
  });

  it('?since=N returns only rows with seq > N (still projected)', async () => {
    const id = await seedConversation();
    const messages = await getMessages(id, '?since=1');
    expect(messages.map((m) => m.seq)).toEqual([2, 3, 4, 5, 6]);
    const edit = messages[0].content as AnyEntry; // seq 2 = editFileResult
    expect(edit.content).toEqual([]);
  });

  it('?since composes with ?view=full', async () => {
    const id = await seedConversation();
    const messages = await getMessages(id, '?since=4&view=full');
    expect(messages.map((m) => m.seq)).toEqual([5, 6]);
    expect(JSON.parse(JSON.stringify(messages[0].content))).toEqual(JSON.parse(JSON.stringify(fixtureLog[5])));
  });
});

describe('GET /api/conversations/:id/stream — catch-up projection', () => {
  setupTestDb(TEST_DB_PATH);

  it('replays committed messages slim by default', async () => {
    const id = await seedConversation();
    const res = await streamRoute(new NextRequest(`http://localhost/api/conversations/${id}/stream?since=-1`), idCtx(id));
    const events = await readEvents(res);
    const msgs = events.filter((e): e is Extract<ConversationStreamEvent, { type: 'message' }> => e.type === 'message');
    expect(msgs).toHaveLength(fixtureLog.length);
    const root = msgs[0].message as AnyEntry;
    expect(Object.keys(root.context).sort()).toEqual(['attachments', 'currentTime']);
    const edit = msgs[2].message as AnyEntry;
    expect(edit.content).toEqual([]);
  });

  it('replays verbatim with ?view=full', async () => {
    const id = await seedConversation();
    const res = await streamRoute(new NextRequest(`http://localhost/api/conversations/${id}/stream?since=-1&view=full`), idCtx(id));
    const events = await readEvents(res);
    const msgs = events.filter((e): e is Extract<ConversationStreamEvent, { type: 'message' }> => e.type === 'message');
    expect((msgs[0].message as AnyEntry).context.appState).toBeDefined();
    expect(JSON.parse(JSON.stringify(msgs[0].message))).toEqual(JSON.parse(JSON.stringify(rootInvocation)));
  });
});
