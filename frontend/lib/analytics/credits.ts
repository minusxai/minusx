/**
 * Pure credit math — the single source of truth for turning LLM usage into credits.
 *
 * Kept free of `server-only` so it can run in unit tests and (potentially) the
 * client. The 4-arg signature intentionally exposes the token breakdown so the
 * formula can evolve (e.g. per-token-type rates) WITHOUT changing any caller.
 */
import type { CreditScope, CreditWindow } from './credits.types';

export interface CostToCreditsInput {
  /** LLM provider (e.g. 'openai', 'anthropic', 'amazon-bedrock'). For future per-provider rates. */
  provider?: string;
  /** Model id. For future per-model rates. */
  model?: string;
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

/** Credits left in one window (allowance − used, floored at 0). */
export function remainingInWindow(window: CreditWindow): number {
  return Math.max(0, window.allowance - window.used);
}

export interface RemainingCredits {
  /** Credits remaining in the current credit (reset) cycle. */
  reset: number;
  /** Credits remaining in the current billing cycle. */
  billing: number;
}

/**
 * Remaining credits for a scope in both cycles. Each is floored at 0 (a window
 * over its allowance reports 0 remaining, not a negative). The effective amount
 * a user can still spend is `min(reset, billing)`.
 */
export function remainingCredits(scope: CreditScope): RemainingCredits {
  return {
    reset: remainingInWindow(scope.reset),
    billing: remainingInWindow(scope.billing),
  };
}
