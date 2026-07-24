import 'server-only';
import { getModules } from '@/lib/modules/registry';
import { costToCredits } from './credits';
import { parseBillingCycle, cycleStartSql, cycleNextResetSql, type BillingCycle } from './credit-budgets';
import {
  resolveCreditPolicy, resolveOrgCreditPolicy,
  type CreditsConfig, type ResolvedCreditPolicy,
} from './credit-policy';
import { getRawConfig } from '@/lib/data/configs.server';
import { DEFAULT_MODE } from '@/lib/mode/mode-types';
import { appEventRegistry } from '@/lib/app-event-registry';
import { AppEvents } from '@/lib/app-event-registry/events';
import type { CreditWeights } from './credit-budgets';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import { UNKNOWN_TRIGGER, type CreditBreakdownRow, type CreditScope, type CreditUsageResponse } from './credits.types';

/**
 * Aggregate credit usage from `llm_call_events` over two windows resolved from
 * the admin-configured credit policy (org config `credits` section — NOT env):
 *   - WEEKLY (billing) window, which carries the per-(provider, model, trigger) breakdown
 *   - DAILY (reset) window, a subset via a FILTER on the same rows
 * Both are calendar-aligned (this week / today). Credits are computed in JS via
 * `costToCredits` with the policy weights, so gate, card, and dashboard agree.
 * A manual/auto CREDIT_RESET moves the window start forward (see resetFloorExpr).
 */

const NONCACHED = `GREATEST(COALESCE(prompt_tokens, 0) - COALESCE(cached_tokens, 0), 0)`;

/** Load the org's credit policy config (mode-independent — workspace-level). */
async function loadCreditsConfig(): Promise<CreditsConfig | undefined> {
  try {
    const cfg = await getRawConfig(DEFAULT_MODE);
    return cfg.credits as CreditsConfig | undefined;
  } catch {
    return undefined;
  }
}

/**
 * Scalar SQL that yields the latest applicable CREDIT_RESET timestamp for a user
 * (a reset scoped to that user, their role, or the whole company), or a far-past
 * value when none. The window start is GREATEST(calendar-start, this) so a manual
 * reset zeroes usage immediately without waiting for the calendar boundary.
 */
function resetFloorExpr(userId: number | null, role: string | null): string {
  const uid = userId == null ? "''" : `'${String(userId)}'`;
  const r = role == null ? "''" : `'${role.replace(/'/g, "''")}'`;
  return `COALESCE((
    SELECT MAX(created_at) FROM app_events
    WHERE event_type = 'credit:reset'
      AND ( payload->>'scope' = 'company'
         OR (payload->>'scope' = 'role' AND payload->>'target' = ${r})
         OR (payload->>'scope' = 'user' AND payload->>'target' = ${uid}) )
  ), TIMESTAMPTZ '1970-01-01')`;
}

/** Window start honoring both the calendar cycle and the latest reset event. */
function windowStart(cycle: BillingCycle, userId: number | null, role: string | null): string {
  return `GREATEST(${cycleStartSql(cycle)}, ${resetFloorExpr(userId, role)})`;
}

const usageSql = (userFilter: string, billingStart: string, resetStart: string) => `
SELECT
  COALESCE(provider, '')                                                     AS provider,
  model                                                                      AS model,
  COALESCE(NULLIF(trigger, ''), 'unknown')                                   AS trigger,
  SUM(${NONCACHED})                                                          AS "nonCachedInputTokens",
  SUM(COALESCE(cached_tokens, 0))                                            AS "cachedTokens",
  SUM(COALESCE(completion_tokens, 0))                                        AS "outputTokens",
  SUM(COALESCE(cost, 0))                                                     AS cost,
  COUNT(*)                                                                   AS requests,
  SUM(${NONCACHED}) FILTER (WHERE created_at >= ${resetStart})               AS "resetNonCachedInputTokens",
  SUM(COALESCE(cached_tokens, 0)) FILTER (WHERE created_at >= ${resetStart})      AS "resetCachedTokens",
  SUM(COALESCE(completion_tokens, 0)) FILTER (WHERE created_at >= ${resetStart})  AS "resetOutputTokens",
  SUM(COALESCE(cost, 0)) FILTER (WHERE created_at >= ${resetStart})          AS "resetCost",
  COUNT(*) FILTER (WHERE created_at >= ${resetStart})                        AS "resetRequests"
FROM llm_call_events
WHERE created_at >= ${billingStart}
  AND COALESCE(mode, 'org') IN ('org', 'tutorial')
  ${userFilter}
GROUP BY COALESCE(provider, ''), model, COALESCE(NULLIF(trigger, ''), 'unknown')
ORDER BY cost DESC
`;

async function loadNextResets(billingCycle: BillingCycle, resetCycle: BillingCycle): Promise<{ billingNext: string | null; resetNext: string | null }> {
  const sql = `SELECT ${cycleNextResetSql(billingCycle)} AS billing_next, ${cycleNextResetSql(resetCycle)} AS reset_next`;
  const { rows } = await getModules().db.exec<{ billing_next: unknown; reset_next: unknown }>(sql);
  const toIso = (v: unknown): string | null =>
    v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();
  return { billingNext: toIso(rows[0]?.billing_next), resetNext: toIso(rows[0]?.reset_next) };
}

interface ScopeParams {
  billingCycle: BillingCycle;
  resetCycle: BillingCycle;
  weights: CreditWeights;
  billingAllowance: number;
  resetAllowance: number;
  nextResets: { billingNext: string | null; resetNext: string | null };
  userId?: number;
  role?: string;
}

async function loadScope(p: ScopeParams): Promise<CreditScope> {
  const db = getModules().db;
  const uid = p.userId ?? null;
  const billingStart = windowStart(p.billingCycle, uid, p.role ?? null);
  const resetStart = windowStart(p.resetCycle, uid, p.role ?? null);
  const sql = p.userId === undefined ? usageSql('', billingStart, resetStart) : usageSql('AND user_id = $1', billingStart, resetStart);
  const result = p.userId === undefined
    ? await db.exec<Record<string, unknown>>(sql)
    : await db.exec<Record<string, unknown>>(sql, [p.userId]);

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
    const credits = costToCredits({ provider, model, cachedTokens, nonCachedTokens: nonCachedInputTokens, outputTokens, cost, requests }, p.weights);
    billingUsed += credits;
    resetUsed += costToCredits({
      provider, model,
      cachedTokens: Number(row['resetCachedTokens'] ?? 0),
      nonCachedTokens: Number(row['resetNonCachedInputTokens'] ?? 0),
      outputTokens: Number(row['resetOutputTokens'] ?? 0),
      cost: Number(row['resetCost'] ?? 0),
      requests: Number(row['resetRequests'] ?? 0),
    }, p.weights);
    return { provider, model, trigger: String(row['trigger'] ?? UNKNOWN_TRIGGER), nonCachedInputTokens, cachedTokens, outputTokens, requests, credits };
  });

  return {
    billing: { label: p.billingCycle.label, used: billingUsed, allowance: p.billingAllowance, resetsAt: p.nextResets.billingNext, rows },
    reset: { label: p.resetCycle.label, used: resetUsed, allowance: p.resetAllowance, resetsAt: p.nextResets.resetNext },
  };
}

/**
 * Credit usage for a user across the weekly (billing) + daily (reset) windows,
 * with limits resolved from the org credit policy.
 * @param includeOrg when true, also returns company-wide totals (admins only — gated by the caller).
 */
export async function getCreditUsage(userId: number, role: string, includeOrg: boolean): Promise<CreditUsageResponse> {
  const cfg = await loadCreditsConfig();
  const policy = resolveCreditPolicy(cfg, { userId, role });
  const billingCycle = parseBillingCycle(policy.weekly.cycle);
  const resetCycle = parseBillingCycle(policy.daily.cycle);
  const nextResets = await loadNextResets(billingCycle, resetCycle);

  const individual = await loadScope({
    billingCycle, resetCycle, weights: policy.weights,
    billingAllowance: policy.weekly.limit, resetAllowance: policy.daily.limit,
    nextResets, userId, role,
  });

  let org: CreditScope | null = null;
  if (includeOrg) {
    const orgPolicy = resolveOrgCreditPolicy(cfg);
    org = await loadScope({
      billingCycle, resetCycle, weights: policy.weights,
      billingAllowance: orgPolicy.weekly.limit, resetAllowance: orgPolicy.daily.limit,
      nextResets,
    });
  }
  return { individual, org, enforced: policy.enforced };
}

// Credits for ONE conversation for a user (user-scoped, no cross-user leak).
const CONVO_SQL = `
SELECT
  SUM(${NONCACHED})                    AS noncached,
  SUM(COALESCE(cached_tokens, 0))      AS cached,
  SUM(COALESCE(completion_tokens, 0))  AS output,
  SUM(COALESCE(cost, 0))               AS cost,
  COUNT(*)                             AS requests
FROM llm_call_events
WHERE conversation_id = $1 AND user_id = $2
`;

/** Total credits attributed to one conversation for the given user. */
export async function getConversationCredits(conversationId: number, userId: number): Promise<number> {
  const cfg = await loadCreditsConfig();
  const weights = resolveCreditPolicy(cfg, { userId }).weights;
  const { rows } = await getModules().db.exec<Record<string, unknown>>(CONVO_SQL, [conversationId, userId]);
  const r = rows[0] ?? {};
  const n = (k: string) => Number(r[k] ?? 0);
  return costToCredits({ nonCachedTokens: n('noncached'), cachedTokens: n('cached'), outputTokens: n('output'), cost: n('cost'), requests: n('requests') }, weights);
}

export interface CreditGate {
  allowed: boolean;
  exceeded: 'reset' | 'billing' | null;
  message: string | null;
}
const ALLOWED: CreditGate = { allowed: true, exceeded: null, message: null };

/**
 * Preflight credit check for one user before a turn runs. Returns `allowed`
 * unless the policy ENFORCES limits and the user has hit their daily or weekly
 * allowance. Cheap (a single 2-SUM query); call at orchestration entry points.
 */
export async function checkCreditGate(user: EffectiveUser): Promise<CreditGate> {
  if (typeof user.userId !== 'number') return ALLOWED;
  const cfg = await loadCreditsConfig();
  const policy = resolveCreditPolicy(cfg, { userId: user.userId, role: user.role, email: user.email });
  if (!policy.enforced) return ALLOWED;

  const billingCycle = parseBillingCycle(policy.weekly.cycle);
  const resetCycle = parseBillingCycle(policy.daily.cycle);
  const billingStart = windowStart(billingCycle, user.userId, user.role ?? null);
  const resetStart = windowStart(resetCycle, user.userId, user.role ?? null);
  const gateSql = `
    SELECT
      SUM(${NONCACHED}) AS b_noncached, SUM(COALESCE(cached_tokens,0)) AS b_cached,
      SUM(COALESCE(completion_tokens,0)) AS b_output, SUM(COALESCE(cost,0)) AS b_cost, COUNT(*) AS b_requests,
      SUM(${NONCACHED}) FILTER (WHERE created_at >= ${resetStart}) AS r_noncached,
      SUM(COALESCE(cached_tokens,0)) FILTER (WHERE created_at >= ${resetStart}) AS r_cached,
      SUM(COALESCE(completion_tokens,0)) FILTER (WHERE created_at >= ${resetStart}) AS r_output,
      SUM(COALESCE(cost,0)) FILTER (WHERE created_at >= ${resetStart}) AS r_cost,
      COUNT(*) FILTER (WHERE created_at >= ${resetStart}) AS r_requests
    FROM llm_call_events
    WHERE created_at >= ${billingStart} AND COALESCE(mode,'org') IN ('org','tutorial') AND user_id = $1`;
  const { rows } = await getModules().db.exec<Record<string, unknown>>(gateSql, [user.userId]);
  const r = rows[0] ?? {};
  const n = (k: string) => Number(r[k] ?? 0);
  const billingUsed = costToCredits({ nonCachedTokens: n('b_noncached'), cachedTokens: n('b_cached'), outputTokens: n('b_output'), cost: n('b_cost'), requests: n('b_requests') }, policy.weights);
  const resetUsed = costToCredits({ nonCachedTokens: n('r_noncached'), cachedTokens: n('r_cached'), outputTokens: n('r_output'), cost: n('r_cost'), requests: n('r_requests') }, policy.weights);

  if (billingUsed >= policy.weekly.limit) {
    return { allowed: false, exceeded: 'billing', message: `Credit limit reached for ${billingCycle.label} (${policy.weekly.limit.toLocaleString()} credits).` };
  }
  if (resetUsed >= policy.daily.limit) {
    return { allowed: false, exceeded: 'reset', message: `Credit limit reached for ${resetCycle.label} (${policy.daily.limit.toLocaleString()} credits). It resets soon.` };
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
 * Build the `Orchestrator.beforeLlmCall` hook: a pre-LLM-call gate that throws
 * `CreditLimitError` (surfaced to the run) when the policy enforces limits and
 * the user is over. Records the block as a RATE_LIMIT_HIT app event.
 */
export function creditEnforcer(user: EffectiveUser): () => Promise<void> {
  return async () => {
    const gate = await checkCreditGate(user);
    if (!gate.allowed) {
      appEventRegistry.publish(AppEvents.RATE_LIMIT_HIT, {
        mode: user.mode,
        userId: typeof user.userId === 'number' ? user.userId : undefined,
        userEmail: user.email,
        userRole: user.role,
        window: gate.exceeded ?? undefined,
      });
      throw new CreditLimitError(gate.message!, gate.exceeded!);
    }
  };
}

export type { ResolvedCreditPolicy };
