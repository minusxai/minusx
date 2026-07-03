import 'server-only';
import { getModules } from '@/lib/modules/registry';
import { costToCredits } from './credits';
import { resolveIndividualAllowance, resolveOrgAllowance } from '@/lib/config';
import type { CreditBreakdownRow, CreditScope, CreditUsageResponse } from './credits.types';

/**
 * Aggregate credit usage from `llm_call_events` for the CURRENT calendar month.
 *
 * Both conversation-bound chat turns AND headless runs (micro-tasks,
 * feed-summary, eval — small models, OpenAI, etc.) record into this table, so
 * it is the complete record of LLM usage. (Headless runs use conversation_id=0
 * and carry their task tag in the `trigger` column instead.)
 *
 * The month boundary is computed in SQL (`date_trunc('month', NOW())`) so it
 * follows the DB session timezone consistently rather than mixing app-server
 * and DB clocks. Credits themselves are computed in JS via `costToCredits` so
 * that pure function stays the single source of truth as the formula evolves.
 */

// Non-cached input = prompt_tokens - cached_tokens, floored at 0 (GREATEST).
// COALESCE guards NULLs; SUM over zero rows yields NULL (handled in JS via `?? 0`).
// Aggregate reads come back as strings (BIGINT/SUM) — always wrap in Number().
const usageSql = (userFilter: string) => `
SELECT
  COALESCE(provider, '')                                                     AS provider,
  model                                                                      AS model,
  SUM(GREATEST(COALESCE(prompt_tokens, 0) - COALESCE(cached_tokens, 0), 0))  AS "nonCachedInputTokens",
  SUM(COALESCE(cached_tokens, 0))                                            AS "cachedTokens",
  SUM(COALESCE(completion_tokens, 0))                                        AS "outputTokens",
  SUM(COALESCE(cost, 0))                                                     AS cost
FROM llm_call_events
WHERE created_at >= date_trunc('month', NOW())
  ${userFilter}
GROUP BY COALESCE(provider, ''), model
ORDER BY cost DESC
`;

async function loadScope(allowance: number, userId?: number): Promise<CreditScope> {
  const db = getModules().db;
  const result =
    userId === undefined
      ? await db.exec<Record<string, unknown>>(usageSql(''))
      : await db.exec<Record<string, unknown>>(usageSql('AND user_id = $1'), [userId]);

  let used = 0;
  const rows: CreditBreakdownRow[] = result.rows.map((row) => {
    const nonCachedInputTokens = Number(row['nonCachedInputTokens'] ?? 0);
    const cachedTokens = Number(row['cachedTokens'] ?? 0);
    const outputTokens = Number(row['outputTokens'] ?? 0);
    const cost = Number(row['cost'] ?? 0);
    const credits = costToCredits({ cachedTokens, nonCachedTokens: nonCachedInputTokens, outputTokens, cost });
    used += credits;
    return {
      provider: String(row['provider'] ?? ''),
      model: String(row['model'] ?? ''),
      nonCachedInputTokens,
      cachedTokens,
      outputTokens,
      credits,
    };
  });

  return { used, allowance, rows };
}

/**
 * Credit usage for a user this calendar month.
 * @param includeOrg when true, also returns org-wide totals (admins only — gated by the caller).
 */
export async function getCreditUsage(
  userId: number,
  role: string,
  includeOrg: boolean,
): Promise<CreditUsageResponse> {
  const individual = await loadScope(resolveIndividualAllowance(role), userId);
  const org = includeOrg ? await loadScope(resolveOrgAllowance()) : null;
  return { individual, org };
}
