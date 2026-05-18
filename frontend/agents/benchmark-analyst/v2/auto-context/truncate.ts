import 'server-only';

/** Default per-value char cap. Long enough to preserve shape + format
 *  indicators (prefixes, JSON keys, date patterns, etc.); short enough
 *  that a blob-heavy table can't single-handedly blow a 200K-token LLM
 *  window. Empirically calibrated against the GitHub-style README /
 *  commit-message columns that triggered the first context-window OOM. */
export const DEFAULT_MAX_VALUE_CHARS = 300;

/** Truncate a single value if it's a long string. Non-string and short
 *  values pass through unchanged. The truncation marker preserves
 *  visibility into the actual full length so the LLM/agent knows it's
 *  reading a sample, not the whole thing. */
export function truncateValue(v: unknown, maxChars: number = DEFAULT_MAX_VALUE_CHARS): unknown {
  if (typeof v === 'string' && v.length > maxChars) {
    return `${v.slice(0, maxChars)}…<+${v.length - maxChars} more chars>`;
  }
  return v;
}

/** Truncate every string value in a row. Preserves structure (keys,
 *  null vs missing, nested objects untouched — they're rare in our
 *  catalog samples and an inner JSON.stringify will compact them). */
export function truncateRow(
  row: Record<string, unknown>,
  maxChars: number = DEFAULT_MAX_VALUE_CHARS,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = truncateValue(v, maxChars);
  }
  return out;
}

/** Truncate every value in an array (used for join-overlap sample-value
 *  lists where each item is a column value, not a row). */
export function truncateValues(values: unknown[], maxChars: number = DEFAULT_MAX_VALUE_CHARS): unknown[] {
  return values.map((v) => truncateValue(v, maxChars));
}
