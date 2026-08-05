/**
 * The conversation-size refusal, end to end through the real wire:
 * Redux dispatch → chatListener (IS_TEST path) → real v3 route handlers → the turn-start gate →
 * durable error row (typed `details.code`) → finalize reload → Redux.
 *
 * This is the link the unit tests can't reach. The gate's own test asserts the error ROW; the
 * banner test mounts the component with a reason already in hand. Between them sits the part that
 * actually carries intent across the network: the listener reads `details.code` off the reloaded
 * error and turns it into `errorReason`. Nothing about that is visible to either neighbour, and
 * getting it wrong degrades silently — the banner just falls back to hedged copy.
 */
import { NextRequest } from 'next/server';
import { POST as turnsRoute } from '@/app/api/conversations/[id]/turns/route';
import { GET as getRoute } from '@/app/api/conversations/[id]/route';
import { POST as logErrorRoute } from '@/app/api/chat/log-error/route';
import {
  createConversation as createConversationServer, setLastContextTokens, loadErrors,
} from '@/lib/data/conversations.server';
import { fauxRegistration as webAnalystFaux } from '@/agents/web-analyst/web-analyst';
import { fauxAssistantMessage } from '@/orchestrator/llm/testing';
import * as storeModule from '@/store/store';
import { makeStore } from '@/store/store';
import { createConversation, sendMessage, selectConversation } from '@/store/chatSlice';
import { TOKEN_LIMIT, CONVERSATION_TOO_LONG } from '@/lib/chat/conversation-limits';
import type { RootState } from '@/store/store';
import { getTestDbPath } from './test-utils';
import { setupTestDb } from '@/test/harness/test-db';

const TEST_DB_PATH = getTestDbPath('conversation_too_long_wire');
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;

describe('conversation too long — refusal reaches Redux with its typed reason', () => {
  setupTestDb(TEST_DB_PATH);

  let store: ReturnType<typeof makeStore>;

  beforeEach(() => {
    store = makeStore();
    vi.spyOn(storeModule, 'getStore').mockReturnValue(store);

    global.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const urlStr = String(url);
      const method = init?.method || 'GET';
      const full = urlStr.startsWith('http') ? urlStr : `http://localhost:3000${urlStr}`;
      let m: RegExpMatchArray | null;
      if (method === 'POST' && (m = full.match(/\/api\/conversations\/(\d+)\/turns/))) {
        return await turnsRoute(new NextRequest(full, { method, body: init?.body as string, headers: init?.headers as HeadersInit }), idCtx(m[1]!));
      }
      if (method === 'GET' && (m = full.match(/\/api\/conversations\/(\d+)(\?|$)/))) {
        return await getRoute(new NextRequest(full), idCtx(m[1]!));
      }
      // The REAL error-echo route, so a client-side echo actually lands as a durable row and the
      // duplicate is observable here. Stubbing it would hide exactly what this test checks.
      if (method === 'POST' && full.includes('/api/chat/log-error')) {
        return await logErrorRoute(new NextRequest(full, { method, body: init?.body as string, headers: init?.headers as HeadersInit }));
      }
      return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function waitForFinished(conversationID: number): Promise<void> {
    await vi.waitFor(() => {
      const conv = selectConversation(store.getState() as RootState, conversationID);
      expect(conv?.executionState).toBe('FINISHED');
    }, { timeout: 8000, interval: 20 });
  }

  it('carries the typed reason from the error row into the conversation state', async () => {
    const conv = await createConversationServer({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });

    // Two real turns, so there is history to shed and the gate is allowed to bite.
    webAnalystFaux.setResponses([fauxAssistantMessage('first answer', { stopReason: 'stop' })]);
    store.dispatch(createConversation({ conversationID: conv.id, agent: 'WebAnalystAgent', agent_args: {}, message: 'first question' } as never));
    await waitForFinished(conv.id);

    webAnalystFaux.setResponses([fauxAssistantMessage('second answer', { stopReason: 'stop' })]);
    store.dispatch(sendMessage({ conversationID: conv.id, message: 'second question' }));
    await waitForFinished(conv.id);

    // Now the conversation is over the limit. Queue no faux response: reaching the LLM at all
    // would fail loudly rather than quietly passing this test.
    await setLastContextTokens(conv.id, TOKEN_LIMIT + 50_000);
    webAnalystFaux.setResponses([]);

    store.dispatch(sendMessage({ conversationID: conv.id, message: 'one question too many' }));

    await vi.waitFor(() => {
      const c = selectConversation(store.getState() as RootState, conv.id);
      expect(c?.error).toBeTruthy();
    }, { timeout: 8000, interval: 20 });

    const c = selectConversation(store.getState() as RootState, conv.id)!;
    // Terminal, so the UI offers a new chat rather than a "Try again" that would re-fail...
    expect(c.errorRetryability).toBe('terminal');
    // ...and the reason came from the typed code, not from matching our own prose.
    expect(c.errorReason).toBe('conversation_too_long');
  });

  it('does not echo the refusal back as a second, untyped error row', async () => {
    // The echo exists to make CLIENT-side failures durable. An error that arrived FROM the durable
    // log is already durable, so echoing it writes a near-duplicate row — one that is
    // `source: 'transport'` with no `details`, and lands LAST. Anything reading "the most recent
    // error" then sees the untyped copy and loses the reason.
    const conv = await createConversationServer({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });

    webAnalystFaux.setResponses([fauxAssistantMessage('first answer', { stopReason: 'stop' })]);
    store.dispatch(createConversation({ conversationID: conv.id, agent: 'WebAnalystAgent', agent_args: {}, message: 'first question' } as never));
    await waitForFinished(conv.id);

    webAnalystFaux.setResponses([fauxAssistantMessage('second answer', { stopReason: 'stop' })]);
    store.dispatch(sendMessage({ conversationID: conv.id, message: 'second question' }));
    await waitForFinished(conv.id);

    await setLastContextTokens(conv.id, TOKEN_LIMIT + 50_000);
    webAnalystFaux.setResponses([]);
    store.dispatch(sendMessage({ conversationID: conv.id, message: 'one question too many' }));

    await vi.waitFor(() => {
      expect(selectConversation(store.getState() as RootState, conv.id)?.error).toBeTruthy();
    }, { timeout: 8000, interval: 20 });

    // Give any (unwanted) fire-and-forget echo time to land before asserting its absence.
    await vi.waitFor(async () => {
      expect((await loadErrors(conv.id)).length).toBeGreaterThan(0);
    }, { timeout: 4000, interval: 20 });
    await new Promise((r) => setTimeout(r, 300));

    const errors = await loadErrors(conv.id);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.source).toBe('session');
    expect((errors[0]!.details as { code?: string } | null)?.code).toBe(CONVERSATION_TOO_LONG);
  });
});
