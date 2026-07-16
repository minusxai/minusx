/**
 * Conversations V2 — chatListener finalize must reload the durable log INCREMENTALLY and in the
 * view matching dev mode (see /conversations-v2.md). Full stack: Redux dispatch → chatListener
 * (IS_TEST path) → real v3 route handlers → faux LLM → finalize reload → Redux messages.
 *
 * Wire contract under test:
 *  - non-dev (default): conversation GETs never request `view=full`
 *  - after the FIRST turn's full load, subsequent finalizes fetch `?since=<maxSeq>` (not the
 *    whole conversation again)
 *  - devMode on → conversation reloads request `view=full`
 *  - in all cases Redux ends up with the correct parsed transcript
 */
import { NextRequest } from 'next/server';
import { POST as turnsRoute } from '@/app/api/conversations/[id]/turns/route';
import { GET as getRoute } from '@/app/api/conversations/[id]/route';
import { createConversation as createConversationServer } from '@/lib/data/conversations.server';
import { fauxRegistration as webAnalystFaux } from '@/agents/web-analyst/web-analyst';
import { fauxAssistantMessage } from '@/orchestrator/llm/testing';
import * as storeModule from '@/store/store';
import { makeStore } from '@/store/store';
import { createConversation, sendMessage, selectConversation } from '@/store/chatSlice';
import { setDevMode } from '@/store/uiSlice';
import type { RootState } from '@/store/store';
import { getTestDbPath } from './test-utils';
import { setupTestDb } from '@/test/harness/test-db';

const TEST_DB_PATH = getTestDbPath('conversation_incremental_reload');
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;

describe('chatListener finalize — incremental + view-aware conversation reload', () => {
  setupTestDb(TEST_DB_PATH);

  let store: ReturnType<typeof makeStore>;
  let fetchLog: string[];

  beforeEach(() => {
    store = makeStore();
    vi.spyOn(storeModule, 'getStore').mockReturnValue(store);
    fetchLog = [];

    global.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const urlStr = String(url);
      const method = init?.method || 'GET';
      fetchLog.push(`${method} ${urlStr}`);
      const full = urlStr.startsWith('http') ? urlStr : `http://localhost:3000${urlStr}`;
      let m: RegExpMatchArray | null;
      if (method === 'POST' && (m = full.match(/\/api\/conversations\/(\d+)\/turns/))) {
        return await turnsRoute(new NextRequest(full, { method, body: init?.body as string, headers: init?.headers as HeadersInit }), idCtx(m[1]));
      }
      if (method === 'GET' && (m = full.match(/\/api\/conversations\/(\d+)(\?|$)/))) {
        return await getRoute(new NextRequest(full), idCtx(m[1]));
      }
      // Anything else (capture-error, telemetry) is irrelevant here.
      return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const conversationGets = (id: number) =>
    fetchLog.filter((u) => u.startsWith('GET') && new RegExp(`/api/conversations/${id}(\\?|$)`).test(u));

  async function waitForFinished(conversationID: number): Promise<void> {
    await vi.waitFor(() => {
      const conv = selectConversation(store.getState() as RootState, conversationID);
      expect(conv?.executionState).toBe('FINISHED');
    }, { timeout: 8000, interval: 20 });
  }

  async function runTurn(conversationID: number, message: string, reply: string, first = false): Promise<void> {
    webAnalystFaux.setResponses([fauxAssistantMessage(reply, { stopReason: 'stop' })]);
    if (first) {
      store.dispatch(createConversation({ conversationID, agent: 'WebAnalystAgent', agent_args: {}, message } as never));
    } else {
      store.dispatch(sendMessage({ conversationID, message }));
    }
    await waitForFinished(conversationID);
  }

  it('turn 2 reloads with ?since=<turn-1 maxSeq>; non-dev GETs never ask for view=full; transcript correct', async () => {
    const conv = await createConversationServer({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });

    await runTurn(conv.id, 'first question', 'first answer', true);
    const turn1Messages = selectConversation(store.getState() as RootState, conv.id)!.messages;
    const turn1LogLen = selectConversation(store.getState() as RootState, conv.id)!.log_index!;
    expect(turn1Messages.some((m) => m.role === 'user' && m.content === 'first question')).toBe(true);
    expect(turn1LogLen).toBeGreaterThanOrEqual(2);

    fetchLog = [];
    await runTurn(conv.id, 'second question', 'second answer');

    // Incremental: the finalize reload asked only for rows past turn 1's log.
    const gets = conversationGets(conv.id);
    expect(gets.length).toBeGreaterThan(0);
    expect(gets.some((u) => u.includes(`since=${turn1LogLen - 1}`))).toBe(true);

    // Never the heavy view without dev mode.
    expect(fetchLog.every((u) => !u.includes('view=full'))).toBe(true);

    // And the transcript is still complete + correct after the incremental merge.
    const messages = selectConversation(store.getState() as RootState, conv.id)!.messages;
    const userMessages = messages.filter((m) => m.role === 'user').map((m) => m.content);
    expect(userMessages).toEqual(['first question', 'second question']);
    const transcript = JSON.stringify(messages);
    expect(transcript).toContain('first answer');
    expect(transcript).toContain('second answer');
  });

  it('devMode on → conversation reloads request view=full', async () => {
    const conv = await createConversationServer({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });
    store.dispatch(setDevMode(true));

    await runTurn(conv.id, 'dev question', 'dev answer', true);

    const gets = conversationGets(conv.id);
    expect(gets.length).toBeGreaterThan(0);
    expect(gets.some((u) => u.includes('view=full'))).toBe(true);
  });
});
