/**
 * Pure credit math — the single source of truth for turning LLM usage into credits.
 *
 * Kept free of `server-only` so it can run in unit tests and (potentially) the
 * client. The 4-arg signature intentionally exposes the token breakdown so the
 * formula can evolve (e.g. per-token-type rates) WITHOUT changing any caller.
 */
import { CREDIT_BUDGETS, type CreditWeights } from './credit-budgets';
import type { CreditScope, CreditWindow } from './credits.types';

export interface CostToCreditsInput {
  /** LLM provider (e.g. 'openai', 'anthropic', 'amazon-bedrock'). For future per-provider rates. */
  provider?: string;
  /** Model id. For future per-model rates. */
  model?: string;
  cachedTokens: number;
  nonCachedTokens: number;
  outputTokens: number;
  /** Number of LLM requests in this group (flat per-call charge). */
  requests?: number;
  /** USD cost recorded per LLM call (from the LLM SDK usage object). */
  cost: number;
}

/**
 * Credits as a weighted sum of cost + token buckets + request count. The
 * `weights` come from the effective credit config (env-overridable); callers
 * that don't pass them use the CREDIT_BUDGETS defaults (v0: credits = cost × 1000).
 */
export function costToCredits(input: CostToCreditsInput, weights: CreditWeights = CREDIT_BUDGETS.weights): number {
  return (
    input.cost * weights.cost +
    input.nonCachedTokens * weights.nonCachedTokens +
    input.cachedTokens * weights.cachedTokens +
    input.outputTokens * weights.outputTokens +
    (input.requests ?? 0) * weights.requests
  );
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
