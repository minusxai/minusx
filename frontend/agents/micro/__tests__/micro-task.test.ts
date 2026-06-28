// MicroAgent (v2) — generic single-turn task via the headless runner.

vi.mock('@/lib/connections/run-query', () => ({ runQuery: vi.fn(async () => ({ columns: [], types: [], rows: [], finalQuery: '' })) }));
vi.mock('@/lib/connections/load-schema', () => ({ loadConnectionSchema: vi.fn(async () => []) }));
// Keep the direct analytics writes (DuckDB) out of the unit test; tracking is
// asserted at the event boundary below.
vi.mock('@/lib/analytics/file-analytics.db', () => ({
  recordLlmRequest: vi.fn(async () => {}),
  recordLlmResponse: vi.fn(async () => {}),
  recordLlmCallEvent: vi.fn(async () => {}),
}));

import { fauxAssistantMessage } from '@/orchestrator/llm/testing';
import { fauxRegistration as microFaux } from '@/agents/micro/micro-agent';
import { runMicroTask } from '@/lib/chat/run-micro-task.server';
import { appEventRegistry, AppEvents } from '@/lib/app-event-registry';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { Context } from '@/orchestrator/llm';

const USER: EffectiveUser = {
  userId: 1, email: 'u@example.com', name: 'U', role: 'admin', home_folder: '/org', mode: 'org',
};

function userText(context: Context): string {
  const m = context.messages.find((x) => x.role === 'user');
  const c = m?.content as unknown;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
  return '';
}

beforeEach(() => microFaux.setResponses([]));
afterEach(() => vi.restoreAllMocks());

describe('runMicroTask', () => {
  it('renders the named task prompt and returns the model text in one no-tool call', async () => {
    microFaux.setResponses([
      (context: Context) => {
        // The caller's {input} is substituted into the micro.title.user template.
        expect(userText(context)).toContain('Quarterly revenue by region, trending up 12%');
        // No tools advertised to the model.
        expect(context.tools ?? []).toEqual([]);
        return fauxAssistantMessage('Regional Revenue Climbs 12%', { stopReason: 'stop' });
      },
    ]);

    const out = await runMicroTask('title', { input: 'Quarterly revenue by region, trending up 12%', subject: 'a dashboard', instructions: '' }, USER);
    expect(out).toBe('Regional Revenue Climbs 12%');
  });

  it('publishes an LLM_CALL event tagged by task and without a conversationId', async () => {
    const publish = vi.spyOn(appEventRegistry, 'publish').mockImplementation(() => {});
    microFaux.setResponses([() => fauxAssistantMessage('A short title', { stopReason: 'stop' })]);

    await runMicroTask('title', { input: 'some content', subject: 'a question', instructions: '' }, USER);

    const call = publish.mock.calls.find(([evt]) => evt === AppEvents.LLM_CALL);
    expect(call).toBeDefined();
    const payload = call![1] as { task?: string; conversationId?: number; llmCalls: Record<string, { model?: string }> };
    expect(payload.task).toBe('title');
    expect(payload.conversationId).toBeUndefined();
    const details = Object.values(payload.llmCalls);
    expect(details.length).toBeGreaterThanOrEqual(1);
    expect(details[0].model).toBeTruthy();
  });

  it('throws on an unknown task key', async () => {
    await expect(runMicroTask('does-not-exist', { input: 'x' }, USER)).rejects.toThrow(/Unknown micro-task/);
  });

  // feed_summary is a registered micro task (its prompts use {agent_name,
  // current_date, app_state} rather than the generic {input}). The /api/micro-task
  // route runs it with a client-serialized `app_state`.
  it('runs the feed_summary task and tags tracking accordingly', async () => {
    const publish = vi.spyOn(appEventRegistry, 'publish').mockImplementation(() => {});
    microFaux.setResponses([
      (context: Context) => {
        // The serialized app_state lands in the micro.feed_summary.user template.
        expect(userText(context)).toContain('Revenue Dashboard');
        expect(context.tools ?? []).toEqual([]);
        return fauxAssistantMessage('Revenue trending up; 3 dashboards updated.', { stopReason: 'stop' });
      },
    ]);

    const out = await runMicroTask(
      'feed_summary',
      { agent_name: 'MinusX', current_date: '2026-06-28', app_state: '{"files":[{"name":"Revenue Dashboard"}]}' },
      USER,
    );
    expect(out).toBe('Revenue trending up; 3 dashboards updated.');

    const call = publish.mock.calls.find(([evt]) => evt === AppEvents.LLM_CALL);
    expect((call?.[1] as { task?: string }).task).toBe('feed_summary');
  });
});
