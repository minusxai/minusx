// ReportAgent (v=2) — single freeform-prompt behavior with faux LLMs.
//
// Exercises the full flow without a DB or backend: ReportAgent dispatches ONE
// analyst sub-agent driven by the report's freeform `reportPrompt`, then uses
// the analyst's own markdown as the report (no synthesis pass). Charts are
// `<div data-question-id>` embeds the analyst writes inline (rendered live by
// the report viewer), so they pass through verbatim. `runQuery` /
// `loadConnectionSchema` are stubbed so tools never reach ConnectionsAPI/FilesAPI.

vi.mock('@/lib/connections/run-query', () => ({
  runQuery: vi.fn(async (_db: string, sql: string) => ({
    columns: ['n'],
    types: ['int'],
    rows: [{ n: 1 }, { n: 2 }],
    finalQuery: sql,
  })),
}));
vi.mock('@/lib/connections/load-schema', () => ({
  loadConnectionSchema: vi.fn(async () => []),
}));

import { Orchestrator } from '@/orchestrator/orchestrator';
import { fauxAssistantMessage } from '@/orchestrator/llm/testing';
import { ReportAgent, type ReportAgentContext } from '../report-agent';
import {
  RemoteAnalystAgent,
  ExecuteQuery,
  SearchDBSchema,
  ReadFiles,
  SearchFiles,
  ListDBConnections,
  fauxRegistration as analystFaux,
} from '@/agents/analyst/analyst-agent';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

const REGISTRABLES = [
  ReportAgent,
  RemoteAnalystAgent,
  ExecuteQuery,
  SearchDBSchema,
  ReadFiles,
  SearchFiles,
  ListDBConnections,
];

const USER: EffectiveUser = {
  userId: 1,
  email: 'reporter@example.com',
  name: 'Reporter',
  role: 'admin',
  home_folder: '/org',
  mode: 'org',
};

function baseContext(overrides: Partial<ReportAgentContext>): ReportAgentContext {
  return {
    userId: 'u',
    mode: 'org',
    effectiveUser: USER,
    connectionId: 'db',
    reportId: 42,
    reportName: 'Q3 Report',
    reportPrompt: 'Summarize revenue and costs for the quarter.',
    emails: [],
    ...overrides,
  };
}

async function runAgent(ctx: ReportAgentContext): Promise<ReportAgent> {
  const orch = new Orchestrator(REGISTRABLES);
  const agent = new ReportAgent(orch, { userMessage: `Execute report: ${ctx.reportName}` }, ctx);
  const stream = orch.run(agent);
  for await (const _ev of stream) {
    /* drain */
  }
  await stream.result();
  return agent;
}

beforeEach(() => {
  analystFaux.setResponses([]);
});

describe('ReportAgent (v2)', () => {
  it('runs a single analyst from the freeform prompt and uses its output as the report', async () => {
    let seenUserMessage = '';
    analystFaux.setResponses([
      (context) => {
        seenUserMessage = JSON.stringify(context.messages);
        return fauxAssistantMessage('## Executive Summary\nRevenue up 12%, costs down 5%.', {
          stopReason: 'stop',
        });
      },
    ]);

    const agent = await runAgent(baseContext({}));

    // The analyst is driven by the report's freeform prompt.
    expect(seenUserMessage).toContain('Summarize revenue and costs for the quarter.');

    const run = agent.runResult;
    expect(run.status).toBe('success');
    expect(run.reportId).toBe(42);
    expect(run.reportName).toBe('Q3 Report');
    expect(run.generatedReport).toContain('# Q3 Report'); // title header
    expect(run.generatedReport).toContain('Executive Summary'); // analyst body verbatim
    expect(run.generatedReport).toContain('Revenue up 12%, costs down 5%.');
    expect(run.steps).toHaveLength(1);
  });

  it("preserves the analyst's <div data-question-id> chart embeds in the report", async () => {
    // Charts are saved-question embeds (rendered live by the report viewer),
    // so the analyst's markdown — including the embed div — passes through verbatim.
    analystFaux.setResponses([
      fauxAssistantMessage(
        '## TL;DR\n- revenue up 12%\n\n<div data-question-id="7"></div>\n\n## Summary\nHealthy quarter.',
        { stopReason: 'stop' },
      ),
    ]);

    const agent = await runAgent(baseContext({ reportName: 'Sales Report' }));

    const run = agent.runResult;
    expect(run.status).toBe('success');
    expect(run.generatedReport).toContain('<div data-question-id="7"></div>');
  });

  it('normalizes @{json} mentions and tells the analyst to read the mentioned files', async () => {
    let seen = '';
    analystFaux.setResponses([
      (context) => {
        seen = JSON.stringify(context.messages);
        return fauxAssistantMessage('done', { stopReason: 'stop' });
      },
    ]);

    await runAgent(
      baseContext({
        reportPrompt: 'Summarize @{"type":"question","name":"Revenue Q3","id":5}.',
      }),
    );

    // Mention rendered readable, carrying the id the analyst can ReadFiles.
    expect(seen).toContain('Revenue Q3 (question #5)');
    // Raw mention JSON is not leaked to the analyst.
    expect(seen).not.toContain('"type":"question"');
    // The analyst is told to read mentioned files first.
    expect(seen).toContain('ReadFiles');
  });

  it('strips conversational preamble before the first heading (no chatty intro in the emailed report)', async () => {
    analystFaux.setResponses([
      fauxAssistantMessage(
        "Now I have a clear picture. Here's the report:\n\n## TL;DR\n- revenue up 12%\n\n## Summary\nHealthy quarter.",
        { stopReason: 'stop' },
      ),
    ]);

    const agent = await runAgent(baseContext({}));

    const report = agent.runResult.generatedReport ?? '';
    expect(report).not.toContain('clear picture');
    expect(report).not.toContain("Here's the report");
    expect(report).toContain('## TL;DR');
    expect(report).toContain('revenue up 12%');
  });

  it('appends the email-recipient footer when emails are provided', async () => {
    analystFaux.setResponses([fauxAssistantMessage('Body.', { stopReason: 'stop' })]);

    const agent = await runAgent(baseContext({ emails: ['team@example.com'] }));

    expect(agent.runResult.generatedReport).toContain('This report will be sent to: team@example.com');
  });
});
