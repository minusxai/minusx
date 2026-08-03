// createTrackedOrchestrator — the single sanctioned Orchestrator construction path.
// Verifies the three pre-wired obligations against a real test DB:
//   1. credit gate (beforeLlmCall throws CreditLimitError for an over-limit user)
//   2. model-plan resolver installed
//   3. recordUsage writes llm_call_events (+ llm_logs response) for both
//      tracking modes: headless {task} and conversation-bound {conversationId}.

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));
// Enforce a 100-credit daily cap so the gate is observable (same seeding pattern
// as credit-enforcement.e2e.test.ts). Under-limit users still pass.
vi.mock('@/lib/data/configs.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/data/configs.server')>();
  return {
    ...actual,
    getRawConfig: vi.fn(async () => ({
      credits: { enabled: true, limits: { company: { daily: 100, weekly: 1_000_000 } } },
    })),
  };
});

import { describe, it, expect, vi } from 'vitest';
import { createTrackedOrchestrator } from '@/lib/chat/tracked-orchestrator.server';
import { CreditLimitError } from '@/lib/analytics/credit-usage.server';
import { MicroAgent } from '@/agents/micro/micro-agent';
import { getModules } from '@/lib/modules/registry';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { ConversationLogEntry } from '@/orchestrator/types';

setupTestDb(getTestDbPath('tracked_orchestrator'));

const user = (userId: number) =>
  ({ userId, email: 'tracked@x.co', name: 'T', role: 'viewer', home_folder: '/org', mode: 'org' } as EffectiveUser);

// Minimal assistant message carrying the engine-stamped fields buildLlmCallDetail reads.
function stampedAssistantMessage(callId: string) {
  return {
    role: 'assistant',
    provider: 'openai',
    model: 'gpt-4o-mini',
    stopReason: 'stop',
    content: [{ type: 'text', text: 'hi' }],
    usage: { totalTokens: 150, input: 100, output: 50, cacheRead: 10, cacheWrite: 0, cost: { total: 0.002 } },
    _lllmCallId: callId,
    _duration: 1.2,
    _grade: 'lite',
    _agent: 'micro',
  } as unknown as ConversationLogEntry;
}

describe('createTrackedOrchestrator', () => {
  it('installs the credit gate: over-limit user is blocked at beforeLlmCall', async () => {
    await getModules().db.exec(
      `INSERT INTO llm_call_events (conversation_id, model, cost, user_id, mode, created_at) VALUES (0, 'm', $1, $2, 'org', NOW())`,
      [1.2, 9], // 1.2*100 + 1 req = 121 credits ≥ 100 cap
    );
    const { orch } = createTrackedOrchestrator({
      registrables: [MicroAgent],
      user: user(9),
      tracking: { task: 'micro:test' },
    });
    expect(orch.beforeLlmCall).toBeTypeOf('function');
    await expect(orch.beforeLlmCall!()).rejects.toThrow(CreditLimitError);
  });

  it('passes an under-limit user through the gate and installs a plan resolver', async () => {
    const { orch } = createTrackedOrchestrator({
      registrables: [MicroAgent],
      user: user(10),
      tracking: { task: 'micro:test' },
    });
    await expect(orch.beforeLlmCall!()).resolves.toBeUndefined();
    expect(orch.resolveLlmPlan).toBeTypeOf('function');
  });

  it('recordUsage in {task} mode writes the 0-sentinel ledger row with the task as trigger', async () => {
    const { recordUsage } = createTrackedOrchestrator({
      registrables: [MicroAgent],
      user: user(11),
      tracking: { task: 'report' },
    });
    await recordUsage([stampedAssistantMessage('call_tracked_task_1')]);

    const { rows } = await getModules().db.exec<Record<string, unknown>>(
      `SELECT conversation_id, trigger, model, prompt_tokens, user_id, mode
       FROM llm_call_events WHERE llm_call_id = 'call_tracked_task_1'`,
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].conversation_id)).toBe(0);
    expect(rows[0].trigger).toBe('report');
    expect(rows[0].model).toBe('gpt-4o-mini');
    expect(Number(rows[0].prompt_tokens)).toBe(100);
    expect(Number(rows[0].user_id)).toBe(11);
    expect(rows[0].mode).toBe('org');
  });

  it('recordUsage in {conversationId} mode writes the conversation row with source as trigger, plus the llm_logs response', async () => {
    const { recordUsage } = createTrackedOrchestrator({
      registrables: [MicroAgent],
      user: user(12),
      tracking: { conversationId: 4242, source: 'explore' },
    });
    await recordUsage([stampedAssistantMessage('call_tracked_conv_1')]);

    const { rows } = await getModules().db.exec<Record<string, unknown>>(
      `SELECT conversation_id, trigger FROM llm_call_events WHERE llm_call_id = 'call_tracked_conv_1'`,
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].conversation_id)).toBe(4242);
    expect(rows[0].trigger).toBe('explore');

    const { rows: logRows } = await getModules().db.exec<Record<string, unknown>>(
      `SELECT response_json FROM llm_logs WHERE call_id = 'call_tracked_conv_1'`,
    );
    expect(logRows).toHaveLength(1);
    expect(String(logRows[0].response_json)).toContain('gpt-4o-mini');
  });

  it('recordUsage finds a sub-agent final reply folded into an mx_agent toolResult (and does not double-count)', async () => {
    // A dispatched sub-agent's FINAL message never appears as a top-level log
    // entry — appendAgentResult folds it into the dispatch toolResult as
    // details.assistantMessage. The recorder must look inside, and must not
    // double-record a call that also exists top-level.
    const folded = stampedAssistantMessage('call_tracked_nested_1');
    const topLevel = stampedAssistantMessage('call_tracked_top_1');
    const log = [
      topLevel,
      {
        role: 'toolResult',
        toolCallId: 'agent-slot-1',
        toolName: 'AnalystAgent',
        content: [{ type: 'text', text: 'sub-agent answer' }],
        isError: false,
        details: { type: 'mx_agent', assistantMessage: folded },
        timestamp: 1,
      } as unknown as ConversationLogEntry,
      // The same top-level call again (e.g. echoed) must not double-insert.
      topLevel,
    ];
    const { recordUsage } = createTrackedOrchestrator({
      registrables: [MicroAgent],
      user: user(14),
      tracking: { task: 'report' },
    });
    await recordUsage(log);

    const { rows } = await getModules().db.exec<Record<string, unknown>>(
      `SELECT llm_call_id FROM llm_call_events WHERE user_id = 14 ORDER BY llm_call_id`,
    );
    expect(rows.map((r) => r.llm_call_id)).toEqual(['call_tracked_nested_1', 'call_tracked_top_1']);
  });

  it('recordUsage with no explicit entries reads the orchestrator log (empty run → no rows, no throw)', async () => {
    const { recordUsage } = createTrackedOrchestrator({
      registrables: [MicroAgent],
      user: user(13),
      tracking: { task: 'micro:empty' },
    });
    await expect(recordUsage()).resolves.toBeUndefined();
    const { rows } = await getModules().db.exec<{ c: number }>(
      `SELECT COUNT(*) AS c FROM llm_call_events WHERE user_id = 13`,
    );
    expect(Number(rows[0].c)).toBe(0);
  });
});
