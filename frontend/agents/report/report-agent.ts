// Report controller agent.
//
// A parent-orchestrating agent: it dispatches a single read-only analyst
// sub-agent (`RemoteAnalystAgent`, schema name `AnalystAgent`) driven by the
// report's freeform `reportPrompt`, then uses that analyst's own markdown as the
// final report. Any `ExecuteQuery` results the analyst runs are collected so the
// analyst can embed `{{query:id}}` charts inline.
//
// Modeled on `DoubleCheckBenchmarkAgent`: `run()` is hand-rolled (no LLM drives
// the controller), the analyst is dispatched via the orchestrator's normal
// `dispatch()` with a deterministic slot id, and its result is read back from
// `toolThread` / the log. The structured run payload is exposed on
// `this.runResult` for the headless runner (`runReportV2`) to read.
import 'server-only';
import { Type } from 'typebox';
import type { Tool } from '@/orchestrator/llm';
import type {
  AssistantMessage,
  TextContent,
  ToolResultMessage,
} from '@/orchestrator/llm';
import { MXAgent, type MXAgentDetails } from '@/orchestrator/types';
import { registerFauxProvider } from '@/orchestrator/llm/testing';
import { RemoteAnalystAgent } from '@/agents/analyst/analyst-agent';
import { getAgentModelOrTestFallback } from '@/agents/analyst/model-config';
import type { RemoteAnalystContext } from '@/agents/analyst/types';
import type { ReportRunContent } from '@/lib/types';

// Kept only so `ReportAgent.model` (required by MXAgent) resolves — the
// controller never calls the LLM itself, so this provider is never invoked.
const fauxRegistration = registerFauxProvider({
  api: 'faux-report-api',
  provider: 'faux-report',
  models: [{ id: 'stub-report' }],
});
const FAUX_MODEL = fauxRegistration.getModel();

/** Context for ReportAgent — RemoteAnalystContext (inherited by the sub-agent) + report inputs. */
export interface ReportAgentContext extends RemoteAnalystContext {
  reportId: number;
  reportName: string;
  reportPrompt: string;
  emails: string[];
}

/** Minimal shape of a dispatchable analyst sub-agent class. */
type AnalystAgentClass = { readonly schema: { name: string } };

const ReportAgentParams = Type.Object({
  userMessage: Type.String(),
});

/** Deterministic slot id for the single analyst sub-agent. */
const ANALYST_SLOT = 'analyst';

export class ReportAgent extends MXAgent<typeof ReportAgentParams, ReportAgentContext> {
  static readonly schema: Tool<typeof ReportAgentParams> = {
    name: 'ReportAgent',
    description:
      "Runs a scheduled report: dispatches a single analyst sub-agent driven by the report's freeform prompt and uses its markdown as the final report.",
    parameters: ReportAgentParams,
  };
  // No LLM-driven tools — `run()` is hand-rolled.
  static readonly tools = [];
  // Required by MXAgent; never used because `run()` makes no LLM call.
  static model = getAgentModelOrTestFallback(FAUX_MODEL);
  static override readonly llmAgent = 'report';

  /** Sub-agent dispatched for the report. Read-only analyst (server-side tools only). */
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
    try {
      // ── Phase 1: dispatch a single analyst sub-agent from the freeform prompt ──
      const analystName = (this.constructor as typeof ReportAgent).analystAgent.schema.name;
      await this._dispatchAnalyst(analystName, buildGoal(ctx.reportPrompt));

      // ── Phase 2: read the analyst's markdown (charts are embedded as
      //    `<div data-question-id>` and rendered live by the report viewer) ────
      const analysis = this._readAgentText(ANALYST_SLOT);

      // ── Phase 3: the analyst's output IS the report (title header + footer) ───
      const generatedReport = this._formatReport(analysis);

      this.runResult = {
        reportId: ctx.reportId,
        reportName: ctx.reportName,
        startedAt: this.startedAt,
        completedAt: new Date().toISOString(),
        status: 'success',
        steps: [{ name: 'analysis', startedAt: this.startedAt, completedAt: new Date().toISOString() }],
        generatedReport,
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
   * Dispatch the single analyst slot (resumable). One synthetic assistant turn
   * carrying the analyst as a toolCall — same shape an LLM-driven agent produces.
   * Mirrors `DoubleCheckBenchmarkAgent._dispatchSlots`.
   */
  private async _dispatchAnalyst(analystName: string, userMessage: string): Promise<void> {
    if (this._findResult(ANALYST_SLOT)) return;

    const synthMsg: AssistantMessage = {
      role: 'assistant',
      content: [{ type: 'toolCall', id: ANALYST_SLOT, name: analystName, arguments: { userMessage } }],
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
    await this.orchestrator.dispatch(synthMsg, this);
  }

  private _findResult(slotId: string): ToolResultMessage | undefined {
    return this.toolThread.find(
      (m): m is ToolResultMessage =>
        'role' in m && m.role === 'toolResult' && m.toolCallId === slotId,
    );
  }

  /** Read the analyst slot's final answer text (from its MXAgent result). */
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

  /** Wrap the analyst's markdown with a title header + optional email footer. */
  private _formatReport(analysis: string): string {
    const body = stripConversationalPreamble(analysis);
    const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
    let finalReport = `# ${this.context.reportName}\n\n*Generated at ${generatedAt} UTC*\n\n${body}\n`;
    if (this.context.emails?.length) {
      finalReport += `\n---\n*This report will be sent to: ${this.context.emails.join(', ')}*`;
    }
    return finalReport;
  }
}

// ─── pure helpers ─────────────────────────────────────────────────────────

export function buildGoal(reportPrompt: string): string {
  const prompt = normalizeMentions(reportPrompt?.trim() || 'Summarize the latest data.');
  return (
    `${prompt}\n\n` +
    'IMPORTANT: This is a background, scheduled report execution. Follow these rules exactly.\n\n' +
    'DATA\n' +
    '- Items written as `@Name (question #id)` or `@Name (dashboard #id)` are saved files. Call ' +
    '**ReadFiles** on the id to get the file, its SQL, and current results. Rely on these for your numbers.\n' +
    '- Run **ExecuteQuery** for anything the mentioned files do not cover (or when nothing is mentioned).\n\n' +
    'CHARTS & NUMBERS\n' +
    '- To show a chart, embed a SAVED question with the `<Question>` component on its own line: ' +
    '`<Question id={123} />`. It renders that question\'s live chart (fresh data) when the report is viewed.\n' +
    '- Use the id of a mentioned question (`@Name (question #123)` → 123), or a question you find via ' +
    'SearchFiles. Only saved questions can be embedded — never invent an id.\n' +
    '- For a headline KPI number, PREFER embedding a saved single-number question the same way ' +
    '(`<Question id={N} />`) so the figure stays live; only state a number directly in the prose when no ' +
    'saved question covers it (get it with ExecuteQuery — never guess). Include only the 1-3 ' +
    'charts/numbers that matter most.\n\n' +
    'OUTPUT FORMAT — keep it very short, markdown only:\n' +
    '- Output ONLY the report. Begin immediately with the `## TL;DR` heading — NO preamble ' +
    '(no "Now I have a clear picture", no "Here is the report"), NO meta-commentary, NO closing ' +
    'sign-off. This text is emailed directly to the user.\n' +
    '- A `## TL;DR` section: 3-5 terse bullet points of the key numbers and findings.\n' +
    '- The 1-3 embedded question charts, placed where they add the most value.\n' +
    '- A `## Summary` section: at most 3 lines of prose.\n' +
    '- No filler, no methodology, no restating the prompt.'
  );
}

/**
 * Drop any conversational preamble the analyst writes before the report itself
 * (e.g. "Now I have a clear picture. Here's the report:"). This text is emailed
 * to the user, so it must read as a clean report. If the body has a markdown
 * heading, everything before the first one is preamble and is removed; otherwise
 * the text is left as-is (no heading to anchor on).
 */
function stripConversationalPreamble(text: string): string {
  const trimmed = text.trim();
  const firstHeading = trimmed.search(/^#{1,6}\s/m);
  return firstHeading > 0 ? trimmed.slice(firstHeading).trim() : trimmed;
}

/**
 * Replace serialized `@{json}` mentions (the format the Lexical editor writes
 * into reportPrompt) with readable `@Name (type #id)` text, so the analyst sees
 * the file name + id instead of a raw JSON blob. Mirrors the mention format in
 * `components/lexical/mention-transformer.ts` (flat JSON, lazy `{.+?}`).
 */
function normalizeMentions(text: string): string {
  return text.replace(/@(\{.+?\})/g, (full, json: string) => {
    try {
      const d = JSON.parse(json) as { type?: string; name?: string; display_text?: string; id?: number };
      const name = d.name ?? d.display_text;
      if (!name) return full;
      return d.type && d.id != null ? `@${name} (${d.type} #${d.id})` : `@${name}`;
    } catch {
      return full;
    }
  });
}

function extractText(msg: AssistantMessage): string {
  return msg.content
    .filter((c): c is TextContent => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
    .trim();
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
