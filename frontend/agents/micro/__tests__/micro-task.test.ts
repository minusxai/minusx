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
// The DB-backed plan resolver reads the org config; stub the factory so the
// tests below can substitute their own plan (default: no plan → static faux).
vi.mock('@/lib/llm/llm-plan.server', () => ({
  buildLlmPlanResolver: vi.fn(() => async () => null),
}));

import { fauxAssistantMessage, registerFauxProvider } from '@/orchestrator/llm/testing';
import { fauxRegistration as microFaux } from '@/agents/micro/micro-agent';
import { runMicroTask } from '@/lib/chat/run-micro-task.server';
import { buildLlmPlanResolver } from '@/lib/llm/llm-plan.server';
import type { LlmPlanStep, LlmPlanSelector } from '@/orchestrator/types';
import { appEventRegistry, AppEvents } from '@/lib/app-event-registry';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { Context } from '@/orchestrator/llm';

const USER: EffectiveUser = {
  userId: 1, email: 'u@example.com', name: 'U', role: 'admin', home_folder: '/org', mode: 'org',
};

// Stands in for the workspace's Settings → Models choice: a model the plan
// resolver returns, distinct from MicroAgent's static fallback model.
const planFaux = registerFauxProvider({
  api: 'faux-plan-api',
  provider: 'faux-plan',
  models: [{ id: 'stub-plan' }],
});

function userText(context: Context): string {
  const m = context.messages.find((x) => x.role === 'user');
  const c = m?.content as unknown;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
  return '';
}

beforeEach(() => {
  microFaux.setResponses([]);
  planFaux.setResponses([]);
});
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

  it('throws (rather than returning empty) when the model yields no text', async () => {
    microFaux.setResponses([() => fauxAssistantMessage('   ', { stopReason: 'stop' })]);
    await expect(
      runMicroTask('title', { input: 'x', subject: 'a question', instructions: '' }, USER),
    ).rejects.toThrow(/produced no result \(the model returned an empty reply\)/);
  });

  // Regression: an LLM failure (missing API key, unconfigured use-case model, provider error)
  // surfaced to the browser as a bare 500 "produced no result" — the actual cause was logged to the
  // server console and dropped, leaving "[FeedSummary] Error: Micro-task 'feed_summary' produced no
  // result" undiagnosable from the client. The cause must travel with the error.
  it('reports the underlying LLM failure instead of masking it as "no result"', async () => {
    microFaux.setResponses([
      () => { throw new Error('No API key for provider: minusx'); },
    ]);
    await expect(
      runMicroTask('title', { input: 'x', subject: 'a question', instructions: '' }, USER),
    ).rejects.toThrow(/No API key for provider: minusx/);
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

  // Regression (providers v2): runMicroTask never wired `orch.resolveLlmPlan`, so
  // micro-tasks ignored the workspace's Settings → Models config and fell back to
  // MicroAgent's static MinusX-gateway model — which has no API key, failing every
  // micro-task with "No API key for provider: minusx" on configured workspaces.
  it('runs on the DB-configured model plan, not the static fallback model', async () => {
    const resolver = vi.fn(async (selector: LlmPlanSelector): Promise<LlmPlanStep | null> =>
      selector.agent === 'micro' ? { model: planFaux.getModel() } : null,
    );
    vi.mocked(buildLlmPlanResolver).mockReturnValue(resolver);
    planFaux.setResponses([fauxAssistantMessage('from the configured model', { stopReason: 'stop' })]);
    microFaux.setResponses([fauxAssistantMessage('from the static fallback model', { stopReason: 'stop' })]);

    const out = await runMicroTask('title', { input: 'x', subject: 'a question', instructions: '' }, USER);

    expect(resolver).toHaveBeenCalledWith({ agent: 'micro' });
    expect(out).toBe('from the configured model');
  });

  // Per-task grade override: rubric_llm judges visual output and rides the
  // core grade (code-owned — not bounded by micro's lite-only user policy).
  it('passes the task-declared grade to the resolver (rubric_llm → core)', async () => {
    const resolver = vi.fn(async (): Promise<LlmPlanStep | null> => null);
    vi.mocked(buildLlmPlanResolver).mockReturnValue(resolver);
    microFaux.setResponses([fauxAssistantMessage('PASS', { stopReason: 'stop' })]);

    await runMicroTask('rubric_llm', { checklist: '- looks right', file_type: 'question', markup: '<question/>', screenshot_note: '' }, USER);

    expect(resolver).toHaveBeenCalledWith({ agent: 'micro', grade: 'core' });
  });
});
