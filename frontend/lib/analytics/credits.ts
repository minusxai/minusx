/**
 * Pure credit math — the single source of truth for turning LLM usage into credits.
 *
 * Kept free of `server-only` so it can run in unit tests and (potentially) the
 * client. The 4-arg signature intentionally exposes the token breakdown so the
 * formula can evolve (e.g. per-token-type rates) WITHOUT changing any caller.
 */

export interface CostToCreditsInput {
  cachedTokens: number;
  nonCachedTokens: number;
  outputTokens: number;
  /** USD cost recorded per LLM call (from the LLM SDK usage object). */
  cost: number;
}

/** v0 conversion rate — WIP, will be refined. 1 credit = $0.001. */
const CREDITS_PER_DOLLAR = 1000;

/**
 * v0: credits = cost * CREDITS_PER_DOLLAR. Tokens are accepted but unused for
 * now — this formula is still being workshopped, hence it lives here next to the
 * function rather than in the stable CREDIT_BUDGETS knobs.
 */
export function costToCredits(input: CostToCreditsInput): number {
  return input.cost * CREDITS_PER_DOLLAR;
}
