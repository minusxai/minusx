import 'server-only';

import type { QueryResult } from './base';

// ─── Types ───────────────────────────────────────────────────────────────────

type QueryFn = (sql: string) => Promise<QueryResult>;

export interface FuzzyMatchResultEntry {
  method: 'jaro_winkler' | 'trigram' | 'levenshtein' | 'substring';
  matches: Array<{ value: string; similarity: number }>;
  query: string;
}

export interface FuzzyMatchResult {
  results: FuzzyMatchResultEntry[];
  searchTerm: string;
  allEmpty: boolean;
}

interface FuzzyMatchParams {
  table: string;
  column: string;
  searchTerm: string;
  schema?: string;
  limit?: number;
}

/** Internal result type before allEmpty is computed. */
type RawFuzzyMatchResult = Omit<FuzzyMatchResult, 'allEmpty'>;

/** Params after defaults are applied (limit resolved, schema still optional). */
interface ResolvedParams {
  table: string;
  column: string;
  searchTerm: string;
  schema?: string;
  limit: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Escape a SQL identifier (table/column/schema name) for double-quoting. */
function escapeIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Build a qualified table reference, omitting schema if not provided. */
function qualifiedTable(schema: string | undefined, table: string, quoteFn: (name: string) => string = escapeIdent): string {
  return schema ? `${quoteFn(schema)}.${quoteFn(table)}` : quoteFn(table);
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

async function fuzzyDuckDb(queryFn: QueryFn, p: ResolvedParams): Promise<RawFuzzyMatchResult> {
  const col = escapeIdent(p.column);
  const castCol = `CAST(${col} AS VARCHAR)`;
  const sql = `
    SELECT DISTINCT ${castCol} AS value,
           jaro_winkler_similarity(lower(${castCol}), lower('${escapeLiteral(p.searchTerm)}')) AS similarity
    FROM ${qualifiedTable(p.schema, p.table)}
    WHERE ${col} IS NOT NULL
      AND jaro_winkler_similarity(lower(${castCol}), lower('${escapeLiteral(p.searchTerm)}')) > 0.8
    ORDER BY similarity DESC
    LIMIT ${p.limit}
  `;
  const [jaroResult, substringEntry] = await Promise.all([
    queryFn(sql),
    fuzzySubstring(queryFn, p),
  ]);
  return {
    results: [
      { matches: rowsToMatches(jaroResult.rows), method: 'jaro_winkler', query: sql.trim() },
      substringEntry,
    ],
    searchTerm: p.searchTerm,
  };
}

async function fuzzyPostgres(queryFn: QueryFn, p: ResolvedParams): Promise<RawFuzzyMatchResult> {
  const col = escapeIdent(p.column);
  const castCol = `CAST(${col} AS TEXT)`;
  const trigramSql = `
    SELECT DISTINCT ${castCol} AS value,
           similarity(lower(${castCol}), lower('${escapeLiteral(p.searchTerm)}')) AS similarity
    FROM ${qualifiedTable(p.schema, p.table)}
    WHERE ${col} IS NOT NULL
      AND similarity(lower(${castCol}), lower('${escapeLiteral(p.searchTerm)}')) > 0.3
    ORDER BY similarity DESC
    LIMIT ${p.limit}
  `;
  // Run substring in parallel; attempt trigram separately so its failure doesn't cancel substring
  const substringPromise = fuzzySubstring(queryFn, p);
  let trigramEntry: FuzzyMatchResultEntry | null = null;
  try {
    const trigramResult = await queryFn(trigramSql);
    trigramEntry = { matches: rowsToMatches(trigramResult.rows), method: 'trigram', query: trigramSql.trim() };
  } catch {
    // pg_trgm not available — skip trigram
  }
  const substringEntry = await substringPromise;
  const results = trigramEntry ? [trigramEntry, substringEntry] : [substringEntry];
  return { results, searchTerm: p.searchTerm };
}

async function fuzzyAthena(queryFn: QueryFn, p: ResolvedParams): Promise<RawFuzzyMatchResult> {
  const maxDist = Math.max(Math.floor(p.searchTerm.length / 3), 3);
  const sql = `
    SELECT DISTINCT ${escapeIdent(p.column)} AS value,
           1.0 - CAST(levenshtein_distance(lower(CAST(${escapeIdent(p.column)} AS VARCHAR)), lower('${escapeLiteral(p.searchTerm)}')) AS DOUBLE)
                 / GREATEST(length(${escapeIdent(p.column)}), length('${escapeLiteral(p.searchTerm)}'), 1) AS similarity
    FROM ${qualifiedTable(p.schema, p.table)}
    WHERE ${escapeIdent(p.column)} IS NOT NULL
      AND levenshtein_distance(lower(CAST(${escapeIdent(p.column)} AS VARCHAR)), lower('${escapeLiteral(p.searchTerm)}')) <= ${maxDist}
    ORDER BY similarity DESC
    LIMIT ${p.limit}
  `;
  const [levenResult, substringEntry] = await Promise.all([
    queryFn(sql),
    fuzzySubstring(queryFn, p),
  ]);
  return {
    results: [
      { matches: rowsToMatches(levenResult.rows), method: 'levenshtein', query: sql.trim() },
      substringEntry,
    ],
    searchTerm: p.searchTerm,
  };
}

type QuoteStyle = 'double' | 'backtick';

async function fuzzySubstring(queryFn: QueryFn, p: ResolvedParams, quoteStyle: QuoteStyle = 'double'): Promise<FuzzyMatchResultEntry> {
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
  // Add per-word matching so partial matches (e.g. "green" from "green energy") are found
  if (words.length > 1) {
    for (const word of words) {
      conditions.push(`LOWER(${q(p.column)}) LIKE '%${word}%'`);
    }
  }

  const termLen = term.length;
  const lenExpr = `LENGTH(${q(p.column)})`;
  const sql = `
    SELECT DISTINCT ${q(p.column)} AS value,
           ${termLen}.0 / (CASE WHEN ${lenExpr} > 0 THEN ${lenExpr} ELSE 1 END) AS similarity
    FROM ${qualifiedTable(p.schema, p.table, q)}
    WHERE ${q(p.column)} IS NOT NULL
      AND (${conditions.join(' OR ')})
    ORDER BY similarity DESC
    LIMIT ${p.limit}
  `;
  const result = await queryFn(sql);
  return { matches: rowsToMatches(result.rows), method: 'substring', query: sql.trim() };
}

/** Escape a string for literal use inside a MongoDB `$regex`. */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 200);
}

/**
 * MongoDB fuzzy search — native aggregation, no SQL. The `queryFn` here runs
 * a JSON `{collection,pipeline}` string (the same shape `MongoConnector.query`
 * expects). Mongo's `$regex` is a binary (case-insensitive) substring/pattern
 * match with no graded similarity, so every hit scores 1 and the method is
 * reported as `'substring'` — consistent with the other substring-only
 * connectors. `p.schema` is irrelevant for Mongo (single-database connector);
 * `p.table` is the collection name.
 */
async function fuzzyMongo(queryFn: QueryFn, p: ResolvedParams): Promise<RawFuzzyMatchResult> {
  const pipeline = [
    { $match: { [p.column]: { $regex: escapeRegex(p.searchTerm), $options: 'i' } } },
    { $group: { _id: `$${p.column}` } },
    { $limit: p.limit },
    { $project: { _id: 0, value: '$_id', similarity: { $literal: 1 } } },
  ];
  const query = JSON.stringify({ collection: p.table, pipeline });
  const result = await queryFn(query);
  return {
    results: [{ matches: rowsToMatches(result.rows), method: 'substring', query }],
    searchTerm: p.searchTerm,
  };
}

async function fuzzyBigQuery(queryFn: QueryFn, p: ResolvedParams): Promise<RawFuzzyMatchResult> {
  const term = escapeLiteral(p.searchTerm);
  const q = (name: string) => `\`${name.replace(/`/g, '\\`')}\``;

  const sql = `
    SELECT DISTINCT ${q(p.column)} AS value, 1.0 AS similarity
    FROM ${qualifiedTable(p.schema, p.table, q)}
    WHERE ${q(p.column)} IS NOT NULL
      AND (CONTAINS_SUBSTR(${q(p.column)}, '${term}')
           OR LOWER(${q(p.column)}) LIKE '%${term.toLowerCase()}%')
    ORDER BY ${q(p.column)}
    LIMIT ${p.limit}
  `;
  const result = await queryFn(sql);
  return {
    results: [{ matches: rowsToMatches(result.rows), method: 'substring', query: sql.trim() }],
    searchTerm: p.searchTerm,
  };
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

export async function fuzzyMatch(
  connectorType: string,
  queryFn: QueryFn,
  params: FuzzyMatchParams,
): Promise<FuzzyMatchResult> {
  const p = {
    ...params,
    schema: params.schema,
    limit: params.limit || 100,
  };

  let raw: RawFuzzyMatchResult;

  switch (connectorType) {
    case 'duckdb':
    case 'csv':
    case 'google-sheets':
    case 'sqlite':
      raw = await fuzzyDuckDb(queryFn, p);
      break;
    case 'postgresql':
      raw = await fuzzyPostgres(queryFn, p);
      break;
    case 'bigquery':
      raw = await fuzzyBigQuery(queryFn, p);
      break;
    case 'athena':
      raw = await fuzzyAthena(queryFn, p);
      break;
    case 'mongo':
      raw = await fuzzyMongo(queryFn, p);
      break;
    default: {
      // Unknown connectors — fall back to a basic SQL substring match.
      const substringEntry = await fuzzySubstring(queryFn, p);
      raw = { results: [substringEntry], searchTerm: p.searchTerm };
    }
  }

  return {
    ...raw,
    allEmpty: raw.results.every(r => r.matches.length === 0),
  };
}
