// Deep credit enforcement: with ENFORCE_CREDIT_LIMITS on (config mocked) and a
// user over their reset allowance, a real conversation turn must be blocked at
// the orchestrator's universal LLM call site (`beforeLlmCall`) — erroring with
// the credit message and making NO LLM call — not at any entry-point check.
vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));
vi.mock('@/lib/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/config')>();
  return {
    ...actual,
    ENFORCE_CREDIT_LIMITS: true,
    resolveIndividualResetAllowance: () => 100,   // 100-credit daily cap
    resolveIndividualAllowance: () => 1_000_000,  // billing effectively unreachable
  };
});

import { runConversationTurn } from '@/lib/chat/conversation-turn.server';
import { runMicroTask } from '@/lib/chat/run-micro-task.server';
import { createConversation } from '@/lib/data/conversations.server';
import { fauxRegistration as webAnalystFaux } from '@/agents/web-analyst/web-analyst';
import { fauxRegistration as microFaux } from '@/agents/micro/micro-agent';
import { fauxAssistantMessage } from '@/orchestrator/llm/testing';
import { getModules } from '@/lib/modules/registry';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { ChatRequest } from '@/lib/chat/chat-types';

setupTestDb(getTestDbPath('credit_enforcement'));

const user = (userId: number) => ({ userId, email: 't@x.co', name: 'T', role: 'viewer', home_folder: '/org', mode: 'org' } as EffectiveUser);
const turnBody = (m: string): ChatRequest => ({ user_message: m, agent: 'WebAnalystAgent', agent_args: {} } as unknown as ChatRequest);

async function seedUsage(userId: number, cost: number): Promise<void> {
  // conversation_id 0 = not tied to the turn's conversation (so the "no LLM call
  // for this turn" assertion is unambiguous).
  await getModules().db.exec(
    `INSERT INTO llm_call_events (conversation_id, model, cost, user_id, mode, created_at) VALUES (0, 'm', $1, $2, 'org', NOW())`,
    [cost, userId],
  );
}

describe('credit enforcement (deep beforeLlmCall hook)', () => {
  it('blocks the turn at the LLM call when the user is over limit', async () => {
    await seedUsage(1, 1.2); // 1.2*100 + 1 req = 121 credits ≥ 100 cap
    webAnalystFaux.setResponses([fauxAssistantMessage('should NOT be used', { stopReason: 'stop' })]);

    const conv = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });
    const result = await runConversationTurn(conv.id, user(1), turnBody('hi'));

    expect(result.runStatus).toBe('error');
    expect(result.error ?? '').toMatch(/credit limit/i);

    // Blocked BEFORE dispatch → no LLM call recorded for this conversation.
    const { rows } = await getModules().db.exec<{ c: number }>(
      `SELECT COUNT(*) AS c FROM llm_call_events WHERE conversation_id = $1`, [conv.id]);
    expect(Number(rows[0].c)).toBe(0);
  });

  it('allows the turn when under limit', async () => {
    webAnalystFaux.setResponses([fauxAssistantMessage('ok reply', { stopReason: 'stop' })]);
    const conv = await createConversation({ ownerUserId: 2, mode: 'org', agent: 'WebAnalystAgent' });
    const result = await runConversationTurn(conv.id, user(2), turnBody('hi'));
    expect(result.runStatus).toBe('idle');
    expect(result.error).toBeUndefined();
  });

  it('also blocks MICRO-TASKS for an over-limit user (no exempt path)', async () => {
    await seedUsage(3, 1.2); // 1.2*100 + 1 req = 121 ≥ 100 cap → the ONLY row for user 3
    microFaux.setResponses([fauxAssistantMessage('should NOT be used', { stopReason: 'stop' })]);
    // The gate throws before the LLM call, so the micro-task produces no result and rejects.
    await expect(
      runMicroTask('title', { input: 'x', subject: 'a question', instructions: '' }, user(3)),
    ).rejects.toThrow();
    // Proof it was blocked at the gate (not a late failure): no LLM call was recorded.
    const { rows } = await getModules().db.exec<{ c: number }>(
      `SELECT COUNT(*) AS c FROM llm_call_events WHERE user_id = $1`, [3]);
    expect(Number(rows[0].c)).toBe(1); // still just the seeded row
  });

  it('runs micro-tasks normally for an under-limit user', async () => {
    microFaux.setResponses([fauxAssistantMessage('A short title', { stopReason: 'stop' })]);
    const out = await runMicroTask('title', { input: 'x', subject: 'a question', instructions: '' }, user(4));
    expect(out).toBe('A short title');
  });
});
