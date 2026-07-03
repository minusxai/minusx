import 'server-only';
import { getModules } from '@/lib/modules/registry';
import { costToCredits } from './credits';
import {
  BILLING_CYCLE, RESET_CYCLE,
  resolveIndividualAllowance, resolveOrgAllowance,
  resolveIndividualResetAllowance, resolveOrgResetAllowance,
} from '@/lib/config';
import { UNKNOWN_TRIGGER, type CreditBreakdownRow, type CreditScope, type CreditUsageResponse } from './credits.types';

/**
 * Aggregate credit usage from `llm_call_events` over two DECOUPLED rolling
 * windows: the longer BILLING cycle (which carries the breakdown) and a shorter
 * RESET cycle (e.g. a daily cap). Both are rolling (`created_at >= NOW() - Nd`),
 * with the day counts configured in `lib/config.ts` (BILLING_CYCLE / RESET_CYCLE).
 *
 * Both conversation-bound chat turns AND headless runs (micro-tasks, Slack,
 * feed-summary, eval) record into this table, so it is the complete usage
 * ledger. Credits are computed in JS via `costToCredits` (the single source of
 * truth). The reset window is a subset of the billing window, so a single query
 * computes both — the reset total via a FILTER on the same rows.
 */

// Non-cached input = prompt_tokens - cached_tokens, floored at 0 (GREATEST).
// Numeric aggregates come back as strings — always Number()-wrap.
// Params: $1 = reset-window days, $2 = billing-window days, ($3 = user_id when scoped).
const usageSql = (userFilter: string) => `
SELECT
  COALESCE(provider, '')                                                     AS provider,
  model                                                                      AS model,
  COALESCE(NULLIF(trigger, ''), 'unknown')                                   AS trigger,
  SUM(GREATEST(COALESCE(prompt_tokens, 0) - COALESCE(cached_tokens, 0), 0))  AS "nonCachedInputTokens",
  SUM(COALESCE(cached_tokens, 0))                                            AS "cachedTokens",
  SUM(COALESCE(completion_tokens, 0))                                        AS "outputTokens",
  SUM(COALESCE(cost, 0))                                                     AS cost,
  SUM(COALESCE(cost, 0)) FILTER (WHERE created_at >= NOW() - ($1 * INTERVAL '1 day')) AS "resetCost"
FROM llm_call_events
WHERE created_at >= NOW() - ($2 * INTERVAL '1 day')
  ${userFilter}
GROUP BY COALESCE(provider, ''), model, COALESCE(NULLIF(trigger, ''), 'unknown')
ORDER BY cost DESC
`;

async function loadScope(billingAllowance: number, resetAllowance: number, userId?: number): Promise<CreditScope> {
  const db = getModules().db;
  const params: number[] = [RESET_CYCLE.days, BILLING_CYCLE.days];
  const sql = userId === undefined ? usageSql('') : usageSql('AND user_id = $3');
  if (userId !== undefined) params.push(userId);
  const result = await db.exec<Record<string, unknown>>(sql, params);

  let billingUsed = 0;
  let resetUsed = 0;
  const rows: CreditBreakdownRow[] = result.rows.map((row) => {
    const nonCachedInputTokens = Number(row['nonCachedInputTokens'] ?? 0);
    const cachedTokens = Number(row['cachedTokens'] ?? 0);
    const outputTokens = Number(row['outputTokens'] ?? 0);
    const cost = Number(row['cost'] ?? 0);
    const resetCost = Number(row['resetCost'] ?? 0);
    const credits = costToCredits({ cachedTokens, nonCachedTokens: nonCachedInputTokens, outputTokens, cost });
    billingUsed += credits;
    resetUsed += costToCredits({ cachedTokens, nonCachedTokens: nonCachedInputTokens, outputTokens, cost: resetCost });
    return {
      provider: String(row['provider'] ?? ''),
      model: String(row['model'] ?? ''),
      trigger: String(row['trigger'] ?? UNKNOWN_TRIGGER),
      nonCachedInputTokens,
      cachedTokens,
      outputTokens,
      credits,
    };
  });

  return {
    billing: { label: BILLING_CYCLE.label, used: billingUsed, allowance: billingAllowance, rows },
    reset: { label: RESET_CYCLE.label, used: resetUsed, allowance: resetAllowance },
  };
}

/**
 * Credit usage for a user across the billing + reset windows.
 * @param includeOrg when true, also returns org-wide totals (admins only — gated by the caller).
 */
export async function getCreditUsage(
  userId: number,
  role: string,
  includeOrg: boolean,
): Promise<CreditUsageResponse> {
  const individual = await loadScope(resolveIndividualAllowance(role), resolveIndividualResetAllowance(role), userId);
  const org = includeOrg ? await loadScope(resolveOrgAllowance(), resolveOrgResetAllowance()) : null;
  return { individual, org };
}
