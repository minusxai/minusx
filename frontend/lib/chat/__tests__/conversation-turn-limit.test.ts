// The conversation-size gate, enforced where every surface passes through: `runConversationTurn`
// is the one runner behind the browser, Slack and scheduled jobs, so gating here covers all three.
// The refusal costs nothing — it happens before the orchestrator is built, so no LLM call is made.
//
// The two carve-outs are the load-bearing part. A RESUME must never be refused (a paused frontend
// tool call would be stranded and the conversation wedged), and a conversation with only one user
// turn must never be refused (starting fresh re-runs the same query and lands at the same size).

import { runConversationTurn } from '@/lib/chat/conversation-turn.server';
import {
  createConversation, getConversation, loadLog, loadErrors, setLastContextTokens,
} from '@/lib/data/conversations.server';
import { TOKEN_LIMIT, CONVERSATION_TOO_LONG } from '@/lib/chat/conversation-limits';
import { fauxRegistration as webAnalystFaux } from '@/agents/web-analyst/web-analyst';
import { fauxAssistantMessage } from '@/orchestrator/llm/testing';
import type { ChatRequest } from '@/lib/chat/chat-types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';

const TEST_DB_PATH = getTestDbPath('conversation_turn_limit');
const ADMIN = { userId: 1, email: 'test@example.com', name: 'Test', role: 'admin', home_folder: '/org', mode: 'org' } as EffectiveUser;
const turnBody = (m: string): ChatRequest => ({ user_message: m, agent: 'WebAnalystAgent', agent_args: {} } as unknown as ChatRequest);

/** A conversation with `turns` completed user turns, stamped at `tokens` of context. */
async function conversationWith(turns: number, tokens: number) {
  const conv = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });
  for (let i = 0; i < turns; i++) {
    webAnalystFaux.setResponses([fauxAssistantMessage(`reply ${i}`, { stopReason: 'stop' })]);
    await runConversationTurn(conv.id, ADMIN, turnBody(`question ${i}`));
  }
  // Stamp AFTER the turns: each completed turn writes its own (small, faux-derived) size.
  await setLastContextTokens(conv.id, tokens);
  return conv;
}

/** The error rows this gate writes, identified by the typed code rather than by message text. */
async function refusals(conversationId: number) {
  const errors = await loadErrors(conversationId);
  return errors.filter((e) => (e.details as { code?: string } | null)?.code === CONVERSATION_TOO_LONG);
}

describe('conversation token limit — turn-start gate', () => {
  setupTestDb(TEST_DB_PATH);

  it('refuses a new turn on an over-limit conversation, without calling the LLM', async () => {
    const conv = await conversationWith(2, TOKEN_LIMIT + 1);
    const logBefore = (await loadLog(conv.id)).length;

    // Queue NOTHING: the faux provider throws "No more faux responses queued" if it is reached,
    // so a turn that spends a token cannot pass this test silently.
    webAnalystFaux.setResponses([]);
    const result = await runConversationTurn(conv.id, ADMIN, turnBody('one more question'));

    expect(result.runStatus).toBe('error');
    const found = await refusals(conv.id);
    expect(found).toHaveLength(1);
    expect(found[0]!.details).toMatchObject({ code: CONVERSATION_TOO_LONG, limit: TOKEN_LIMIT });
    // Nothing was appended — the user message never entered the log.
    expect((await loadLog(conv.id)).length).toBe(logBefore);
    // The lease is released, not left claimed by a turn that never ran.
    expect((await getConversation(conv.id))?.runStatus).toBe('error');
  });

  it('allows a new turn while under the limit', async () => {
    const conv = await conversationWith(2, TOKEN_LIMIT - 1);
    webAnalystFaux.setResponses([fauxAssistantMessage('sure', { stopReason: 'stop' })]);

    const result = await runConversationTurn(conv.id, ADMIN, turnBody('still fine'));

    expect(result.runStatus).toBe('idle');
    expect(await refusals(conv.id)).toHaveLength(0);
  });

  it('allows the second turn of a huge single-query conversation — a fresh chat would not help', async () => {
    const conv = await conversationWith(1, TOKEN_LIMIT * 2);
    webAnalystFaux.setResponses([fauxAssistantMessage('following up', { stopReason: 'stop' })]);

    const result = await runConversationTurn(conv.id, ADMIN, turnBody('follow-up'));

    expect(result.runStatus).toBe('idle');
    expect(await refusals(conv.id)).toHaveLength(0);
  });

  it('never refuses a RESUME — a stranded frontend tool call would wedge the conversation', async () => {
    const conv = await conversationWith(2, TOKEN_LIMIT * 2);
    webAnalystFaux.setResponses([fauxAssistantMessage('resumed', { stopReason: 'stop' })]);

    // A resume carries completed tool results and no user message. This one has nothing to resume,
    // so it may well fail for its own reasons — the contract under test is only that the SIZE gate
    // did not fire.
    await runConversationTurn(conv.id, ADMIN, {
      completed_tool_calls: [], agent: 'WebAnalystAgent', agent_args: {},
    } as unknown as ChatRequest);

    expect(await refusals(conv.id)).toHaveLength(0);
  });
});
