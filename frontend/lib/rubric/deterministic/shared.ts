/**
 * Pure helpers shared by the deterministic scorers. No I/O, no query results — everything
 * here is a function of file content only.
 */
import type { RubricCategory, RubricFinding, RubricSeverity } from '../types';

/** Rough token estimate (~4 chars/token) — used for query-size rules. */
export function estimateTokens(text: string): number {
  return Math.ceil((text?.length ?? 0) / 4);
}

export function isBlank(s: string | null | undefined): boolean {
  return !s || s.trim().length === 0;
}

/**
 * Distinct `:paramName` tokens referenced in a SQL string. Skips `::type` casts (the second
 * colon is preceded by a colon) and requires an identifier start after the colon.
 */
export function extractSqlParams(query: string): string[] {
  const out = new Set<string>();
  const re = /(?<!:):([a-zA-Z_][a-zA-Z0-9_]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(query)) !== null) out.add(m[1]);
  return [...out];
}

/** Distinct lowercased hex colors (`#rgb`/`#rrggbb`/`#rrggbbaa`) in a CSS string. */
export function distinctHexColors(css: string): string[] {
  const out = new Set<string>();
  const re = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) out.add(m[0].toLowerCase());
  return [...out];
}

export function hasFontFamily(css: string): boolean {
  return /font-family\s*:/i.test(css) || /@import[^;]*fonts\.googleapis/i.test(css);
}

/**
 * Factual figures that should be live (`<Number>` / `single_value`) rather than typed into
 * prose: currency, percentages, thousands-grouped numbers, and 5+ digit runs. Deliberately
 * ignores bare 1–4 digit numbers (years like 2019, small counts) to avoid false positives.
 */
export function findFactualNumbers(text: string): string[] {
  const re = /\$\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s?%|\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d{5,}(?:\.\d+)?\b/g;
  return (text.match(re) ?? []).map((s) => s.trim());
}

/** Small constructor so scorers stay declarative. */
export function finding(
  ruleId: string,
  category: RubricCategory,
  severity: RubricSeverity,
  title: string,
  detail: string,
  fix: string,
): RubricFinding {
  return { ruleId, category, severity, title, detail, fix, source: 'rule' };
}
