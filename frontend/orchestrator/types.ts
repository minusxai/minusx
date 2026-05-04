import type { Model } from '@mariozechner/pi-ai';
import type { ConversationLogEntry } from './conversation';

export interface RunContext {
  model?: Model<any>;
  contextArgs?: Record<string, unknown>;
  signal?: AbortSignal;
}

/**
 * Discriminated union returned by every Tool's run() method.
 *
 * - `success`  — tool ran to completion. `content` is the payload (string or dict)
 *                that the LLM sees as the tool result.
 * - `pending`  — tool needs user input or other out-of-process work to complete.
 *                Triggers loop termination. `pending` carries data the frontend
 *                needs to render UI (the question, options, file diff, etc.).
 * - `failure`  — tool ran but produced a recoverable error. `error` is the
 *                message shown to both the LLM (via isError tool result) and the user.
 */
export type ToolResult =
  | { state: 'success'; content: string | Record<string, unknown> }
  | { state: 'pending'; pending: Record<string, unknown> }
  | { state: 'failure'; error: string };

/**
 * A child task created during a runAgent run that hasn't yet received a result.
 * Returned in `AgentResult.pendingTools` so the caller (route.ts / SSE handler)
 * can present the pending UI and post answers back on the next turn.
 */
export interface PendingToolCall {
  toolCallId: string;
  toolName: string;
  /** The original args the LLM passed to the tool. */
  args: Record<string, unknown>;
  /** The pending payload from the tool's run() result. */
  pending: Record<string, unknown>;
}

/**
 * Result returned by `runAgent`. Mirrors the tool-level `ToolResult` shape so
 * callers can switch on `state` uniformly.
 *
 * `success.truncated` is `true` when the response is incomplete due to either:
 *   - The LLM hit its max output token limit (stopReason === 'length'), or
 *   - The agent's `shouldStopAfterTurn` returned true while the LLM still wanted
 *     to call more tools (stopReason === 'toolUse'). Typically this means
 *     `maxTurns` was reached mid-conversation.
 */
export type AgentResult =
  | { state: 'success'; content: string; truncated: boolean; logDiff: ConversationLogEntry[] }
  | { state: 'pending'; pendingTools: PendingToolCall[]; logDiff: ConversationLogEntry[] }
  | { state: 'failure'; error: string; logDiff: ConversationLogEntry[] };
