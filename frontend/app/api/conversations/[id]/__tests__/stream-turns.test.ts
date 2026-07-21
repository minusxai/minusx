// End-to-end through the v3 chat routes: POST a turn (detached runner → rows + NOTIFY), then the
// resumable GET stream replays the committed log + status + done. Plus the interrupt route. Faux LLM.

import { NextRequest } from 'next/server';
import { POST as turnsRoute } from '@/app/api/conversations/[id]/turns/route';
import { GET as streamRoute } from '@/app/api/conversations/[id]/stream/route';
import { POST as interruptRoute } from '@/app/api/conversations/[id]/interrupt/route';
import { createConversation, getConversation, getMaxSeq } from '@/lib/data/conversations.server';
import { fauxRegistration as webAnalystFaux } from '@/agents/web-analyst/web-analyst';
import { fauxAssistantMessage } from '@/orchestrator/llm/testing';
import type { ConversationStreamEvent } from '@/lib/data/conversations.types';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';

const TEST_DB_PATH = getTestDbPath('stream_turns');
const idCtx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) }) as never;

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

// The turn runs detached, so the conversation starts 'idle' before the runner flips it 'running'.
// Wait until rows have been committed AND the run settled, so we don't read before the turn started.
async function waitForIdle(conversationId: number, ms = 4000): Promise<void> {
  const start = Date.now();
  for (;;) {
    const c = await getConversation(conversationId);
    const maxSeq = await getMaxSeq(conversationId);
    if (c && c.runStatus !== 'running' && maxSeq >= 0) return;
    if (Date.now() - start > ms) throw new Error(`turn did not settle (status=${c?.runStatus}, maxSeq=${maxSeq})`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('v3 chat routes (turns + stream)', () => {
  setupTestDb(TEST_DB_PATH);

  it('POST turn → GET stream replays the committed log + status idle + done', async () => {
    webAnalystFaux.setResponses([fauxAssistantMessage('June 2024.', { stopReason: 'stop' })]);
    const conv = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });

    const turnRes = await turnsRoute(
      new NextRequest(`http://localhost/api/conversations/${conv.id}/turns`, {
        method: 'POST', body: JSON.stringify({ userMessage: 'which month has max mrr?' }),
      }),
      idCtx(conv.id),
    );
    expect(turnRes.status).toBe(200);
    await waitForIdle(conv.id);

    const streamRes = await streamRoute(
      new NextRequest(`http://localhost/api/conversations/${conv.id}/stream?since=-1`),
      idCtx(conv.id),
    );
    expect(streamRes.headers.get('Content-Type')).toBe('text/event-stream');
    const events = await readEvents(streamRes);

    const messages = events.filter((e) => e.type === 'message');
    expect(messages.length).toBeGreaterThanOrEqual(2);     // root invocation + assistant
    expect((messages[0] as Extract<ConversationStreamEvent, { type: 'message' }>).seq).toBe(0);
    expect(events.some((e) => e.type === 'status' && e.runStatus === 'idle')).toBe(true);
    expect(events.at(-1)?.type).toBe('done');
  });

  it('GET stream with since=<n> only replays rows past the cursor', async () => {
    webAnalystFaux.setResponses([fauxAssistantMessage('ok', { stopReason: 'stop' })]);
    const conv = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });
    await turnsRoute(new NextRequest(`http://localhost/api/conversations/${conv.id}/turns`, {
      method: 'POST', body: JSON.stringify({ userMessage: 'hi' }),
    }), idCtx(conv.id));
    await waitForIdle(conv.id);

    const streamRes = await streamRoute(
      new NextRequest(`http://localhost/api/conversations/${conv.id}/stream?since=0`),
      idCtx(conv.id),
    );
    const events = await readEvents(streamRes);
    const msgSeqs = events.filter((e) => e.type === 'message').map((e) => (e as { seq: number }).seq);
    expect(msgSeqs.every((s) => s > 0)).toBe(true); // seq 0 (already had it) is not re-sent
  });

  it('a completed turn stamps meta.lastContextTokens with the last LLM call context size', async () => {
    webAnalystFaux.setResponses([fauxAssistantMessage('stamped.', { stopReason: 'stop' })]);
    const conv = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });
    await turnsRoute(new NextRequest(`http://localhost/api/conversations/${conv.id}/turns`, {
      method: 'POST', body: JSON.stringify({ userMessage: 'stamp me' }),
    }), idCtx(conv.id));
    await waitForIdle(conv.id);

    const after = await getConversation(conv.id);
    // The faux provider derives usage from the prompt text, so the exact value varies —
    // the contract is: present, numeric, and positive (it's the whole-context token count).
    expect(typeof after?.meta?.lastContextTokens).toBe('number');
    expect(after?.meta?.lastContextTokens as number).toBeGreaterThan(0);
  });

  it('interrupt route authorizes and returns ok', async () => {
    const conv = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });
    const res = await interruptRoute(
      new NextRequest(`http://localhost/api/conversations/${conv.id}/interrupt`, { method: 'POST' }),
      idCtx(conv.id),
    );
    expect(res.status).toBe(200);

    const other = await createConversation({ ownerUserId: 999, mode: 'org', agent: 'WebAnalystAgent' });
    const forbidden = await interruptRoute(
      new NextRequest(`http://localhost/api/conversations/${other.id}/interrupt`, { method: 'POST' }),
      idCtx(other.id),
    );
    expect(forbidden.status).toBe(403);
  });
});
