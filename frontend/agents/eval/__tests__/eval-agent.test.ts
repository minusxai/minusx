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

  it('renders resolvedContextDocs in the system prompt and advertises LoadContext (production parity)', async () => {
    let prompt = '';
    evalFaux.setResponses([
      (context) => {
        prompt = (context as { systemPrompt?: string }).systemPrompt ?? '';
        return fauxAssistantMessage([fauxToolCall('SubmitBinary', { answer: true }, { id: 's1' })], { stopReason: 'toolUse' });
      },
    ]);
    await runEvalV2({
      goal: 'q', assertionType: 'binary', user: USER,
      resolvedContextDocs: {
        // At/above INLINE_ALL_DOCS_THRESHOLD docs, lazy bodies move to the on-demand
        // catalog — pad past the threshold so the lazy doc is actually withheld.
        docs: [
          { key: '', title: 'Pinned', content: 'PINNED EVAL BODY', alwaysInclude: true },
          { key: 'revenue', title: 'Revenue', description: 'how revenue maps', content: 'REVENUE LAZY BODY', alwaysInclude: false },
          { key: 'costs', title: 'Costs', description: 'cost mapping', content: 'COSTS LAZY BODY', alwaysInclude: false },
          { key: 'users', title: 'Users', description: 'user mapping', content: 'USERS LAZY BODY', alwaysInclude: false },
          { key: 'orders', title: 'Orders', description: 'order mapping', content: 'ORDERS LAZY BODY', alwaysInclude: false },
        ],
      },
    });
    expect(prompt).toContain('PINNED EVAL BODY'); // alwaysInclude doc inline
    expect(prompt).toContain('revenue');          // lazy doc advertised by key
    expect(prompt).not.toContain('REVENUE LAZY BODY'); // ...body withheld until LoadContext
    expect(prompt).toContain('LoadContext');      // tool available for on-demand load
  });

  it('can call LoadContext mid-eval (the tool is registered) then submit', async () => {
    let loadResult: string | undefined;
    evalFaux.setResponses([
      fauxAssistantMessage([fauxToolCall('LoadContext', { keys: ['revenue'] }, { id: 'lc1' })], { stopReason: 'toolUse' }),
      (context) => {
        const msgs = (context as { messages?: Array<{ role: string; content: Array<{ type: string; text?: string }> }> }).messages ?? [];
        loadResult = msgs.flatMap((m) => m.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n');
        return fauxAssistantMessage([fauxToolCall('SubmitBinary', { answer: true }, { id: 's1' })], { stopReason: 'toolUse' });
      },
    ]);
    const sub = await runEvalV2({
      goal: 'q', assertionType: 'binary', user: USER,
      resolvedContextDocs: { docs: [{ key: 'revenue', title: 'Revenue', description: 'd', content: 'REVENUE LAZY BODY', alwaysInclude: false }] },
    });
    expect(sub?.toolName).toBe('SubmitBinary');
    // The LoadContext tool resolved the lazy doc body into the conversation.
    expect(loadResult).toContain('REVENUE LAZY BODY');
  });
});
