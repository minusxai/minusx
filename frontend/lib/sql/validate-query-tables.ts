/**
 * Server-side SQL table whitelist validator.
 *
 * Calls the Python backend's /api/validate-query-tables endpoint which uses
 * sqlglot — the canonical SQL parser across the whole backend stack.
 * This replaces the previous node-sql-parser implementation, keeping the
 * validator on a single parsing library rather than two.
 *
 * Parse errors are silently allowed — the execution layer surfaces them.
 * CTE names are excluded because they are defined within the query itself.
 *
 * On any network or backend error the function allows through (fail-open):
 * whitelist enforcement should not block execution when the validator is
 * unavailable. The Python execution layer enforces the same rules.
 */

import 'server-only';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import { pythonBackendFetch } from '@/lib/api/python-backend-client';

export type WhitelistEntry = {
  schema: string;
  tables: Array<{ table: string }>;
};

/**
 * Validate that every table referenced in `sql` is covered by `whitelist`.
 *
 * @returns An error string if any table is blocked, or `null` if the query is allowed.
 */
export async function validateQueryTables(
  sql: string,
  whitelist: WhitelistEntry[],
  user: EffectiveUser
): Promise<string | null> {
  if (!whitelist || whitelist.length === 0) return null;
  try {
    const res = await pythonBackendFetch(
      '/api/validate-query-tables',
      { method: 'POST', body: JSON.stringify({ sql, whitelist }) },
      user
    );
    if (!res.ok) return null; // on backend error, allow through
    const data = await res.json();
    return data.error ?? null;
  } catch {
    return null; // on network error, allow through
  }
}
