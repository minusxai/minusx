// Cross-check controller: runs two `BenchmarkAnalystAgent` instances in
// parallel as tool calls, judges their final answers via a `CheckEquivalence`
// tool, and (on disagreement) retries once with cross-feedback. Toggled by
// `DAB_DOUBLE_CHECK=1` in the benchmark CLI. See `frontend/benchmarks/README.md`.
//
// The whole flow is hand-rolled TS — no LLM drives the controller; the
// only LLM cost is inside the four sub-agent runs and the two judge
// calls. Each step is dispatched via the orchestrator's normal
// `dispatch()` (the same path the LLM-driven loop uses), so the log on
// disk has the natural orchestrator log shape (assistant turn → toolCall → toolResult,
// all `parent_id`-chained).
//
// Resumability: every dispatched toolCall uses a deterministic slot id
// (`r1-agent1`, `r1-check`, …). On resume, `MXAgent.toolThread` is
// rebuilt from the log via `Orchestrator.reconstructAgent`; `run()`
// reads it slot-by-slot and only dispatches the missing slots. A run
// that died mid-way picks up from the last completed slot instead of
// re-burning prior sub-agent runs.
import 'server-only';
import { Type } from 'typebox';
import type { Tool } from '@/orchestrator/llm';
import type { AssistantMessage, Context, Message, TextContent, ToolResultMessage } from '@/orchestrator/llm';
import { MXAgent, MXTool, type ToolResponse, type MXAgentDetails } from '@/orchestrator/types';
import { getModel } from '@/orchestrator/llm';
import { BenchmarkAnalystAgent } from './benchmark-analyst';
import type { BenchmarkAnalystContext } from './types';

/** Dedicated judge model — always Opus, independent of the analyst model config. */
let judgeModel = getModel('anthropic', 'claude-opus-4-7');

/** Override the judge model (for tests). Returns the previous model. */
export function setJudgeModel(m: typeof judgeModel): typeof judgeModel {
  const prev = judgeModel;
  judgeModel = m;
  return prev;
}

// ─── Slot ids & round budget ──────────────────────────────────────────────
// Stable across resumes; uniquely identify each dispatched toolCall within
// a single DoubleCheck run. Round 1 is the initial pair; rounds
// 2..MAX_ROUNDS are feedback retries (each seeded with the full prior
// per-side history concatenated). If MAX_ROUNDS rounds fail to agree,
// the controller returns the last round's agent-1 answer as a best-effort
// candidate (the cross-check disagreement is still visible to downstream
// consumers via the final `rN-check` toolResult's `equivalent: false`).
const MAX_ROUNDS = 3;
const slotIds = (round: number) => ({
  agent1: `r${round}-agent1`,
  agent2: `r${round}-agent2`,
  check:  `r${round}-check`,
});

// ─── CheckEquivalence tool ────────────────────────────────────────────────

const CheckEquivalenceParams = Type.Object({
  question: Type.String(),
  answerA: Type.String(),
  answerB: Type.String(),
});

interface CheckEquivalenceDetails extends Record<string, unknown> {
  equivalent: boolean;
  /** Full LLM verdict including the one-sentence reason. */
  reason: string;
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
    description: 'Compares two analyst answers to the same question and decides whether they are semantically equivalent. Returns {equivalent: boolean, reason: string}.',
    parameters: CheckEquivalenceParams,
  };

  async run(): Promise<ToolResponse<CheckEquivalenceDetails>> {
    const { question, answerA, answerB } = this.parameters;
    const judgeCtx: Context = {
      systemPrompt:
        `You compare two analyst answers to the same question and decide whether they are semantically equivalent (same factual content / same TL;DR). Reply with EQUIVALENT or DIFFERENT followed by a one-sentence explanation.
        ## Guidelines for judging equivalence:
        - Agent A is the main agent, agent B is the challenger.
        - They may not obviously have exactly the same wording, but if they convey the same information and reach the same conclusion, they are equivalent.
        - If they have mutually exclusive extra information but the core answer is the same, they are equivalent
        - If they reach wildly different conclusions, they are different.
        ## Response format:
        EQUIVALENT
        Reason: <one sentence reason>
        or
        DIFFERENT
        Reason: <one sentence reason>`,
      messages: [
        {
          role: 'user',
          content: `Question: ${question}\n\nAnswer A: ${answerA}\n\nAnswer B: ${answerB}\n\nAre these answers semantically equivalent?`,
          timestamp: Date.now(),
        },
      ],
      tools: [],
    };
    const verdictMsg = await this.orchestrator.callLLM(judgeModel, judgeCtx, this.id);
    const reason = extractText(verdictMsg).trim();
    const upper = reason.toUpperCase();
    const equivalent = upper.startsWith('EQUIVALENT')
      || (upper.includes('EQUIVALENT') && !upper.includes('DIFFERENT'));
    const details: CheckEquivalenceDetails = { equivalent, reason };
    return {
      content: [{ type: 'text', text: JSON.stringify({ equivalent, reason }) }],
      isError: false,
      details,
    };
  }
}

// ─── DoubleCheckBenchmarkAgent ────────────────────────────────────────────

const DoubleCheckBenchmarkAgentParams = Type.Object({
  userMessage: Type.String(),
});

/**
 * Minimal shape for a sub-agent class: just `static schema.name`. Anything
 * the orchestrator can dispatch by name fits — V1 (`BenchmarkAnalystAgent`),
 * V2 (`V2BenchmarkAnalystAgent`), or future variants — without forcing TS
 * variance reasoning over the parent's generic context parameter.
 */
export type AnalystAgentClass = { readonly schema: { name: string } };

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
 * Returns the consensus answer once judges agree, or the last round's
 * agent-1 answer if no consensus is reached within `MAX_ROUNDS`.
 */
export class DoubleCheckBenchmarkAgent extends MXAgent<
  typeof DoubleCheckBenchmarkAgentParams,
  BenchmarkAnalystContext
> {
  static readonly schema: Tool<typeof DoubleCheckBenchmarkAgentParams> = {
    name: 'DoubleCheckBenchmarkAgent',
    description:
      'Runs two analyst sub-agents (`primaryAgent` + `secondaryAgent`) in parallel; on disagreement, retries with cross-feedback for up to MAX_ROUNDS-1 more rounds; returns the consensus answer, or the last round\'s primary-agent answer if no consensus is reached.',
    parameters: DoubleCheckBenchmarkAgentParams,
  };
  // No LLM-driven tools — `run()` is hand-rolled.
  static readonly tools = [];

  /**
   * Sub-agent classes spawned in parallel each round. Both default to
   * `BenchmarkAnalystAgent` (the V1 analyst). Subclass and override these
   * to plug in a different analyst — e.g. `V2BenchmarkAnalystAgent` — or
   * to run a cross-version cross-check (primary != secondary).
   *
   * Typed as `AnalystAgentClass` (minimal shape: a class with
   * `static schema.name`) so the field accepts both V1 and V2 analyst
   * classes without TS variance pain over `BenchmarkAnalystAgent`'s
   * generic context param. The controller only reads `.schema.name`; the
   * orchestrator's registrables resolve that name to a concrete class +
   * model at dispatch time.
   *
   * On no consensus after MAX_ROUNDS, the `primaryAgent`'s last answer is
   * returned as the best-effort candidate (the cross-check disagreement
   * is still visible in the final `rN-check` toolResult).
   */
  static primaryAgent: AnalystAgentClass = BenchmarkAnalystAgent;
  static secondaryAgent: AnalystAgentClass = BenchmarkAnalystAgent;

  // Inherits provider/model from `BenchmarkAnalystAgent` so the judge
  // and any future LLM calls use the same model as the analyst sub-agents.
  static model = BenchmarkAnalystAgent.model;

  protected override getSystemPrompt(): string {
    // Unused — `run()` is overridden and never calls `this.llm()`.
    return '';
  }

  override async run(): Promise<AssistantMessage> {
    const { userMessage } = this.parameters;
    const Ctor = this.constructor as typeof DoubleCheckBenchmarkAgent;
    const primaryName = Ctor.primaryAgent.schema.name;
    const secondaryName = Ctor.secondaryAgent.schema.name;

    // ── Round 1 — two analysts, no feedback, no history seeding ─────────
    const r1 = slotIds(1);
    await this._dispatchSlots(
      [
        { name: primaryName, args: { userMessage }, id: r1.agent1 },
        { name: secondaryName, args: { userMessage }, id: r1.agent2 },
      ],
      undefined,
      // Slot the two analysts into distinct catalog-cache keys. The V2
      // sub-agents read this from `context.catalogKey` to pick which
      // sample_rows / sample_notes view of the catalog they see — input-
      // level diversity so the two analysts don't converge on the same
      // data-shape misreading. V1 sub-agents simply ignore the field.
      {
        [r1.agent1]: { catalogKey: 'agent-a' },
        [r1.agent2]: { catalogKey: 'agent-b' },
      },
    );
    let t1 = this._readAgentText(r1.agent1);
    let t2 = this._readAgentText(r1.agent2);
    let j1 = this._readAgentSubmission(r1.agent1)?.justification ?? '';
    let j2 = this._readAgentSubmission(r1.agent2)?.justification ?? '';

    await this._dispatchSlots([{
      name: CheckEquivalence.schema.name,
      args: { question: userMessage, answerA: t1, answerB: t2 },
      id: r1.check,
    }]);
    if (this._readEquivalence(r1.check)) return synthesiseFinal(t1);

    // ── Feedback rounds 2..MAX_ROUNDS ───────────────────────────────────
    // Each subsequent round's analysts inherit the **full** prior
    // conversation as `threadHistory` — the per-side concatenation of
    // every prior round's `extractAgentHistory`. The new user turn is a
    // feedback prompt embedding both prior-round answers; `MXAgent.buildMessages`
    // assembles it as: threadHistory ++ user(feedback) ++ toolThread.
    // After MAX_ROUNDS without consensus, give up.
    const priorHistories1: Message[][] = [this.orchestrator.extractAgentHistory(r1.agent1)];
    const priorHistories2: Message[][] = [this.orchestrator.extractAgentHistory(r1.agent2)];

    for (let round = 2; round <= MAX_ROUNDS; round++) {
      const slots = slotIds(round);
      const fb1 = buildFeedbackPrompt(userMessage, t1, t2, j1, j2);
      const fb2 = buildFeedbackPrompt(userMessage, t2, t1, j2, j1);

      await this._dispatchSlots(
        [
          { name: primaryName, args: { userMessage: fb1 }, id: slots.agent1 },
          { name: secondaryName, args: { userMessage: fb2 }, id: slots.agent2 },
        ],
        {
          [slots.agent1]: priorHistories1.flat(),
          [slots.agent2]: priorHistories2.flat(),
        },
        // Same `catalogKey` slots as round 1 so each analyst hits its own
        // cached catalog instance (no rebuild) and keeps reading from its
        // own slot's sample rows.
        {
          [slots.agent1]: { catalogKey: 'agent-a' },
          [slots.agent2]: { catalogKey: 'agent-b' },
        },
      );
      t1 = this._readAgentText(slots.agent1);
      t2 = this._readAgentText(slots.agent2);
      j1 = this._readAgentSubmission(slots.agent1)?.justification ?? '';
      j2 = this._readAgentSubmission(slots.agent2)?.justification ?? '';

      await this._dispatchSlots([{
        name: CheckEquivalence.schema.name,
        args: { question: userMessage, answerA: t1, answerB: t2 },
        id: slots.check,
      }]);
      if (this._readEquivalence(slots.check)) return synthesiseFinal(t1);

      // Captured AFTER the equivalence check fails — only used by the
      // next round's threadHistory, which won't run if we just exited.
      priorHistories1.push(this.orchestrator.extractAgentHistory(slots.agent1));
      priorHistories2.push(this.orchestrator.extractAgentHistory(slots.agent2));
    }

    // No consensus after MAX_ROUNDS. Return the last round's agent-1
    // answer rather than a hardcoded failure string — even without
    // agreement between the two analysts, the most recently revised
    // answer is a real candidate the downstream validator can judge
    // (and it might still be correct). The cross-check signal is
    // available to evaluators via the `r3-check` toolResult details
    // (`equivalent: false`) if they want to discount disagreement.
    return synthesiseFinal(t1);
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
    contextOverridesByToolCallId?: Record<string, Record<string, unknown>>,
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
    const opts: {
      threadHistoryByToolCallId?: Record<string, Message[]>;
      contextOverridesByToolCallId?: Record<string, Record<string, unknown>>;
    } = {};
    if (threadHistoryByToolCallId) opts.threadHistoryByToolCallId = threadHistoryByToolCallId;
    if (contextOverridesByToolCallId) opts.contextOverridesByToolCallId = contextOverridesByToolCallId;
    await this.orchestrator.dispatch(
      synthMsg,
      this,
      Object.keys(opts).length > 0 ? opts : undefined,
    );
  }

  private _findResult(slotId: string): ToolResultMessage | undefined {
    return this.toolThread.find(
      (m): m is ToolResultMessage =>
        'role' in m && m.role === 'toolResult' && m.toolCallId === slotId,
    );
  }

  /**
   * Read a sub-agent slot's answer. Prefers the `SubmitAnswer` tool result
   * (compact, eval-optimised string) over the verbose `assistantMessage`
   * text. Falls back to the assistant message when no `SubmitAnswer` was
   * called (e.g. V2 agents that don't have the tool yet).
   */
  private _readAgentText(slotId: string): string {
    const submitted = this._readSubmittedAnswer(slotId);
    if (submitted) return submitted.answer;

    const r = this._findResult(slotId);
    if (!r) throw new Error(`DoubleCheckBenchmarkAgent: no result for slot '${slotId}'`);
    const details = r.details as MXAgentDetails | undefined;
    if (details?.type !== 'mx_agent') {
      throw new Error(`DoubleCheckBenchmarkAgent: slot '${slotId}' is not an MXAgent result`);
    }
    return extractText(details.assistantMessage);
  }

  /**
   * Read a sub-agent slot's answer and justification. Returns both fields
   * from the last `SubmitAnswer` tool result, or `undefined` if the
   * sub-agent never called `SubmitAnswer`.
   */
  private _readAgentSubmission(slotId: string): { answer: string; justification: string } | undefined {
    return this._readSubmittedAnswer(slotId) ?? undefined;
  }

  /**
   * Scan the orchestrator log for a `SubmitAnswer` tool result under the
   * given sub-agent slot. Returns the submitted answer and justification,
   * or `undefined` if the sub-agent never called `SubmitAnswer`.
   *
   * The log is flat: each entry has `parent_id`. Tool calls dispatched by
   * a sub-agent have `parent_id === slotId`. We find the `AssistantMessage`
   * entries under `slotId`, look for `SubmitAnswer` tool calls in them,
   * then find the matching `ToolResultMessage` and extract details.
   */
  private _readSubmittedAnswer(slotId: string): { answer: string; justification: string } | undefined {
    const log = this.orchestrator.log;
    // Find SubmitAnswer toolCall ids under this sub-agent.
    const submitCallIds: string[] = [];
    for (const e of log) {
      if (e.parent_id !== slotId) continue;
      if (!('role' in e) || e.role !== 'assistant') continue;
      for (const block of (e as AssistantMessage).content) {
        if (block.type === 'toolCall' && block.name === 'SubmitAnswer') {
          submitCallIds.push(block.id);
        }
      }
    }
    if (submitCallIds.length === 0) return undefined;
    // Take the LAST SubmitAnswer call (the agent may revise its answer).
    const lastCallId = submitCallIds[submitCallIds.length - 1];
    for (const e of log) {
      if (!('role' in e) || e.role !== 'toolResult') continue;
      if ((e as ToolResultMessage).toolCallId !== lastCallId) continue;
      const details = (e as ToolResultMessage).details as { answer?: string; justification?: string } | undefined;
      if (details?.answer) return { answer: details.answer, justification: details.justification ?? '' };
    }
    return undefined;
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
function buildFeedbackPrompt(originalQ: string, yourAnswer: string, otherAnswer: string, yourJustification: string, otherJustification: string): string {
  const lines = [
    `Original question: ${originalQ}`,
    '',
    `Your previous final answer was: "${yourAnswer}"`,
  ];
  if (yourJustification) lines.push(`Your justification: "${yourJustification}"`);
  lines.push(`Another analyst's answer was: "${otherAnswer}"`);
  if (otherJustification) lines.push(`Their justification: "${otherJustification}"`);
  lines.push(
    '',
    "If the other analyst's answer and justification make you reconsider, give a new final answer (TL;DR + Analysis as before at the top before anything else; Put all comparisons and justification at the bottom under a 'Justification' section). If you still agree with your previous answer, restate it.",
  );
  return lines.join('\n');
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
