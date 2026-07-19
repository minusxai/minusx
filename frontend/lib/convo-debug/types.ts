/**
 * Conversation-debug contracts (the `/debug` visualization).
 *
 * The deep module `lib/convo-debug/` converts a conversation — either the
 * server-side projection preview ("Projected" logs) or the exact recorded LLM
 * request ("Raw" logs) — into an array of {@link TurnBar}s: one bar per turn,
 * matching exactly how prompt-caching cost accrues. Each bar carries a
 * one-level component breakdown (tokens approximated at chars/4 for text and
 * (w×h)/750 for images) and ONE cost annotation with both an `expected` slice
 * (approx tokens × per-model catalog rates under the clean-prefix caching
 * model) and an `actual` slice (the recorded per-call `usage`).
 *
 * Caching model: call i's cached input = the full input of call i−1 (the
 * provider cache covers the prefix written by the previous call); uncached
 * input = the previous call's assistant output + everything appended since
 * (tool results, or app state + next user message). Call 0 is fully uncached.
 *
 * Sub-agents are flattened by the ROOT thread: bars model only the root
 * agent's wire context; sub-agent LLM calls surface as a synthetic
 * `SubAgentLLM` component on the tool-result bar they ran under and are
 * included in ACTUAL totals (their own wire contexts are not visualized).
 *
 * Known approximations (why Expected ≠ Actual, beyond chars/4):
 * - Projected mode uses the FINAL FacetMemo projection; historical calls saw
 *   fuller (uncollapsed) earlier turns, so expected input slightly
 *   undercounts. The Raw toggle exists precisely to measure this gap.
 * - The expected split assumes clean Anthropic prefix caching; providers
 *   without caching surface as cacheRead rate == input rate.
 */
import type { Message, Usage } from '@/orchestrator/llm';
import type { ConversationLog } from '@/orchestrator/types';

export type BarType = 'input' | 'assistant' | 'toolResults';

export type ComponentType =
  | 'SystemPrompt'
  | 'ToolDefinitions'
  | 'AppStateText'
  | 'AppStateImage'
  | 'FileMarkup'
  | 'QueryData'
  | 'UserText'
  | 'UserImages'
  | 'Other'
  | 'Thinking'
  | 'Text'
  | 'ToolCalls'
  | 'ToolResult'
  | 'SubAgentLLM';

/** Read-only content carried for the inspect modal. Pure data, React-free. */
export type InspectableContent =
  | { kind: 'text'; text: string }
  | { kind: 'image'; src: string }
  | { kind: 'json'; value: unknown };

export interface BarComponent {
  type: ComponentType;
  /** For ToolCalls / ToolResult / SubAgentLLM components: the tool name. */
  toolName?: string;
  /** For ToolCalls / ToolResult / SubAgentLLM components: the tool call id
   *  (SubAgentLLM: the root-level invocation the sub-agent ran under). */
  toolCallId?: string;
  /** Approximate token count (text chars/4; images (w×h)/750). */
  tokens: number;
  /** The image share of `tokens` (drives the text vs image totals split). */
  imageTokens: number;
  chars: number;
  imageCount: number;
  content: InspectableContent[];
}

/** A cached/uncached input slice with its (rate-dependent) dollar costs. */
export interface CostSlice {
  cachedTokens: number;
  uncachedTokens: number;
  /** Null when no rates are available for the call's model. */
  cachedUsd: number | null;
  uncachedUsd: number | null;
  totalUsd: number | null;
}

export type BarCost =
  | {
      kind: 'input';
      /** Expected slice from approx tokens + the caching model. */
      expected: CostSlice;
      /** Recorded slice from the call's usage; null if the call never ran /
       *  wasn't recorded (e.g. the trailing hypothetical next turn). */
      actual: CostSlice | null;
    }
  | {
      kind: 'output';
      expected: { tokens: number; totalUsd: number | null };
      actual: { tokens: number; totalUsd: number } | null;
    };

export interface TurnBar {
  index: number;
  type: BarType;
  /** Display label, e.g. "System + User #1", "Assistant (call 2)". */
  label: string;
  /** One level only — no nested components. */
  components: BarComponent[];
  /** Sum of component tokens. */
  tokens: number;
  /** The 0-based LLM call this bar's cost belongs to: input/toolResults bars →
   *  the call they trigger; assistant bars → the call that produced them.
   *  Trailing input bars after the last assistant get lastCall+1 (the
   *  hypothetical next call — feeds Expected Next Cost). */
  callIndex: number;
  cost: BarCost;
}

/** $/token rates for one model (catalog per-Mtok pricing ÷ 1e6). */
export interface TokenRates {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** Rates keyed by model id; null = unknown model (tokens-only display). */
export type ModelRates = Record<string, TokenRates | null>;

/** One recorded LLM call, extracted from the conversation log. */
export interface ActualCallRecord {
  callId: string | null;
  model: string;
  usage: Usage;
  /** True when the call's parent chain does not reach the root agent. */
  isSubAgent: boolean;
  /** For sub-agent calls: the root-level tool invocation they ran under. */
  rootToolName?: string;
  /** For sub-agent calls: that invocation's tool call id. */
  rootToolCallId?: string;
}

export interface ConvoDebugTotals {
  /** Sum of expected input+output cost across root calls (+ Expected Next is
   *  NOT included). Null when no rates resolve for any call. */
  expectedTotalUsd: number | null;
  /** Sum of recorded usage.cost.total across ALL calls (incl. sub-agents). */
  actualTotalUsd: number;
  /** Expected cost of the next call assuming a 0-length next user message. */
  expectedNextUsd: number | null;
  /** Actual token sums across all recorded calls. */
  cachedInputTokens: number;
  uncachedInputTokens: number;
  outputTokens: number;
  /** Expected (approx) token split of the full current context. */
  expectedTextTokens: number;
  expectedImageTokens: number;
}

/** Normalized input — both data sources (Projected / Raw) produce this. */
export interface ConvoDebugInput {
  systemPrompt: string;
  /** Serialized size of the tool definitions (JSON chars). */
  toolDefsChars: number;
  /** The root thread's wire messages, in request order. */
  messages: Message[];
  /** The verbatim conversation log (usage / call ids / sub-agent detection). */
  log: ConversationLog;
  /** Per-model $/token rates (server catalog; usage-derived fallback). */
  rates: ModelRates;
}

export interface ConvoDebugModel {
  bars: TurnBar[];
  calls: ActualCallRecord[];
  rates: ModelRates;
  totals: ConvoDebugTotals;
}
