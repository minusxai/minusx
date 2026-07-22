// runReportV2 — exercises the real headless report runner end-to-end with the
// production registrables (REGISTRABLES + ReportAgent + RemoteAnalystAgent),
// proving the wiring resolves. No DB or backend: faux LLMs + stubbed runQuery.

vi.mock('@/lib/connections/run-query', () => ({
  runQuery: vi.fn(async (_db: string, sql: string) => ({
    columns: ['n'], types: ['int'], rows: [{ n: 1 }], finalQuery: sql,
  })),
}));
vi.mock('@/lib/connections/load-schema', () => ({
  loadConnectionSchema: vi.fn(async () => []),
}));
// The DB-backed plan resolver reads the org config; stub the factory so the
// tests below can substitute their own plan (default: no plan → static faux).
vi.mock('@/lib/llm/llm-plan.server', () => ({
  buildLlmPlanResolver: vi.fn(() => async () => null),
}));

import { fauxAssistantMessage, registerFauxProvider } from '@/orchestrator/llm/testing';
import { fauxRegistration as analystFaux } from '@/agents/analyst/analyst-agent';
import { runReportV2 } from '@/lib/chat/run-report.server';
import { buildLlmPlanResolver } from '@/lib/llm/llm-plan.server';
import type { LlmPlanStep } from '@/orchestrator/types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

const USER: EffectiveUser = {
  userId: 1, email: 'r@example.com', name: 'R', role: 'admin', home_folder: '/org', mode: 'org',
};

// Stands in for the workspace's Settings → Models choice: a model the plan
// resolver returns, distinct from the agents' static fallback models.
const planFaux = registerFauxProvider({
  api: 'faux-report-plan-api',
  provider: 'faux-report-plan',
  models: [{ id: 'stub-report-plan' }],
});

describe('runReportV2 (real registrables)', () => {
  beforeEach(() => {
    analystFaux.setResponses([]);
    planFaux.setResponses([]);
  });

  it('runs ReportAgent + analyst sub-agent through the production registrables and returns the run payload', async () => {
    // The analyst's own markdown IS the report — no synthesis pass.
    analystFaux.setResponses([
      fauxAssistantMessage('## Summary\nGrowth across the board.', { stopReason: 'stop' }),
    ]);

    const run = await runReportV2({
      userId: '1',
      mode: 'org',
      effectiveUser: USER,
      connectionId: 'db',
      reportId: 99,
      reportName: 'Weekly Revenue',
      reportPrompt: 'Executive summary of weekly revenue please.',
      emails: [],
    });

    expect(run.status).toBe('success');
    expect(run.reportId).toBe(99);
    expect(run.generatedReport).toContain('# Weekly Revenue');
    expect(run.generatedReport).toContain('Growth across the board');
  });

  // Regression (providers v2): runReportV2 never wired `orch.resolveLlmPlan`, so
  // report runs ignored the workspace's Settings → Models config and fell back to
  // the agents' static MinusX-gateway model — which has no API key, failing every
  // report run with "No API key for provider: minusx" on configured workspaces.
  it('runs on the DB-configured model plan, not the static fallback model', async () => {
    const resolver = vi.fn(async (): Promise<LlmPlanStep | null> => ({ model: planFaux.getModel() }));
    vi.mocked(buildLlmPlanResolver).mockReturnValue(resolver);
    planFaux.setResponses([
      fauxAssistantMessage('## Summary\nFrom the configured model.', { stopReason: 'stop' }),
    ]);
    analystFaux.setResponses([
      fauxAssistantMessage('## Summary\nFrom the static fallback model.', { stopReason: 'stop' }),
    ]);

    const run = await runReportV2({
      userId: '1',
      mode: 'org',
      effectiveUser: USER,
      connectionId: 'db',
      reportId: 100,
      reportName: 'Weekly Revenue',
      reportPrompt: 'Executive summary of weekly revenue please.',
      emails: [],
    });

    // Every LLM call in a report run (the dispatched analyst sub-agent) is
    // pinned to the `report` agent grade policy.
    expect(resolver).toHaveBeenCalledWith({ agent: 'report' });
    expect(run.status).toBe('success');
    expect(run.generatedReport).toContain('From the configured model');
    expect(run.generatedReport).not.toContain('From the static fallback model');
  });
});
