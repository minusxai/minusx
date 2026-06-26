/**
 * None-parameter handling, shared by the client query route (`/api/query`) and the server-side
 * file query runner (`executeQueriesForFile`) so both treat a None (null) param value identically.
 *
 * A None param means "no filter" — the canonical params dict carries it as `null` (an unset numeric
 * param coerces to null; see `buildQueryParamValues`). This transform makes a query+params pair
 * honour that:
 *   1. Remove filter conditions (WHERE/HAVING) referencing a None param via an IR round-trip
 *      (so a bare `total >= :min_mrr` with min_mrr=None drops the whole condition → all rows).
 *   2. Substitute any remaining `:param` occurrences (non-filter uses) with NULL.
 *   3. Strip None params from the returned dict (so the connector binds only real values).
 *
 * Pure + best-effort: any parse failure falls through to plain NULL substitution.
 */
import { removeNoneParamConditions } from '@/lib/sql/ir-transforms';
import { parseSqlToIrLocal } from '@/lib/sql/sql-to-ir';
import { irToSqlLocal } from '@/lib/sql/ir-to-sql';
import type { QueryIR } from '@/lib/sql/ir-types';

export async function applyNoneParams(
  query: string,
  params: Record<string, string | number | null>,
  dialect: string,
): Promise<{ sql: string; params: Record<string, string | number> }> {
  const noneSet = new Set(Object.keys(params).filter((k) => params[k] === null));
  const effectiveParams = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== null),
  ) as Record<string, string | number>;

  if (noneSet.size === 0) return { sql: query, params: effectiveParams };

  // Try IR-based filter removal locally via WASM (only for simple queries, not UNION)
  try {
    const ir = await parseSqlToIrLocal(query, dialect);
    if (ir.type !== 'compound') {
      const transformed = removeNoneParamConditions(ir as QueryIR, noneSet);
      query = irToSqlLocal(transformed, dialect);
    }
  } catch { /* fall through to NULL substitution */ }

  // Substitute any remaining :param_name references with NULL (non-filter uses, fallback)
  for (const p of noneSet) {
    query = query.replace(new RegExp(`:${p}\\b`, 'g'), 'NULL');
  }
  return { sql: query, params: effectiveParams };
}
