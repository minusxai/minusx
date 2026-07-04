// Full v3 turn through the real in-process orchestrator + faux LLM: a user turn persists the pi log
// as `messages` rows, sets the title from the first message, flips run_status idle, and emits
// running -> message -> idle wakeups. Proves the turn runner end-to-end.
vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

import { runConversationTurn } from '@/lib/chat/conversation-turn.server';
import { createConversation, getConversation, loadMessages } from '@/lib/data/conversations.server';
import { subscribe } from '@/lib/chat/conversation-stream.server';
import { fauxRegistration as webAnalystFaux } from '@/agents/web-analyst/web-analyst';
import { fauxAssistantMessage } from '@/orchestrator/llm/testing';
import type { ChatRequest } from '@/lib/chat-orchestration';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { ConversationNotify } from '@/lib/data/conversations.types';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';

const TEST_DB_PATH = getTestDbPath('conversation_turn');
const ADMIN = { userId: 1, email: 'test@example.com', name: 'Test', role: 'admin', home_folder: '/org', mode: 'org' } as EffectiveUser;

const turnBody = (userMessage: string): ChatRequest =>
  ({ user_message: userMessage, agent: 'WebAnalystAgent', agent_args: {} } as unknown as ChatRequest);

describe('v3 turn runner', () => {
  setupTestDb(TEST_DB_PATH);

  it('runs a turn: persists the pi log as rows, titles from the first message, ends idle', async () => {
    webAnalystFaux.setResponses([fauxAssistantMessage('June 2024 had the max MRR.', { stopReason: 'stop' })]);

    const conv = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });
    const result = await runConversationTurn(conv.id, ADMIN, turnBody('which month has max mrr?'));

    expect(result.runStatus).toBe('idle');
    expect(result.error).toBeUndefined();
    expect(result.pendingToolCalls).toEqual([]);

    const rows = await loadMessages(conv.id);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0].kind).toBe('toolCall');          // root invocation
    expect(rows[0].parentPiId).toBeNull();
    expect(rows[0].seq).toBe(0);
    expect(rows[1].kind).toBe('assistant');
    expect(result.finalSeq).toBe(rows.length);

    const after = await getConversation(conv.id);
    expect(after?.runStatus).toBe('idle');
    expect(after?.title).toBe('which month has max mrr?'); // titled from first message
  });

  it('emits running -> message -> idle wakeups for the turn', async () => {
    webAnalystFaux.setResponses([fauxAssistantMessage('ok', { stopReason: 'stop' })]);
    const conv = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });

    const got: ConversationNotify[] = [];
    const unsub = await subscribe(conv.id, (n) => got.push(n));
    await runConversationTurn(conv.id, ADMIN, turnBody('hi'));
    // Notifies are fire-and-forget — let them drain.
    await new Promise((r) => setTimeout(r, 100));
    await unsub();

    const statuses = got.filter((n) => n.kind === 'status').map((n) => n.runStatus);
    expect(statuses[0]).toBe('running');
    expect(statuses.at(-1)).toBe('idle');
    expect(got.some((n) => n.kind === 'message')).toBe(true);
  });

  it('streams thinking deltas TAGGED as thinking — never merged into plain text deltas', async () => {
    // The "thoughts appear as actual reply text while streaming" bug: the turn runner concatenated
    // text_delta AND thinking_delta into one untyped buffer, so the client rendered reasoning as
    // the visible reply until the turn finalized. Thinking deltas must be tagged on the wire.
    webAnalystFaux.setResponses([
      fauxAssistantMessage(
        [
          { type: 'thinking', thinking: 'Let me reason about which month wins.' },
          { type: 'text', text: 'June is the answer.' },
        ] as never,
        { stopReason: 'stop' },
      ),
    ]);
    const conv = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });

    const got: ConversationNotify[] = [];
    const unsub = await subscribe(conv.id, (n) => got.push(n));
    await runConversationTurn(conv.id, ADMIN, turnBody('which month has max mrr?'));
    await new Promise((r) => setTimeout(r, 100));
    await unsub();

    const deltas = got.filter((n) => n.kind === 'delta');
    const thinkingText = deltas.filter((d) => d.thinking).map((d) => d.text ?? '').join('');
    const plainText = deltas.filter((d) => !d.thinking).map((d) => d.text ?? '').join('');
    expect(thinkingText).toContain('reason about');       // reasoning arrives, tagged
    expect(plainText).toContain('June is the answer');     // reply arrives, untagged
    expect(plainText).not.toContain('reason about');       // reasoning NEVER leaks into reply text
  });

  it('appends a second turn incrementally (seq continues)', async () => {
    webAnalystFaux.setResponses([fauxAssistantMessage('first', { stopReason: 'stop' })]);
    const conv = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });
    await runConversationTurn(conv.id, ADMIN, turnBody('q1'));
    const afterFirst = (await loadMessages(conv.id)).length;

    webAnalystFaux.setResponses([fauxAssistantMessage('second', { stopReason: 'stop' })]);
    const r2 = await runConversationTurn(conv.id, ADMIN, turnBody('q2'));

    const rows = await loadMessages(conv.id);
    expect(rows.length).toBeGreaterThan(afterFirst);
    expect(rows.map((m) => m.seq)).toEqual(rows.map((_, i) => i)); // contiguous 0..n
    expect(r2.runStatus).toBe('idle');
  });
});
