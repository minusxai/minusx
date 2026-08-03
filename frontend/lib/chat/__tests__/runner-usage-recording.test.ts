// Every production headless runner must record its LLM usage into the
// llm_call_events ledger (report/alert/context cron jobs previously burned
// tokens with no ledger row, no app event, and no credit gate).

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));
// Enforce a 100-credit daily cap so the credit gate is observable on the
// headless paths too. Users with no seeded usage remain under the limit.
vi.mock('@/lib/data/configs.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/data/configs.server')>();
  return {
    ...actual,
    getRawConfig: vi.fn(async () => ({
      credits: { enabled: true, limits: { company: { daily: 100, weekly: 1_000_000 } } },
    })),
  };
});
vi.mock('@/lib/connections/run-query', () => ({
  runQuery: vi.fn(async (_db: string, sql: string) => ({
    columns: ['n'], types: ['int'], rows: [{ n: 1 }], finalQuery: sql,
  })),
}));
vi.mock('@/lib/connections/load-schema', () => ({ loadConnectionSchema: vi.fn(async () => []) }));

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runReportV2 } from '@/lib/chat/run-report.server';
import { runEvalV2 } from '@/lib/chat/run-eval.server';
import type { ReportAgentContext } from '@/agents/report/report-agent';
import { fauxRegistration as analystFaux } from '@/agents/analyst/analyst-agent';
import { fauxRegistration as evalFaux } from '@/agents/eval/eval-agent';
import { fauxAssistantMessage, fauxToolCall } from '@/orchestrator/llm/testing';
import { getModules } from '@/lib/modules/registry';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

setupTestDb(getTestDbPath('runner_usage_recording'));

const user = (userId: number) =>
  ({ userId, email: 'runner@x.co', name: 'R', role: 'admin', home_folder: '/org', mode: 'org' } as EffectiveUser);

function reportContext(u: EffectiveUser): ReportAgentContext & { effectiveUser: EffectiveUser } {
  return {
    userId: String(u.userId),
    mode: 'org',
    effectiveUser: u,
    connectionId: 'db',
    reportId: 42,
    reportName: 'Usage Test Report',
    reportPrompt: 'Summarize revenue.',
    emails: [],
  } as unknown as ReportAgentContext & { effectiveUser: EffectiveUser };
}

async function ledgerRows(userId: number): Promise<Record<string, unknown>[]> {
  const { rows } = await getModules().db.exec<Record<string, unknown>>(
    `SELECT conversation_id, trigger, user_id, mode, total_tokens
     FROM llm_call_events WHERE user_id = $1`, [userId],
  );
  return rows;
}

beforeEach(() => {
  analystFaux.setResponses([]);
  evalFaux.setResponses([]);
});

describe('headless runner usage recording', () => {
  it('runReportV2 records its LLM calls into llm_call_events with trigger=report', async () => {
    analystFaux.setResponses([fauxAssistantMessage('Report body.', { stopReason: 'stop' })]);

    const result = await runReportV2(reportContext(user(21)));
    expect(result.generatedReport).toContain('Report body.');

    const rows = await ledgerRows(21);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(Number(r.conversation_id)).toBe(0);
      expect(r.trigger).toBe('report');
      expect(r.mode).toBe('org');
    }
  });

  it('runEvalV2 records its LLM calls into llm_call_events with trigger=eval', async () => {
    evalFaux.setResponses([
      fauxAssistantMessage([fauxToolCall('SubmitBinary', { answer: true }, { id: 's1' })], { stopReason: 'toolUse' }),
    ]);

    const sub = await runEvalV2({ goal: 'Is the sky blue?', assertionType: 'binary', user: user(22) });
    expect(sub?.toolName).toBe('SubmitBinary');

    const rows = await ledgerRows(22);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(Number(r.conversation_id)).toBe(0);
      expect(r.trigger).toBe('eval');
    }
  });

  it('runReportV2 is credit-gated: an over-limit user makes no LLM call', async () => {
    await getModules().db.exec(
      `INSERT INTO llm_call_events (conversation_id, model, cost, user_id, mode, created_at) VALUES (0, 'm', $1, $2, 'org', NOW())`,
      [1.2, 23], // 121 credits ≥ 100 cap
    );
    analystFaux.setResponses([fauxAssistantMessage('should NOT be used', { stopReason: 'stop' })]);

    await runReportV2(reportContext(user(23)));

    // Only the seeded row — the gate blocked the run before any LLM call.
    const rows = await ledgerRows(23);
    expect(rows).toHaveLength(1);
    expect(analystFaux.getPendingResponseCount()).toBe(1);
  });

  it('runEvalV2 is credit-gated: an over-limit user makes no LLM call', async () => {
    await getModules().db.exec(
      `INSERT INTO llm_call_events (conversation_id, model, cost, user_id, mode, created_at) VALUES (0, 'm', $1, $2, 'org', NOW())`,
      [1.2, 24],
    );
    evalFaux.setResponses([
      fauxAssistantMessage([fauxToolCall('SubmitBinary', { answer: true }, { id: 's2' })], { stopReason: 'toolUse' }),
    ]);

    const sub = await runEvalV2({ goal: 'blocked?', assertionType: 'binary', user: user(24) });
    expect(sub).toBeNull();

    const rows = await ledgerRows(24);
    expect(rows).toHaveLength(1);
    expect(evalFaux.getPendingResponseCount()).toBe(1);
  });
});
