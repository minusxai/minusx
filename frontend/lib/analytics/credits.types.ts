/**
 * Credits / billing usage contracts.
 *
 * Shared by the server aggregation (`credit-usage.server.ts`), the API route,
 * the settings card, and tests — so this module MUST stay free of `server-only`.
 */

/**
 * What initiated an LLM call, recorded in `llm_call_events.trigger`. Either a
 * conversation SURFACE (where the chat ran) or a headless micro-task key. Never
 * empty — unresolved/legacy calls normalize to `'unknown'` (see UNKNOWN_TRIGGER).
 */
export type LlmCallTrigger =
  // Conversation surfaces (from getPageType)
  | 'explore' | 'question' | 'dashboard' | 'notebook' | 'report' | 'folder' | 'slack'
  // Headless micro-task keys (MICRO_TASKS)
  | 'title' | 'description' | 'feed_summary' | 'rubric_llm'
  // Fallback for legacy rows / unresolved surfaces
  | 'unknown'
  // Allow forward-compatible values (new surfaces / micro-tasks) without a type bump
  | (string & {});

/** Fallback trigger — used at write and read time so `trigger` is never empty. */
export const UNKNOWN_TRIGGER = 'unknown';

/** One (provider, model, trigger) usage group within the current calendar month. */
export interface CreditBreakdownRow {
  /** '' when the stored provider was NULL (render as '—'). */
  provider: string;
  model: string;
  /** Surface/source: a conversation surface, a micro-task key, or 'unknown'. Never empty. */
  trigger: LlmCallTrigger;
  /** prompt_tokens - cached_tokens, floored at 0. */
  nonCachedInputTokens: number;
  cachedTokens: number;
  /** completion_tokens. */
  outputTokens: number;
  /** Number of LLM requests (calls) in this group. */
  requests: number;
  /** Credits attributed to this group via `costToCredits`. */
  credits: number;
}

/** One usage window (a billing or reset cycle) for a scope: used vs. allowance. */
export interface CreditWindow {
  /** Human label for the window, e.g. 'this month', 'today'. */
  label: string;
  /** Credits consumed within this window. */
  used: number;
  /** Credit allowance for this window. */
  allowance: number;
  /** ISO timestamp when this window next resets (calendar mode); null when rolling. */
  resetsAt: string | null;
}

/**
 * A billing scope (an individual user, or the whole org) with two DECOUPLED
 * rolling windows: the longer `billing` cycle (which carries the per-(provider,
 * model, trigger) breakdown) and a shorter `reset` cycle (e.g. a daily cap).
 */
export interface CreditScope {
  billing: CreditWindow & { rows: CreditBreakdownRow[] };
  reset: CreditWindow;
}

/**
 * Usage payload returned by `GET /api/credits/usage`.
 * `org` is only populated for admins (org totals across all users).
 */
export interface CreditUsageResponse {
  individual: CreditScope;
  org: CreditScope | null;
  /** Whether the credits module is on (tracked + enforced). */
  enabled: boolean;
  /** Credits used by the requested conversation (present only when `?conversationId=` was passed). */
  conversation?: { credits: number } | null;
}
