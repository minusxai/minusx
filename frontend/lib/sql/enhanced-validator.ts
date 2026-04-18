/**
 * SQL normalizer and round-trip validator using @polyglot-sql/sdk (WASM).
 * Ported from backend/sql_ir/enhanced_validator.py.
 */
import { init, transpile, Dialect } from '@polyglot-sql/sdk';

let initialized = false;

async function ensureInit() {
  if (!initialized) {
    await init();
    initialized = true;
  }
}

export interface ValidationResult {
  supported: boolean;
  errors: string[];
  unsupportedFeatures?: string[];
  hint?: string | null;
}

/**
 * Normalize SQL to a canonical form for semantic comparison.
 * Parses and regenerates SQL via polyglot to canonicalize whitespace,
 * keyword casing, and formatting.
 *
 * Returns the stripped original if parsing fails.
 */
export async function normalizeSql(sql: string, dialect: string): Promise<string> {
  const stripped = sql.trim();
  if (!stripped) return '';

  await ensureInit();

  // Remove trailing semicolons before parsing
  const cleaned = stripped.replace(/;\s*$/, '');

  try {
    const result = transpile(cleaned, dialect as Dialect, dialect as Dialect);
    if (result.success && result.sql && result.sql.length > 0) {
      return result.sql[0];
    }
  } catch {
    // fall through
  }

  return stripped;
}

/**
 * Validate that a round-trip (SQL → IR → SQL) is lossless.
 * Normalizes both SQL strings and compares.
 */
export async function validateRoundTrip(
  originalSql: string,
  regeneratedSql: string,
  dialect: string,
): Promise<ValidationResult> {
  const normOriginal = await normalizeSql(originalSql, dialect);
  const normRegenerated = await normalizeSql(regeneratedSql, dialect);

  if (normOriginal === normRegenerated) {
    return { supported: true, errors: [] };
  }

  return {
    supported: false,
    errors: ['Round-trip validation failed: regenerated SQL differs from original'],
    unsupportedFeatures: ['SQL statements differ after normalization'],
    hint: 'The query cannot be losslessly converted. Use SQL mode for this query.',
  };
}
