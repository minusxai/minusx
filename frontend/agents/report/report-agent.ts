// Report controller agent.
//
// A parent-orchestrating agent: it dispatches one read-only analyst sub-agent
// (`RemoteAnalystAgent`, schema name `AnalystAgent`) per report reference in
// parallel, collects each sub-agent's `ExecuteQuery` results from the log, then
// makes a single LLM **synthesis** call to produce the final markdown report.
//
// Modeled on `DoubleCheckBenchmarkAgent`: `run()` is hand-rolled (no LLM drives
// the controller), every step is dispatched via the orchestrator's normal
// `dispatch()` with deterministic slot ids, and results are read back from
// `toolThread` / the log. The structured run payload is exposed on
// `this.runResult` for the headless runner (`runReportV2`) to read.
import 'server-only';
import { Type } from 'typebox';
import type { Tool } from '@/orchestrator/llm';
import type {
  AssistantMessage,
  Context,
  Message,
  TextContent,
  ToolResultMessage,
} from '@/orchestrator/llm';
import { MXAgent, type MXAgentDetails } from '@/orchestrator/types';
import { renderPrompt } from '@/orchestrator/prompts';
import { registerFauxProvider } from '@/orchestrator/llm/testing';
import { RemoteAnalystAgent } from '@/agents/analyst/analyst-agent';
import { getAgentModelOrTestFallback } from '@/agents/analyst/model-config';
import type { RemoteAnalystContext } from '@/agents/analyst/types';
import type { ReportRunContent, ReportQueryResult, VizSettings } from '@/lib/types';

export const fauxRegistration = registerFauxProvider({
  api: 'faux-report-api',
  provider: 'faux-report',
  models: [{ id: 'stub-report' }],
});
const FAUX_MODEL = fauxRegistration.getModel();

/** One enriched report reference (built by report-handler from the report file). */
export interface ReportAgentReference {
  reference: { id: number; type?: string };
  prompt?: string;
  file_name?: string;
  file_path?: string;
  connection_id?: string;
  /** CompressedAugmentedFile app-state for the analyst sub-agent (includes the SQL + results). */
  app_state?: unknown;
}

/** Context for ReportAgent — RemoteAnalystContext (inherited by sub-agents) + report inputs. */
export interface ReportAgentContext extends RemoteAnalystContext {
  reportId: number;
  reportName: string;
  references: ReportAgentReference[];
  reportPrompt: string;
  emails: string[];
}

/** Minimal shape of a dispatchable analyst sub-agent class. */
type AnalystAgentClass = { readonly schema: { name: string } };

interface SlotSpec {
  name: string;
  args: Record<string, unknown>;
  id: string;
}

const ReportAgentParams = Type.Object({
  userMessage: Type.String(),
});

const DEFAULT_REPORT_PROMPT =
  'Synthesize the analyses into a coherent executive summary. Highlight key findings, trends, and actionable insights.';

export class ReportAgent extends MXAgent<typeof ReportAgentParams, ReportAgentContext> {
  static readonly schema: Tool<typeof ReportAgentParams> = {
    name: 'ReportAgent',
    description:
      'Runs a scheduled report: dispatches an analyst sub-agent per reference, collects their query results, and synthesizes a final markdown report.',
    parameters: ReportAgentParams,
  };
  // No LLM-driven tools — `run()` is hand-rolled.
  static readonly tools = [];
  // Synthesis LLM call uses the analyst model (faux in tests).
  static model = getAgentModelOrTestFallback(FAUX_MODEL);

  /** Sub-agent dispatched per reference. Read-only analyst (server-side tools only). */
  static analystAgent: AnalystAgentClass = RemoteAnalystAgent;

  private readonly startedAt = new Date().toISOString();

  /** Structured run payload, populated by `run()` and read by the headless runner. */
  runResult: ReportRunContent = {
    reportId: 0,
    reportName: '',
    startedAt: this.startedAt,
    status: 'running',
    steps: [],
  };

  protected override getSystemPrompt(): string {
    // Unused — `run()` is overridden and never calls `this.llm()`.
    return '';
  }

  override async run(): Promise<AssistantMessage> {
    const ctx = this.context;
    const references = ctx.references ?? [];
    try {
      // ── Phase 1: dispatch one analyst sub-agent per reference (parallel) ──
      const analystName = (this.constructor as typeof ReportAgent).analystAgent.schema.name;
      const slotIds = references.map((_, i) => `ref-${i}`);
      const slots: SlotSpec[] = references.map((ref, i) => ({
        name: analystName,
        args: { userMessage: buildGoal(ref, i) },
        id: slotIds[i],
      }));
      // Per-reference context overrides: each sub-agent queries its reference's
      // connection and sees its reference's app_state (the SQL + cached results).
      const overrides: Record<string, Record<string, unknown>> = {};
      references.forEach((ref, i) => {
        overrides[slotIds[i]] = {
          connectionId: ref.connection_id || ctx.connectionId,
          appState: ref.app_state ?? null,
        };
      });
      await this._dispatchSlots(slots, overrides);

      // ── Phase 2: collect child analyses + ExecuteQuery results ───────────
      const analyses = slotIds.map((id) => this._readAgentText(id));
      const queries = this._collectQueries(slotIds, references);

      // ── Phase 3: synthesize the final report ─────────────────────────────
      const generatedReport = await this._synthesize(references, analyses, queries);

      this.runResult = {
        reportId: ctx.reportId,
        reportName: ctx.reportName,
        startedAt: this.startedAt,
        completedAt: new Date().toISOString(),
        status: 'success',
        steps: [{ name: 'analysis', startedAt: this.startedAt, completedAt: new Date().toISOString() }],
        generatedReport,
        queries,
      };
      return synthesiseFinal(generatedReport);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.runResult = {
        reportId: ctx.reportId,
        reportName: ctx.reportName,
        startedAt: this.startedAt,
        completedAt: new Date().toISOString(),
        status: 'failed',
        steps: [],
        error: message,
      };
      return synthesiseFinal(`Report execution failed: ${message}`);
    }
  }

  /**
   * Dispatch the slots that don't already have a result (resumable). One
   * synthetic assistant turn carrying all missing slots as parallel toolCalls
   * — same shape an LLM-driven agent produces, so the orchestrator runs them
   * concurrently. Mirrors `DoubleCheckBenchmarkAgent._dispatchSlots`.
   */
  private async _dispatchSlots(
    slots: SlotSpec[],
    contextOverridesByToolCallId?: Record<string, Record<string, unknown>>,
  ): Promise<void> {
    const missing = slots.filter((s) => !this._findResult(s.id));
    if (missing.length === 0) return;

    const synthMsg: AssistantMessage = {
      role: 'assistant',
      content: missing.map((s) => ({ type: 'toolCall', id: s.id, name: s.name, arguments: s.args })),
      api: 'controller' as never,
      provider: 'controller',
      model: 'controller',
      usage: {
        input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'toolUse',
      timestamp: Date.now(),
    };
    await this.orchestrator.dispatch(
      synthMsg,
      this,
      contextOverridesByToolCallId ? { contextOverridesByToolCallId } : undefined,
    );
  }

  private _findResult(slotId: string): ToolResultMessage | undefined {
    return this.toolThread.find(
      (m): m is ToolResultMessage =>
        'role' in m && m.role === 'toolResult' && m.toolCallId === slotId,
    );
  }

  /** Read a sub-agent slot's final answer text (from its MXAgent result). */
  private _readAgentText(slotId: string): string {
    const r = this._findResult(slotId);
    if (!r) return '';
    const details = r.details as MXAgentDetails | undefined;
    if (details?.type === 'mx_agent') return extractText(details.assistantMessage);
    return r.content
      .filter((c): c is TextContent => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
  }

  /**
   * Collect successful `ExecuteQuery` results from the analyst sub-agents.
   * Each sub-agent's `id` equals its slot id, so its tool calls/results carry
   * `parent_id === slotId` in the flat log.
   */
  private _collectQueries(
    slotIds: string[],
    references: ReportAgentReference[],
  ): Record<string, ReportQueryResult> {
    const refBySlot = new Map(slotIds.map((id, i) => [id, references[i]]));
    // toolCallId → { args, slotId } for ExecuteQuery calls under any slot.
    const callsById = new Map<string, { args: Record<string, unknown>; slotId: string }>();
    for (const e of this.orchestrator.log) {
      if (!('role' in e) || e.role !== 'assistant') continue;
      const slotId = (e as { parent_id?: string | null }).parent_id;
      if (!slotId || !refBySlot.has(slotId)) continue;
      for (const block of (e as AssistantMessage).content) {
        if (block.type === 'toolCall' && block.name === 'ExecuteQuery') {
          callsById.set(block.id, { args: block.arguments as Record<string, unknown>, slotId });
        }
      }
    }

    const queries: Record<string, ReportQueryResult> = {};
    for (const e of this.orchestrator.log) {
      if (!('role' in e) || e.role !== 'toolResult') continue;
      const trm = e as ToolResultMessage;
      if (trm.toolName !== 'ExecuteQuery') continue;
      const call = callsById.get(trm.toolCallId);
      if (!call) continue;
      const details = trm.details as
        | { success?: boolean; queryResult?: { columns: string[]; types: string[]; rows: Record<string, unknown>[] } }
        | undefined;
      if (!details?.success || !details.queryResult) continue;
      const ref = refBySlot.get(call.slotId);
      queries[trm.toolCallId] = {
        query: typeof call.args.query === 'string' ? call.args.query : '',
        columns: details.queryResult.columns,
        types: details.queryResult.types,
        rows: details.queryResult.rows,
        vizSettings: parseVizSettings(call.args.vizSettings),
        connectionId: typeof call.args.connectionId === 'string' ? call.args.connectionId : undefined,
        fileId: ref?.reference?.id,
        fileName: ref?.file_name,
      };
    }
    return queries;
  }

  /** Single LLM synthesis pass over the child analyses + collected queries. */
  private async _synthesize(
    references: ReportAgentReference[],
    analyses: string[],
    queries: Record<string, ReportQueryResult>,
  ): Promise<string> {
    const analysesText = references
      .map((ref, i) => {
        const name = ref.file_name ?? `Reference ${i + 1}`;
        const prompt = ref.prompt ?? '';
        return `### ${name}\n**Prompt:** ${prompt}\n**Analysis:**\n${analyses[i] ?? ''}`;
      })
      .join('\n\n');

    const queryLines = Object.entries(queries).map(([id, q]) => {
      const name = q.fileName || 'Query';
      const sql = (q.query || '').slice(0, 100);
      const vizType = (q.vizSettings as { type?: string })?.type ?? 'table';
      return `- \`{{query:${id}}}\`: ${name} (${q.rows.length} rows, ${vizType}) - \`${sql}...\``;
    });
    const queriesText = queryLines.length > 0 ? queryLines.join('\n') : 'No queries available';

    const systemPrompt = renderPrompt('report_synthesis.system', {});
    const userPrompt = renderPrompt('report_synthesis.user', {
      report_name: this.context.reportName,
      analyses_text: analysesText,
      queries_text: queriesText,
      report_prompt: this.context.reportPrompt || DEFAULT_REPORT_PROMPT,
    });

    const ctor = this.constructor as typeof ReportAgent;
    const synthCtx: Context = {
      systemPrompt,
      messages: [{ role: 'user', content: userPrompt, timestamp: Date.now() } as Message],
      tools: [],
    };
    const response = await this.orchestrator.callLLM(ctor.model, synthCtx, this.id);
    const reportContent = extractText(response);

    const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
    let finalReport = `# ${this.context.reportName}\n\n*Generated at ${generatedAt} UTC*\n\n${reportContent}\n`;
    if (this.context.emails?.length) {
      finalReport += `\n---\n*This report will be sent to: ${this.context.emails.join(', ')}*`;
    }
    return finalReport;
  }
}

// ─── pure helpers ─────────────────────────────────────────────────────────

function buildGoal(ref: ReportAgentReference, i: number): string {
  const fileName = ref.file_name ?? `Reference ${i + 1}`;
  const prompt = ref.prompt ?? 'Analyze this data';
  return (
    `[${fileName}]${prompt}\n\n` +
    'IMPORTANT: This is a background report execution. Run the SQL query from the app_state ' +
    '(or any other necessary query) to analyze the data, then summarize the findings.'
  );
}

function extractText(msg: AssistantMessage): string {
  return msg.content
    .filter((c): c is TextContent => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
    .trim();
}

function parseVizSettings(raw: unknown): VizSettings {
  if (raw && typeof raw === 'object') return raw as VizSettings;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as VizSettings;
    } catch {
      /* fall through */
    }
  }
  return { type: 'table' } as VizSettings;
}

/** Build the synthetic final AssistantMessage returned by `run()`. */
function synthesiseFinal(text: string): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'controller' as never,
    provider: 'controller',
    model: 'controller',
    usage: {
      input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: Date.now(),
  };
}
