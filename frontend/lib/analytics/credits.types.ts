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
  /** Credits attributed to this group via `costToCredits`. */
  credits: number;
}

/** A single billing scope (an individual user, or the whole org). */
export interface CreditScope {
  /** Total credits consumed this calendar month. */
  used: number;
  /** Monthly credit allowance for this scope. */
  allowance: number;
  /** Per (provider, model) breakdown, sorted by credits desc. */
  rows: CreditBreakdownRow[];
}

/**
 * Usage payload returned by `GET /api/credits/usage`.
 * `org` is only populated for admins (org totals across all users).
 */
export interface CreditUsageResponse {
  individual: CreditScope;
  org: CreditScope | null;
}
