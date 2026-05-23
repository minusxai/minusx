// EvalAnalystAgent (v2) — submit-and-terminate behavior via the headless runner.

vi.mock('@/lib/connections/run-query', () => ({
  runQuery: vi.fn(async (_db: string, sql: string) => ({
    columns: ['n'], types: ['int'], rows: [{ n: 42 }], finalQuery: sql,
  })),
}));
vi.mock('@/lib/connections/load-schema', () => ({ loadConnectionSchema: vi.fn(async () => []) }));

import { fauxAssistantMessage, fauxToolCall } from '@/orchestrator/llm/testing';
import { fauxRegistration as evalFaux } from '@/agents/eval/eval-agent';
import { runEvalV2 } from '@/lib/chat/run-eval-v2.server';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

const USER: EffectiveUser = {
  userId: 1, email: 'e@example.com', name: 'E', role: 'admin', home_folder: '/org', mode: 'org',
};

beforeEach(() => evalFaux.setResponses([]));

describe('runEvalV2 / EvalAnalystAgent', () => {
  it('returns the SubmitBinary answer and terminates immediately after submit', async () => {
    evalFaux.setResponses([
      fauxAssistantMessage([fauxToolCall('SubmitBinary', { answer: true }, { id: 's1' })], { stopReason: 'toolUse' }),
      // Should NOT be consumed — the agent must stop after the submit tool runs.
      fauxAssistantMessage('this must not run', { stopReason: 'stop' }),
    ]);

    const sub = await runEvalV2({ goal: 'Is the sky blue?', assertionType: 'binary', user: USER });

    expect(sub?.toolName).toBe('SubmitBinary');
    expect(sub?.content.answer).toBe(true);
    // Termination proof: the second queued response was never pulled.
    expect(evalFaux.getPendingResponseCount()).toBe(1);
  });

  it('returns the SubmitNumber answer', async () => {
    evalFaux.setResponses([
      fauxAssistantMessage([fauxToolCall('SubmitNumber', { answer: 42 }, { id: 's1' })], { stopReason: 'toolUse' }),
    ]);
    const sub = await runEvalV2({ goal: 'What is 6 x 7?', assertionType: 'number_match', user: USER });
    expect(sub?.toolName).toBe('SubmitNumber');
    expect(sub?.content.answer).toBe(42);
  });

  it('CannotAnswer is reported as such', async () => {
    evalFaux.setResponses([
      fauxAssistantMessage([fauxToolCall('CannotAnswer', { reason: 'no data' }, { id: 's1' })], { stopReason: 'toolUse' }),
    ]);
    const sub = await runEvalV2({ goal: 'unknowable', assertionType: 'binary', user: USER });
    expect(sub?.toolName).toBe('CannotAnswer');
    expect(sub?.content.cannot_answer).toBe(true);
    expect(sub?.content.reason).toBe('no data');
  });

  it('runs a tool then submits (multi-step loop terminates on submit)', async () => {
    evalFaux.setResponses([
      fauxAssistantMessage([fauxToolCall('ExecuteQuery', { connectionId: 'db', query: 'SELECT count(*) AS n' }, { id: 'q1' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxToolCall('SubmitNumber', { answer: 42 }, { id: 's1' })], { stopReason: 'toolUse' }),
    ]);
    const sub = await runEvalV2({ goal: 'count rows', assertionType: 'number_match', connectionId: 'db', user: USER });
    expect(sub?.toolName).toBe('SubmitNumber');
    expect(sub?.content.answer).toBe(42);
    expect(evalFaux.getPendingResponseCount()).toBe(0);
  });

  it('returns null when the agent never submits (stops with text)', async () => {
    evalFaux.setResponses([fauxAssistantMessage('I am just chatting.', { stopReason: 'stop' })]);
    const sub = await runEvalV2({ goal: 'hi', assertionType: 'binary', user: USER });
    expect(sub).toBeNull();
  });
});
