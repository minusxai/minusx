// Cross-check controller: runs two `BenchmarkAnalystAgent` instances in
// parallel as tool calls, judges their final answers via a `CheckEquivalence`
// tool, and (on disagreement) retries once with cross-feedback. Toggled by
// `DAB_DOUBLE_CHECK=1` in the benchmark CLI. See `frontend/benchmarks/README.md`.
//
// The whole flow is hand-rolled TS — no LLM drives the controller; the
// only LLM cost is inside the four sub-agent runs and the two judge
// calls. Each step is dispatched via the orchestrator's normal
// `dispatch()` (the same path the LLM-driven loop uses), so the log on
// disk has the natural pi-ai shape (assistant turn → toolCall → toolResult,
// all `parent_id`-chained).
//
// Resumability: every dispatched toolCall uses a deterministic slot id
// (`r1-agent1`, `r1-check`, …). On resume, `MXAgent.toolThread` is
// rebuilt from the log via `Orchestrator.reconstructAgent`; `run()`
// reads it slot-by-slot and only dispatches the missing slots. A run
// that died mid-way picks up from the last completed slot instead of
// re-burning prior sub-agent runs.
import 'server-only';
import { Type, type Tool } from '@mariozechner/pi-ai';
import type {
  AssistantMessage,
  Context,
  Message,
  TextContent,
  ToolResultMessage,
} from '@mariozechner/pi-ai';
import { MXAgent, MXTool, type ToolResponse, type MXAgentDetails } from '@/orchestrator/types';
import { BenchmarkAnalystAgent } from './benchmark-analyst';
import type { BenchmarkAnalystContext } from './types';

// ─── Slot ids ─────────────────────────────────────────────────────────────
// Stable across resumes; uniquely identify each dispatched toolCall
// within a single DoubleCheck run.
const SLOTS = {
  r1_agent1: 'r1-agent1',
  r1_agent2: 'r1-agent2',
  r1_check:  'r1-check',
  r2_agent1: 'r2-agent1',
  r2_agent2: 'r2-agent2',
  r2_check:  'r2-check',
} as const;

// ─── CheckEquivalence tool ────────────────────────────────────────────────

const CheckEquivalenceParams = Type.Object({
  question: Type.String(),
  answerA: Type.String(),
  answerB: Type.String(),
});

interface CheckEquivalenceDetails extends Record<string, unknown> {
  equivalent: boolean;
  /** Raw LLM verdict text — useful when debugging false positives /
   *  negatives. Stored only in `details`, not in the LLM-visible
   *  content (which is just the boolean). */
  rawVerdict?: string;
}

/**
 * Single-shot LLM judge for two analyst answers. Used by
 * `DoubleCheckBenchmarkAgent` to decide whether to accept consensus or
 * spawn another round.
 */
export class CheckEquivalence extends MXTool<
  typeof CheckEquivalenceParams,
  BenchmarkAnalystContext,
  CheckEquivalenceDetails
> {
  static readonly schema: Tool<typeof CheckEquivalenceParams> = {
    name: 'CheckEquivalence',
    description: 'Compares two analyst answers to the same question and decides whether they are semantically equivalent. Returns {equivalent: boolean}.',
    parameters: CheckEquivalenceParams,
  };

  async run(): Promise<ToolResponse<CheckEquivalenceDetails>> {
    const { question, answerA, answerB } = this.parameters;
    const judgeCtx: Context = {
      systemPrompt:
        'You compare two analyst answers to the same question and decide whether they are semantically equivalent (same factual content / same TL;DR). Reply with exactly EQUIVALENT or DIFFERENT — nothing else.',
      messages: [
        {
          role: 'user',
          content: `Question: ${question}\n\nAnswer A: ${answerA}\n\nAnswer B: ${answerB}\n\nAre these answers semantically equivalent? Reply EQUIVALENT or DIFFERENT.`,
          timestamp: Date.now(),
        },
      ],
      tools: [],
    };
    const model = BenchmarkAnalystAgent.model;
    const verdictMsg = await this.orchestrator.callLLM(model, judgeCtx, this.id);
    const verdict = extractText(verdictMsg).trim().toUpperCase();
    const equivalent = verdict.startsWith('EQUIVALENT');
    const details: CheckEquivalenceDetails = { equivalent, rawVerdict: verdict };
    return {
      content: [{ type: 'text', text: JSON.stringify({ equivalent }) }],
      isError: false,
      details,
    };
  }
}

// ─── DoubleCheckBenchmarkAgent ────────────────────────────────────────────

const DoubleCheckBenchmarkAgentParams = Type.Object({
  userMessage: Type.String(),
});

/** One toolCall slot for `_dispatchSlots` to dispatch (if not already done). */
interface SlotSpec {
  name: string;
  args: Record<string, unknown>;
  id: string;
}

/**
 * Controller agent. Receives a `userMessage`, runs two
 * `BenchmarkAnalystAgent` sub-agents in parallel as tool calls, judges
 * equivalence via `CheckEquivalence`, and on disagreement reruns each
 * with cross-feedback.
 *
 * `run()` is hand-rolled — every step constructs a synthetic
 * AssistantMessage with deterministic slot ids and calls
 * `orchestrator.dispatch(...)`. Results are then read from
 * `this.toolThread` by slot id. Already-completed slots (from a prior
 * interrupted run) are skipped, making the controller fully resumable.
 *
 * Returns either the consensus answer or `"Failed to reach consensus"`.
 */
export class DoubleCheckBenchmarkAgent extends MXAgent<
  typeof DoubleCheckBenchmarkAgentParams,
  BenchmarkAnalystContext
> {
  static readonly schema: Tool<typeof DoubleCheckBenchmarkAgentParams> = {
    name: 'DoubleCheckBenchmarkAgent',
    description:
      'Runs two BenchmarkAnalystAgent instances in parallel; on disagreement, retries once with cross-feedback; returns the consensus answer or "Failed to reach consensus".',
    parameters: DoubleCheckBenchmarkAgentParams,
  };
  // No LLM-driven tools — `run()` is hand-rolled.
  static readonly tools = [];
  // Inherits provider/model from `BenchmarkAnalystAgent` so the judge
  // and any future LLM calls use the same model as the analyst sub-agents.
  static model = BenchmarkAnalystAgent.model;

  protected override getSystemPrompt(): string {
    // Unused — `run()` is overridden and never calls `this.llm()`.
    return '';
  }

  override async run(): Promise<AssistantMessage> {
    const { userMessage } = this.parameters;

    // ── Round 1 — two analysts in parallel ──────────────────────────────
    await this._dispatchSlots([
      { name: BenchmarkAnalystAgent.schema.name, args: { userMessage }, id: SLOTS.r1_agent1 },
      { name: BenchmarkAnalystAgent.schema.name, args: { userMessage }, id: SLOTS.r1_agent2 },
    ]);
    const t1 = this._readAgentText(SLOTS.r1_agent1);
    const t2 = this._readAgentText(SLOTS.r1_agent2);

    // ── Round 1 — judge ─────────────────────────────────────────────────
    await this._dispatchSlots([{
      name: CheckEquivalence.schema.name,
      args: { question: userMessage, answerA: t1, answerB: t2 },
      id: SLOTS.r1_check,
    }]);
    if (this._readEquivalence(SLOTS.r1_check)) return synthesiseFinal(t1);

    // ── Round 2 — analysts continue from round-1 history + cross-feedback ─
    // Each round-2 sub-agent is seeded with its own round-1 counterpart's
    // full thread (original user message + all internal assistant turns +
    // tool results), so it can build on its prior reasoning instead of
    // restarting. The feedback prompt is appended on top as the new user
    // turn by `MXAgent.buildMessages()` (threadHistory ++ user ++ toolThread).
    const fb1 = buildFeedbackPrompt(userMessage, t1, t2);
    const fb2 = buildFeedbackPrompt(userMessage, t2, t1);
    const r1History1 = this.orchestrator.extractAgentHistory(SLOTS.r1_agent1);
    const r1History2 = this.orchestrator.extractAgentHistory(SLOTS.r1_agent2);
    await this._dispatchSlots(
      [
        { name: BenchmarkAnalystAgent.schema.name, args: { userMessage: fb1 }, id: SLOTS.r2_agent1 },
        { name: BenchmarkAnalystAgent.schema.name, args: { userMessage: fb2 }, id: SLOTS.r2_agent2 },
      ],
      {
        [SLOTS.r2_agent1]: r1History1,
        [SLOTS.r2_agent2]: r1History2,
      },
    );
    const t1b = this._readAgentText(SLOTS.r2_agent1);
    const t2b = this._readAgentText(SLOTS.r2_agent2);

    // ── Round 2 — judge ─────────────────────────────────────────────────
    await this._dispatchSlots([{
      name: CheckEquivalence.schema.name,
      args: { question: userMessage, answerA: t1b, answerB: t2b },
      id: SLOTS.r2_check,
    }]);
    if (this._readEquivalence(SLOTS.r2_check)) return synthesiseFinal(t1b);

    return synthesiseFinal('Failed to reach consensus');
  }

  /**
   * Dispatch only the slots that don't already have a result in
   * `this.toolThread`. The dispatch is one synthetic assistant turn
   * carrying all missing slots as parallel toolCalls — same shape an
   * LLM-driven agent would produce, so the orchestrator's
   * `Promise.allSettled` parallel-dispatch path runs them concurrently
   * and the row's effective LLM concurrency stays governed by
   * `MAX_LLM_CONCURRENCY`.
   */
  private async _dispatchSlots(
    slots: SlotSpec[],
    threadHistoryByToolCallId?: Record<string, Message[]>,
  ): Promise<void> {
    const missing = slots.filter((s) => !this._findResult(s.id));
    if (missing.length === 0) return;

    const synthMsg: AssistantMessage = {
      role: 'assistant',
      content: missing.map((s) => ({
        type: 'toolCall',
        id: s.id,
        name: s.name,
        arguments: s.args,
      })),
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
      threadHistoryByToolCallId ? { threadHistoryByToolCallId } : undefined,
    );
  }

  private _findResult(slotId: string): ToolResultMessage | undefined {
    return this.toolThread.find(
      (m): m is ToolResultMessage =>
        'role' in m && m.role === 'toolResult' && m.toolCallId === slotId,
    );
  }

  /** Read a sub-agent slot's final text (from `details.assistantMessage`). */
  private _readAgentText(slotId: string): string {
    const r = this._findResult(slotId);
    if (!r) throw new Error(`DoubleCheckBenchmarkAgent: no result for slot '${slotId}'`);
    const details = r.details as MXAgentDetails | undefined;
    if (details?.type !== 'mx_agent') {
      throw new Error(`DoubleCheckBenchmarkAgent: slot '${slotId}' is not an MXAgent result`);
    }
    return extractText(details.assistantMessage);
  }

  /** Read a `CheckEquivalence` slot's verdict. */
  private _readEquivalence(slotId: string): boolean {
    const r = this._findResult(slotId);
    if (!r) throw new Error(`DoubleCheckBenchmarkAgent: no result for slot '${slotId}'`);
    return (r.details as CheckEquivalenceDetails | undefined)?.equivalent === true;
  }
}

// ─── pure helpers ─────────────────────────────────────────────────────────

function extractText(msg: AssistantMessage): string {
  return msg.content
    .filter((c): c is TextContent => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
    .trim();
}

/**
 * Build the round-2 user message for one of the analysts. Embeds the
 * analyst's prior answer + the other analyst's prior answer; asks them
 * to reconsider and either restate or give a new final answer.
 */
function buildFeedbackPrompt(originalQ: string, yourAnswer: string, otherAnswer: string): string {
  return [
    `Original question: ${originalQ}`,
    '',
    `Your previous final answer was: "${yourAnswer}"`,
    `Another analyst's answer was: "${otherAnswer}"`,
    '',
    "If the other analyst's answer makes you reconsider, give a new final answer (TL;DR + Analysis as before; Don't reference previous answer at all). If you still agree with your previous answer, restate it.",
  ].join('\n');
}

/**
 * Build the synthetic `AssistantMessage` returned by
 * `DoubleCheckBenchmarkAgent.run()`. The orchestrator pushes this to
 * the log via `appendAgentResult` (with `parent_id` set to our root
 * invocation id) — no manual log mutation required here.
 */
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
