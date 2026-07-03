/**
 * Credits / billing usage contracts.
 *
 * Shared by the server aggregation (`credit-usage.server.ts`), the API route,
 * the settings card, and tests — so this module MUST stay free of `server-only`.
 */

/** One (provider, model, trigger) usage group within the current calendar month. */
export interface CreditBreakdownRow {
  /** '' when the stored provider was NULL (render as '—'). */
  provider: string;
  model: string;
  /** Surface/source: explore/question/dashboard/slack, a micro-task key, or '' when unset. */
  trigger: string;
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
