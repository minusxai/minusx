import 'server-only';
import { getModules } from '@/lib/modules/registry';
import { costToCredits } from './credits';
import {
  BILLING_CYCLE, RESET_CYCLE,
  resolveIndividualAllowance, resolveOrgAllowance,
  resolveIndividualResetAllowance, resolveOrgResetAllowance,
} from '@/lib/config';
import { cycleStartSql, cycleNextResetSql } from './credit-budgets';
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

// Window boundaries are mode-aware SQL (calendar-aligned or rolling) built from
// the configured cycles — safe to interpolate (strict-parsed ints + whitelisted
// unit words, never raw input). Billing is the outer window; reset is a FILTER
// subset. Non-cached input = prompt - cached, floored at 0. Numeric aggregates
// come back as strings — always Number()-wrap.
const BILLING_START = cycleStartSql(BILLING_CYCLE);
const RESET_START = cycleStartSql(RESET_CYCLE);
const NEXT_RESET_SQL = `SELECT ${cycleNextResetSql(BILLING_CYCLE)} AS billing_next, ${cycleNextResetSql(RESET_CYCLE)} AS reset_next`;

/** When the billing/reset windows next reset, as ISO strings (null in rolling mode). */
async function loadNextResets(): Promise<{ billingNext: string | null; resetNext: string | null }> {
  const { rows } = await getModules().db.exec<{ billing_next: unknown; reset_next: unknown }>(NEXT_RESET_SQL);
  const toIso = (v: unknown): string | null =>
    v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();
  return { billingNext: toIso(rows[0]?.billing_next), resetNext: toIso(rows[0]?.reset_next) };
}

const usageSql = (userFilter: string) => `
SELECT
  COALESCE(provider, '')                                                     AS provider,
  model                                                                      AS model,
  COALESCE(NULLIF(trigger, ''), 'unknown')                                   AS trigger,
  SUM(GREATEST(COALESCE(prompt_tokens, 0) - COALESCE(cached_tokens, 0), 0))  AS "nonCachedInputTokens",
  SUM(COALESCE(cached_tokens, 0))                                            AS "cachedTokens",
  SUM(COALESCE(completion_tokens, 0))                                        AS "outputTokens",
  SUM(COALESCE(cost, 0))                                                     AS cost,
  SUM(COALESCE(cost, 0)) FILTER (WHERE created_at >= ${RESET_START})         AS "resetCost"
FROM llm_call_events
WHERE created_at >= ${BILLING_START}
  ${userFilter}
GROUP BY COALESCE(provider, ''), model, COALESCE(NULLIF(trigger, ''), 'unknown')
ORDER BY cost DESC
`;

async function loadScope(
  billingAllowance: number,
  resetAllowance: number,
  nextResets: { billingNext: string | null; resetNext: string | null },
  userId?: number,
): Promise<CreditScope> {
  const db = getModules().db;
  const sql = userId === undefined ? usageSql('') : usageSql('AND user_id = $1');
  const result = userId === undefined
    ? await db.exec<Record<string, unknown>>(sql)
    : await db.exec<Record<string, unknown>>(sql, [userId]);

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
    billing: { label: BILLING_CYCLE.label, used: billingUsed, allowance: billingAllowance, resetsAt: nextResets.billingNext, rows },
    reset: { label: RESET_CYCLE.label, used: resetUsed, allowance: resetAllowance, resetsAt: nextResets.resetNext },
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
  const nextResets = await loadNextResets();
  const individual = await loadScope(resolveIndividualAllowance(role), resolveIndividualResetAllowance(role), nextResets, userId);
  const org = includeOrg ? await loadScope(resolveOrgAllowance(), resolveOrgResetAllowance(), nextResets) : null;
  return { individual, org };
}
