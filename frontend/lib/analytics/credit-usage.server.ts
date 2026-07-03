import 'server-only';
import { getModules } from '@/lib/modules/registry';
import { costToCredits } from './credits';
import {
  BILLING_CYCLE, RESET_CYCLE, ENFORCE_CREDIT_LIMITS, CREDIT_CONFIG,
  resolveIndividualAllowance, resolveOrgAllowance,
  resolveIndividualResetAllowance, resolveOrgResetAllowance,
} from '@/lib/config';
import { cycleStartSql, cycleNextResetSql } from './credit-budgets';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
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

// The `mode` filter counts only user-facing usage — org + tutorial — and excludes
// the internal 'internals' mode. Legacy null-mode rows default to 'org' so they
// aren't dropped. (Kept as a JS comment, NOT an inline SQL `--` comment: an
// apostrophe inside a SQL comment breaks PGLite's no-param query path.)
const NONCACHED = `GREATEST(COALESCE(prompt_tokens, 0) - COALESCE(cached_tokens, 0), 0)`;
const usageSql = (userFilter: string) => `
SELECT
  COALESCE(provider, '')                                                     AS provider,
  model                                                                      AS model,
  COALESCE(NULLIF(trigger, ''), 'unknown')                                   AS trigger,
  SUM(${NONCACHED})                                                          AS "nonCachedInputTokens",
  SUM(COALESCE(cached_tokens, 0))                                            AS "cachedTokens",
  SUM(COALESCE(completion_tokens, 0))                                        AS "outputTokens",
  SUM(COALESCE(cost, 0))                                                     AS cost,
  COUNT(*)                                                                   AS requests,
  SUM(${NONCACHED}) FILTER (WHERE created_at >= ${RESET_START})              AS "resetNonCachedInputTokens",
  SUM(COALESCE(cached_tokens, 0)) FILTER (WHERE created_at >= ${RESET_START})     AS "resetCachedTokens",
  SUM(COALESCE(completion_tokens, 0)) FILTER (WHERE created_at >= ${RESET_START}) AS "resetOutputTokens",
  SUM(COALESCE(cost, 0)) FILTER (WHERE created_at >= ${RESET_START})         AS "resetCost",
  COUNT(*) FILTER (WHERE created_at >= ${RESET_START})                       AS "resetRequests"
FROM llm_call_events
WHERE created_at >= ${BILLING_START}
  AND COALESCE(mode, 'org') IN ('org', 'tutorial')
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
    const provider = String(row['provider'] ?? '');
    const model = String(row['model'] ?? '');
    const nonCachedInputTokens = Number(row['nonCachedInputTokens'] ?? 0);
    const cachedTokens = Number(row['cachedTokens'] ?? 0);
    const outputTokens = Number(row['outputTokens'] ?? 0);
    const cost = Number(row['cost'] ?? 0);
    const requests = Number(row['requests'] ?? 0);
    const credits = costToCredits(
      { provider, model, cachedTokens, nonCachedTokens: nonCachedInputTokens, outputTokens, cost, requests },
      CREDIT_CONFIG.weights,
    );
    billingUsed += credits;
    // Reset window is a subset — weight its own filtered token/cost/request sums.
    resetUsed += costToCredits(
      {
        provider, model,
        cachedTokens: Number(row['resetCachedTokens'] ?? 0),
        nonCachedTokens: Number(row['resetNonCachedInputTokens'] ?? 0),
        outputTokens: Number(row['resetOutputTokens'] ?? 0),
        cost: Number(row['resetCost'] ?? 0),
        requests: Number(row['resetRequests'] ?? 0),
      },
      CREDIT_CONFIG.weights,
    );
    return {
      provider,
      model,
      trigger: String(row['trigger'] ?? UNKNOWN_TRIGGER),
      nonCachedInputTokens,
      cachedTokens,
      outputTokens,
      requests,
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
  return { individual, org, enforced: ENFORCE_CREDIT_LIMITS };
}

// Lightweight per-user usage for the gate: the same weighted inputs as usageSql
// (token buckets + cost + request count), per window, so gate and card agree.
// No GROUP BY — one aggregate row for the user. $1 = user_id.
const GATE_SQL = `
SELECT
  SUM(${NONCACHED})                    AS b_noncached,
  SUM(COALESCE(cached_tokens, 0))      AS b_cached,
  SUM(COALESCE(completion_tokens, 0))  AS b_output,
  SUM(COALESCE(cost, 0))               AS b_cost,
  COUNT(*)                             AS b_requests,
  SUM(${NONCACHED}) FILTER (WHERE created_at >= ${RESET_START})                   AS r_noncached,
  SUM(COALESCE(cached_tokens, 0)) FILTER (WHERE created_at >= ${RESET_START})     AS r_cached,
  SUM(COALESCE(completion_tokens, 0)) FILTER (WHERE created_at >= ${RESET_START}) AS r_output,
  SUM(COALESCE(cost, 0)) FILTER (WHERE created_at >= ${RESET_START})              AS r_cost,
  COUNT(*) FILTER (WHERE created_at >= ${RESET_START})                            AS r_requests
FROM llm_call_events
WHERE created_at >= ${BILLING_START}
  AND COALESCE(mode, 'org') IN ('org', 'tutorial')
  AND user_id = $1
`;

export interface CreditGate {
  allowed: boolean;
  /** Which window was exceeded (null when allowed / not enforced). */
  exceeded: 'reset' | 'billing' | null;
  /** User-facing block message (null when allowed). */
  message: string | null;
}

const ALLOWED: CreditGate = { allowed: true, exceeded: null, message: null };

/**
 * Preflight credit check for one user before a turn runs. Returns `allowed`
 * unless credit limits are ENFORCED and the user has hit their reset-cycle or
 * billing-cycle allowance. Cheap (a single 2-SUM query); call at orchestration
 * entry points, not per LLM hop.
 */
export async function checkCreditGate(user: EffectiveUser): Promise<CreditGate> {
  if (!ENFORCE_CREDIT_LIMITS || typeof user.userId !== 'number') return ALLOWED;

  const { rows } = await getModules().db.exec<Record<string, unknown>>(GATE_SQL, [user.userId]);
  const r = rows[0] ?? {};
  const n = (k: string) => Number(r[k] ?? 0);
  const billingUsed = costToCredits(
    { nonCachedTokens: n('b_noncached'), cachedTokens: n('b_cached'), outputTokens: n('b_output'), cost: n('b_cost'), requests: n('b_requests') },
    CREDIT_CONFIG.weights,
  );
  const resetUsed = costToCredits(
    { nonCachedTokens: n('r_noncached'), cachedTokens: n('r_cached'), outputTokens: n('r_output'), cost: n('r_cost'), requests: n('r_requests') },
    CREDIT_CONFIG.weights,
  );

  const billingAllowance = resolveIndividualAllowance(user.role);
  if (billingUsed >= billingAllowance) {
    return { allowed: false, exceeded: 'billing', message: `Credit limit reached for ${BILLING_CYCLE.label} (${billingAllowance.toLocaleString()} credits).` };
  }
  const resetAllowance = resolveIndividualResetAllowance(user.role);
  if (resetUsed >= resetAllowance) {
    return { allowed: false, exceeded: 'reset', message: `Credit limit reached for ${RESET_CYCLE.label} (${resetAllowance.toLocaleString()} credits). It resets soon.` };
  }
  return ALLOWED;
}

/** Thrown by the orchestrator credit gate when a user is over their enforced limit. */
export class CreditLimitError extends Error {
  constructor(message: string, readonly exceeded: 'reset' | 'billing') {
    super(message);
    this.name = 'CreditLimitError';
  }
}

/**
 * Build the `Orchestrator.beforeLlmCall` hook for a user: a pre-LLM-call gate
 * that throws `CreditLimitError` (message surfaces to the run) when limits are
 * enforced and exceeded. No-op when enforcement is off. Set this on every
 * user-facing orchestrator so enforcement lives at the one universal call site.
 */
export function creditEnforcer(user: EffectiveUser): () => Promise<void> {
  return async () => {
    const gate = await checkCreditGate(user);
    if (!gate.allowed) throw new CreditLimitError(gate.message!, gate.exceeded!);
  };
}
