// ReportAgent (v=2) — controller behavior with faux LLMs.
//
// Exercises the full flow without a DB or backend: ReportAgent dispatches one
// analyst sub-agent per reference (faux analyst), collects their ExecuteQuery
// results, and runs a final synthesis pass (faux report). `runQuery` /
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
import { fauxAssistantMessage, fauxToolCall } from '@/orchestrator/llm/testing';
import { ReportAgent, fauxRegistration as reportFaux, type ReportAgentContext } from '../report-agent';
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
import type { Context } from '@/orchestrator/llm';

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
    references: [],
    reportPrompt: 'Summarize the findings.',
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
  reportFaux.setResponses([]);
  analystFaux.setResponses([]);
});

describe('ReportAgent (v2)', () => {
  it('dispatches an analyst per reference and synthesizes their analyses into a report', async () => {
    // Two sub-agents, each returns a plain analysis (no tool calls).
    analystFaux.setResponses([
      fauxAssistantMessage('Revenue is up 12% this quarter.', { stopReason: 'stop' }),
      fauxAssistantMessage('Costs are down 5% this quarter.', { stopReason: 'stop' }),
    ]);

    // Synthesis faux asserts the prompt carried BOTH child analyses + ref names,
    // then returns the report body. (Order-independent: parallel sub-agents.)
    reportFaux.setResponses([
      (context: Context) => {
        const userMsg = context.messages.find((m) => m.role === 'user');
        const text = typeof userMsg?.content === 'string' ? userMsg.content : '';
        expect(text).toContain('up 12%');
        expect(text).toContain('down 5%');
        expect(text).toContain('Revenue Q');
        expect(text).toContain('Costs Q');
        return fauxAssistantMessage('## Executive Summary\nEverything looks healthy.', { stopReason: 'stop' });
      },
    ]);

    const agent = await runAgent(
      baseContext({
        references: [
          { reference: { id: 1 }, prompt: 'Analyze revenue', file_name: 'Revenue Q', connection_id: 'db', app_state: { type: 'file' } },
          { reference: { id: 2 }, prompt: 'Analyze costs', file_name: 'Costs Q', connection_id: 'db', app_state: { type: 'file' } },
        ],
      }),
    );

    const run = agent.runResult;
    expect(run.status).toBe('success');
    expect(run.reportId).toBe(42);
    expect(run.reportName).toBe('Q3 Report');
    expect(run.generatedReport).toContain('# Q3 Report'); // header
    expect(run.generatedReport).toContain('Executive Summary'); // synthesis body
    expect(run.steps).toHaveLength(1);
    expect(run.queries).toEqual({});
  });

  it('collects ExecuteQuery results from sub-agents into run.queries', async () => {
    const execId = 'call_exec_1';
    // Sub-agent: emit an ExecuteQuery tool call, then stop.
    analystFaux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall('ExecuteQuery', { connectionId: 'db', query: 'SELECT count(*) AS n', vizSettings: { type: 'bar' } }, { id: execId })],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('The table has 2 rows.', { stopReason: 'stop' }),
    ]);
    reportFaux.setResponses([
      fauxAssistantMessage(`Here is the chart: {{query:${execId}}}`, { stopReason: 'stop' }),
    ]);

    const agent = await runAgent(
      baseContext({
        reportName: 'Sales Report',
        references: [
          { reference: { id: 7 }, prompt: 'Count rows', file_name: 'Sales', connection_id: 'db', app_state: { type: 'file' } },
        ],
      }),
    );

    const run = agent.runResult;
    expect(run.status).toBe('success');
    const queries = run.queries ?? {};
    expect(Object.keys(queries)).toEqual([execId]);
    const q = queries[execId];
    expect(q.query).toBe('SELECT count(*) AS n');
    expect(q.columns).toEqual(['n']);
    expect(q.rows).toHaveLength(2);
    expect(q.vizSettings.type).toBe('bar');
    expect(q.connectionId).toBe('db');
    expect(q.fileId).toBe(7);
    expect(q.fileName).toBe('Sales');
    // The synthesis output (with the {{query:id}} embed) is included in the report.
    expect(run.generatedReport).toContain(`{{query:${execId}}}`);
  });

  it('appends the email-recipient footer when emails are provided', async () => {
    analystFaux.setResponses([fauxAssistantMessage('Analysis.', { stopReason: 'stop' })]);
    reportFaux.setResponses([fauxAssistantMessage('Body.', { stopReason: 'stop' })]);

    const agent = await runAgent(
      baseContext({
        emails: ['team@example.com'],
        references: [{ reference: { id: 1 }, prompt: 'x', file_name: 'Ref', connection_id: 'db', app_state: {} }],
      }),
    );

    expect(agent.runResult.generatedReport).toContain('This report will be sent to: team@example.com');
  });
});
