/**
 * SQL syntax validation using @polyglot-sql/sdk (WASM).
 * Replaces the Python sqlglot-based validator for the /api/validate-sql route.
 */
import { init, validate } from '@polyglot-sql/sdk';
import type { ValidateSqlResult } from '@/lib/data/completions/types';

let initialized = false;

async function ensureInit() {
  if (!initialized) {
    await init();
    initialized = true;
  }
}

/**
 * Validate SQL syntax locally via WASM.
 * Returns the same shape as the Python /api/validate-sql endpoint.
 */
export async function validateSqlLocal(
  query: string,
  dialect: string,
): Promise<ValidateSqlResult> {
  const stripped = query.trim();
  if (!stripped) {
    return { valid: true, errors: [] };
  }

  await ensureInit();

  const result = validate(stripped, dialect);

  return {
    valid: result.valid,
    errors: result.errors
      .filter((e) => e.severity === 'error')
      .map((e) => ({
        message: e.message,
        line: e.line ?? 1,
        col: e.column ?? 1,
        end_col: (e.column ?? 1) + Math.max((e.end ?? 0) - (e.start ?? 0), 1),
      })),
  };
}
