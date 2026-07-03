/**
 * Pure credit math — the single source of truth for turning LLM usage into credits.
 *
 * Kept free of `server-only` so it can run in unit tests and (potentially) the
 * client. The 4-arg signature intentionally exposes the token breakdown so the
 * formula can evolve (e.g. per-token-type rates) WITHOUT changing any caller.
 */

import { CREDIT_BUDGETS } from './credit-budgets';

export interface CostToCreditsInput {
  cachedTokens: number;
  nonCachedTokens: number;
  outputTokens: number;
  /** USD cost recorded per LLM call (from the LLM SDK usage object). */
  cost: number;
}

/**
 * v0: credits = cost * CREDIT_BUDGETS.creditsPerDollar (1 credit = $0.001).
 * Tokens are accepted but unused for now — the formula will be refined later.
 */
export function costToCredits(input: CostToCreditsInput): number {
  return input.cost * CREDIT_BUDGETS.creditsPerDollar;
}
