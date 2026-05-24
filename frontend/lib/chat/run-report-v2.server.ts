/**
 * Headless v=2 report execution.
 *
 * Runs the `ReportAgent` controller (which dispatches analyst sub-agents and
 * synthesizes a markdown report) entirely in-process via the TypeScript
 * orchestrator (no conversation file). Report runs are jobs,
 * not chat threads: their output is persisted by the job-runs system, so we run
 * the orchestrator in-memory and read the structured result off the agent.
 */
import 'server-only';
import { Orchestrator } from '@/orchestrator/orchestrator';
import type { RegistrableClass } from '@/orchestrator/types';
import { V2_HEADLESS_REGISTRABLES } from '@/lib/chat-orchestration-v2.server';
import { RemoteAnalystAgent } from '@/agents/analyst/analyst-agent';
import { ReportAgent, type ReportAgentContext } from '@/agents/report/report-agent';
import type { ReportRunContent } from '@/lib/types';

/**
 * Registrables for a report run: the production chat tools/agents, plus the
 * `ReportAgent` controller and the read-only `RemoteAnalystAgent` (schema name
 * `AnalystAgent`) dispatched once per reference. Uses the *headless* registrables
 * so frontend-bridge tools (e.g. `ReadFiles`) resolve to their server-side
 * variants — there is no browser to bridge to in a report run, so the whole loop
 * runs to completion server-side.
 */
const REPORT_REGISTRABLES: RegistrableClass[] = [
  ...V2_HEADLESS_REGISTRABLES,
  ReportAgent,
  RemoteAnalystAgent,
];

/**
 * Execute a report end-to-end and return its structured run payload.
 *
 * @param ctx - Report inputs (references, prompt, ids) plus the analyst context
 *              (connection, schema, whitelist, effectiveUser, …).
 */
export async function runReportV2(ctx: ReportAgentContext): Promise<ReportRunContent> {
  const orch = new Orchestrator(REPORT_REGISTRABLES, []);
  const agent = new ReportAgent(orch, { userMessage: `Execute report: ${ctx.reportName}` }, ctx);

  const stream = orch.run(agent);
  for await (const ev of stream) {
    if ((ev as { type?: string }).type === 'error') {
      const errMsg = (ev as { error?: { errorMessage?: string } }).error?.errorMessage;
      console.error('[v2/report] orchestrator error event:', errMsg);
    }
  }
  await stream.result();

  return agent.runResult;
}
