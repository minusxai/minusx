import 'server-only';
import { getModules } from '@/lib/modules/registry';
import { costToCredits } from './credits';
import { CREDIT_CONFIG } from '@/lib/config';
import { cycleStartSql } from './credit-budgets';
import { BILLING_CYCLE } from '@/lib/config';

/**
 * Admin usage analytics: the org-wide "full picture" over the current billing
 * window, sliced along the Models-page axes (grade / provider / model / agent)
 * plus who (user / role) and when (per-day timeseries). Read-only aggregation
 * over the `llm_call_events` ledger — the same table the per-user card and the
 * credit gate read, so every surface agrees. Admin-gated by the caller.
 *
 * Credits are derived from each group's summed cost + token buckets via
 * `costToCredits` (the single source of truth), so the numbers reconcile with
 * the gate and the user card.
 */

/** One row of a dimension breakdown (a provider, model, grade, agent, user, or role). */
export interface UsageBreakdownEntry {
  key: string;
  credits: number;
  cost: number;
  requests: number;
}

/** Credits consumed on one calendar day. */
export interface UsageTimePoint {
  date: string; // YYYY-MM-DD
  credits: number;
}

export interface AdminUsageBreakdown {
  windowLabel: string;
  totalCredits: number;
  totalRequests: number;
  activeUsers: number;
  byGrade: UsageBreakdownEntry[];
  byProvider: UsageBreakdownEntry[];
  byModel: UsageBreakdownEntry[];
  byAgent: UsageBreakdownEntry[];
  byUser: UsageBreakdownEntry[];
  byRole: UsageBreakdownEntry[];
  overTime: UsageTimePoint[];
}

const BILLING_START = cycleStartSql(BILLING_CYCLE);
// All columns are aliased to `e` so the optional `users` join (which also has a
// created_at) never makes a reference ambiguous.
const NONCACHED = `GREATEST(COALESCE(e.prompt_tokens, 0) - COALESCE(e.cached_tokens, 0), 0)`;
// User-facing usage only (org + tutorial); legacy NULL mode counts as org.
const MODE_FILTER = `COALESCE(e.mode, 'org') IN ('org', 'tutorial')`;

/** Aggregate sums grouped by an arbitrary key expression, credits computed in JS. */
function breakdownSql(keyExpr: string): string {
  return `
    SELECT ${keyExpr} AS key,
           SUM(${NONCACHED})                     AS non_cached,
           SUM(COALESCE(e.cached_tokens, 0))     AS cached,
           SUM(COALESCE(e.completion_tokens, 0)) AS output,
           SUM(COALESCE(e.cost, 0))              AS cost,
           COUNT(*)                              AS requests
    FROM llm_call_events e
    WHERE e.created_at >= ${BILLING_START} AND ${MODE_FILTER}
    GROUP BY ${keyExpr}
  `;
}

async function loadBreakdown(keyExpr: string, opts: { join?: string } = {}): Promise<UsageBreakdownEntry[]> {
  const sql = opts.join
    ? breakdownSql(keyExpr).replace('FROM llm_call_events e', `FROM llm_call_events e ${opts.join}`)
    : breakdownSql(keyExpr);
  const { rows } = await getModules().db.exec<Record<string, unknown>>(sql);
  return rows
    .map((r) => {
      const cost = Number(r['cost'] ?? 0);
      const requests = Number(r['requests'] ?? 0);
      const credits = costToCredits(
        {
          nonCachedTokens: Number(r['non_cached'] ?? 0),
          cachedTokens: Number(r['cached'] ?? 0),
          outputTokens: Number(r['output'] ?? 0),
          cost,
          requests,
        },
        CREDIT_CONFIG.weights,
      );
      return { key: r['key'] == null || r['key'] === '' ? 'unknown' : String(r['key']), credits, cost, requests };
    })
    .sort((a, b) => b.credits - a.credits);
}

const OVER_TIME_SQL = `
  SELECT TO_CHAR(e.created_at, 'YYYY-MM-DD') AS date,
         SUM(COALESCE(e.cost, 0)) AS cost,
         SUM(${NONCACHED}) AS non_cached,
         SUM(COALESCE(e.cached_tokens, 0)) AS cached,
         SUM(COALESCE(e.completion_tokens, 0)) AS output,
         COUNT(*) AS requests
  FROM llm_call_events e
  WHERE e.created_at >= ${BILLING_START} AND ${MODE_FILTER}
  GROUP BY TO_CHAR(e.created_at, 'YYYY-MM-DD')
  ORDER BY date ASC
`;

async function loadOverTime(): Promise<UsageTimePoint[]> {
  const { rows } = await getModules().db.exec<Record<string, unknown>>(OVER_TIME_SQL);
  return rows.map((r) => ({
    date: String(r['date']),
    credits: costToCredits(
      {
        nonCachedTokens: Number(r['non_cached'] ?? 0),
        cachedTokens: Number(r['cached'] ?? 0),
        outputTokens: Number(r['output'] ?? 0),
        cost: Number(r['cost'] ?? 0),
        requests: Number(r['requests'] ?? 0),
      },
      CREDIT_CONFIG.weights,
    ),
  }));
}

/** The org-wide admin usage picture over the current billing window. */
export async function getAdminUsageBreakdown(): Promise<AdminUsageBreakdown> {
  const [byGrade, byProvider, byModel, byAgent, byUser, byRole, overTime] = await Promise.all([
    loadBreakdown(`COALESCE(NULLIF(grade, ''), 'unknown')`),
    loadBreakdown(`COALESCE(NULLIF(provider, ''), 'unknown')`),
    loadBreakdown(`model`),
    loadBreakdown(`COALESCE(NULLIF(agent, ''), 'unknown')`),
    // Attribute to the user's email; join users for a human key + role.
    loadBreakdown(`COALESCE(u.email, 'unknown')`, { join: `LEFT JOIN users u ON u.id = e.user_id` }),
    loadBreakdown(`COALESCE(u.role, 'unknown')`, { join: `LEFT JOIN users u ON u.id = e.user_id` }),
    loadOverTime(),
  ]);

  const totalCredits = overTime.reduce((s, p) => s + p.credits, 0);
  const totalRequests = byProvider.reduce((s, r) => s + r.requests, 0);
  const activeUsers = byUser.filter((u) => u.key !== 'unknown').length;

  return {
    windowLabel: BILLING_CYCLE.label,
    totalCredits,
    totalRequests,
    activeUsers,
    byGrade,
    byProvider,
    byModel,
    byAgent,
    byUser,
    byRole,
    overTime,
  };
}
