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

import { fauxAssistantMessage } from '@/orchestrator/llm/testing';
import { fauxRegistration as analystFaux } from '@/agents/analyst/analyst-agent';
import { runReportV2 } from '@/lib/chat/run-report.server';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

const USER: EffectiveUser = {
  userId: 1, email: 'r@example.com', name: 'R', role: 'admin', home_folder: '/org', mode: 'org',
};

describe('runReportV2 (real registrables)', () => {
  beforeEach(() => {
    analystFaux.setResponses([]);
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
});
