import 'server-only';

import type { QueryResult } from './base';

// ─── Types ───────────────────────────────────────────────────────────────────

type QueryFn = (sql: string) => Promise<QueryResult>;

export interface FuzzySearchResult {
  matches: Array<{ value: string; similarity: number }>;
  searchTerm: string;
  method: 'jaro_winkler' | 'trigram' | 'levenshtein' | 'substring';
}

interface FuzzySearchParams {
  table: string;
  column: string;
  searchTerm: string;
  schema?: string;
  limit?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Escape a SQL identifier (table/column/schema name) for double-quoting. */
function escapeIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Escape a SQL string literal (single-quoted value). */
function escapeLiteral(value: string): string {
  return value.replace(/'/g, "''").slice(0, 200);
}

/** Extract matches from query result rows. */
function rowsToMatches(rows: Record<string, unknown>[]): Array<{ value: string; similarity: number }> {
  return rows.map(r => ({
    value: String(r['value'] ?? ''),
    similarity: Number(r['similarity'] ?? 1),
  }));
}

// ─── Per-Connector Strategies ────────────────────────────────────────────────

async function fuzzyDuckDb(queryFn: QueryFn, p: Required<FuzzySearchParams>): Promise<FuzzySearchResult> {
  const sql = `
    SELECT DISTINCT ${escapeIdent(p.column)}::VARCHAR AS value,
           jaro_winkler_similarity(lower(${escapeIdent(p.column)}::VARCHAR), lower('${escapeLiteral(p.searchTerm)}')) AS similarity
    FROM ${escapeIdent(p.schema)}.${escapeIdent(p.table)}
    WHERE ${escapeIdent(p.column)} IS NOT NULL
      AND jaro_winkler_similarity(lower(${escapeIdent(p.column)}::VARCHAR), lower('${escapeLiteral(p.searchTerm)}')) > 0.6
    ORDER BY similarity DESC
    LIMIT ${p.limit}
  `;
  const result = await queryFn(sql);
  return { matches: rowsToMatches(result.rows), searchTerm: p.searchTerm, method: 'jaro_winkler' };
}

async function fuzzyPostgres(queryFn: QueryFn, p: Required<FuzzySearchParams>): Promise<FuzzySearchResult> {
  // Try pg_trgm similarity() first
  const trigramSql = `
    SELECT DISTINCT ${escapeIdent(p.column)}::TEXT AS value,
           similarity(lower(${escapeIdent(p.column)}::TEXT), lower('${escapeLiteral(p.searchTerm)}')) AS similarity
    FROM ${escapeIdent(p.schema)}.${escapeIdent(p.table)}
    WHERE ${escapeIdent(p.column)} IS NOT NULL
      AND similarity(lower(${escapeIdent(p.column)}::TEXT), lower('${escapeLiteral(p.searchTerm)}')) > 0.3
    ORDER BY similarity DESC
    LIMIT ${p.limit}
  `;
  try {
    const result = await queryFn(trigramSql);
    return { matches: rowsToMatches(result.rows), searchTerm: p.searchTerm, method: 'trigram' };
  } catch {
    // pg_trgm not available — fall back to ILIKE
    return fuzzySubstring(queryFn, p, 'double');
  }
}

async function fuzzyAthena(queryFn: QueryFn, p: Required<FuzzySearchParams>): Promise<FuzzySearchResult> {
  const maxDist = Math.max(Math.floor(p.searchTerm.length / 3), 3);
  const sql = `
    SELECT DISTINCT ${escapeIdent(p.column)} AS value,
           1.0 - CAST(levenshtein_distance(lower(CAST(${escapeIdent(p.column)} AS VARCHAR)), lower('${escapeLiteral(p.searchTerm)}')) AS DOUBLE)
                 / GREATEST(length(${escapeIdent(p.column)}), length('${escapeLiteral(p.searchTerm)}'), 1) AS similarity
    FROM ${escapeIdent(p.schema)}.${escapeIdent(p.table)}
    WHERE ${escapeIdent(p.column)} IS NOT NULL
      AND levenshtein_distance(lower(CAST(${escapeIdent(p.column)} AS VARCHAR)), lower('${escapeLiteral(p.searchTerm)}')) <= ${maxDist}
    ORDER BY similarity DESC
    LIMIT ${p.limit}
  `;
  const result = await queryFn(sql);
  return { matches: rowsToMatches(result.rows), searchTerm: p.searchTerm, method: 'levenshtein' };
}

type QuoteStyle = 'double' | 'backtick';

async function fuzzySubstring(queryFn: QueryFn, p: Required<FuzzySearchParams>, quoteStyle: QuoteStyle = 'double'): Promise<FuzzySearchResult> {
  const q = quoteStyle === 'backtick'
    ? (name: string) => `\`${name.replace(/`/g, '\\`')}\``
    : escapeIdent;

  const term = escapeLiteral(p.searchTerm).toLowerCase();
  // Split into words and join with % for flexible matching
  const words = term.split(/\s+/).filter(Boolean);
  const wordPattern = words.length > 1 ? `'%${words.join('%')}%'` : null;

  const conditions = [`LOWER(${q(p.column)}) LIKE '%${term}%'`];
  if (wordPattern) {
    conditions.push(`LOWER(${q(p.column)}) LIKE ${wordPattern}`);
  }

  const sql = `
    SELECT DISTINCT ${q(p.column)} AS value, 1.0 AS similarity
    FROM ${q(p.schema)}.${q(p.table)}
    WHERE ${q(p.column)} IS NOT NULL
      AND (${conditions.join(' OR ')})
    ORDER BY ${q(p.column)}
    LIMIT ${p.limit}
  `;
  const result = await queryFn(sql);
  return { matches: rowsToMatches(result.rows), searchTerm: p.searchTerm, method: 'substring' };
}

async function fuzzyBigQuery(queryFn: QueryFn, p: Required<FuzzySearchParams>): Promise<FuzzySearchResult> {
  const term = escapeLiteral(p.searchTerm);
  const q = (name: string) => `\`${name.replace(/`/g, '\\`')}\``;

  const sql = `
    SELECT DISTINCT ${q(p.column)} AS value, 1.0 AS similarity
    FROM ${q(p.schema)}.${q(p.table)}
    WHERE ${q(p.column)} IS NOT NULL
      AND (CONTAINS_SUBSTR(${q(p.column)}, '${term}')
           OR LOWER(${q(p.column)}) LIKE '%${term.toLowerCase()}%')
    ORDER BY ${q(p.column)}
    LIMIT ${p.limit}
  `;
  const result = await queryFn(sql);
  return { matches: rowsToMatches(result.rows), searchTerm: p.searchTerm, method: 'substring' };
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

export async function fuzzySearch(
  connectorType: string,
  queryFn: QueryFn,
  params: FuzzySearchParams,
): Promise<FuzzySearchResult> {
  const p = {
    ...params,
    schema: params.schema || 'main',
    limit: params.limit || 10,
  };

  switch (connectorType) {
    case 'duckdb':
    case 'csv':
    case 'google-sheets':
    case 'sqlite':
      return fuzzyDuckDb(queryFn, p);
    case 'postgresql':
      return fuzzyPostgres(queryFn, p);
    case 'bigquery':
      return fuzzyBigQuery(queryFn, p);
    case 'athena':
      return fuzzyAthena(queryFn, p);
    default:
      // MongoDB and unknown connectors — use basic substring matching
      return fuzzySubstring(queryFn, p);
  }
}
