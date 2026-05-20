import 'server-only';

import type { QueryResult } from './base';

// ─── Types ───────────────────────────────────────────────────────────────────

type QueryFn = (sql: string) => Promise<QueryResult>;

export interface FuzzyMatchMatch {
  value: string;
  similarity: number;
  /** Extra column values when `returnColumns` is specified. Keyed by column name. */
  [key: string]: unknown;
}

export interface FuzzyMatchResultEntry {
  method: 'jaro_winkler' | 'trigram' | 'levenshtein' | 'substring';
  matches: FuzzyMatchMatch[];
  query: string;
}

export interface FuzzyMatchResult {
  results: FuzzyMatchResultEntry[];
  searchTerm: string;
  allEmpty: boolean;
}

interface FuzzyMatchParams {
  table: string;
  /** Columns to search. All are searched in a single query with OR conditions. */
  columns: string[];
  searchTerm: string;
  schema?: string;
  limit?: number;
  /** Additional columns to include in each match result (e.g. ['name', 'gmap_id']). */
  returnColumns?: string[];
}

/** Internal result type before allEmpty is computed. */
type RawFuzzyMatchResult = Omit<FuzzyMatchResult, 'allEmpty'>;

/** Params after defaults are applied (limit resolved, schema still optional). */
interface ResolvedParams {
  table: string;
  columns: string[];
  searchTerm: string;
  schema?: string;
  limit: number;
  returnColumns: string[];
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

/** Extract matches from query result rows, including searched columns and extra returnColumns. */
function rowsToMatches(rows: Record<string, unknown>[], columns: string[], returnColumns: string[] = []): FuzzyMatchMatch[] {
  return rows.map(r => {
    const match: FuzzyMatchMatch = {
      value: String(r['value'] ?? r[columns[0]] ?? ''),
      similarity: Number(r['similarity'] ?? 1),
    };
    for (const col of columns) {
      match[col] = r[col] ?? null;
    }
    for (const col of returnColumns) {
      match[col] = r[col] ?? null;
    }
    return match;
  });
}

/** Build the extra SELECT columns fragment for returnColumns. */
function extraSelectCols(returnColumns: string[], quoteFn: (name: string) => string = escapeIdent): string {
  if (returnColumns.length === 0) return '';
  return ', ' + returnColumns.map(c => quoteFn(c)).join(', ');
}

/** Build SELECT fragment for all searched columns. */
function searchedSelectCols(columns: string[], quoteFn: (name: string) => string = escapeIdent): string {
  return columns.map(c => quoteFn(c)).join(', ');
}

// ─── Per-Connector Strategies ────────────────────────────────────────────────

async function fuzzyDuckDb(queryFn: QueryFn, p: ResolvedParams): Promise<RawFuzzyMatchResult> {
  const extra = extraSelectCols(p.returnColumns);
  const searched = searchedSelectCols(p.columns);
  const fromTable = qualifiedTable(p.schema, p.table);
  const term = escapeLiteral(p.searchTerm);

  // Per-column similarity expressions
  const simExprs = p.columns.map(col => {
    const castCol = `CAST(${escapeIdent(col)} AS VARCHAR)`;
    return `jaro_winkler_similarity(lower(${castCol}), lower('${term}'))`;
  });
  const greatestSim = simExprs.length === 1 ? simExprs[0] : `GREATEST(${simExprs.join(', ')})`;

  // WHERE: any column exceeds threshold
  const whereConditions = p.columns.map((col, i) =>
    `(${escapeIdent(col)} IS NOT NULL AND ${simExprs[i]} > 0.8)`,
  );

  const sql = `
    SELECT ${searched}, ${greatestSim} AS similarity${extra}
    FROM ${fromTable}
    WHERE ${whereConditions.join('\n      OR ')}
    ORDER BY similarity DESC
    LIMIT ${p.limit}
  `;
  const [jaroResult, substringEntry] = await Promise.all([
    queryFn(sql),
    fuzzySubstring(queryFn, p),
  ]);
  return {
    results: [
      { matches: rowsToMatches(jaroResult.rows, p.columns, p.returnColumns), method: 'jaro_winkler', query: sql.trim() },
      substringEntry,
    ],
    searchTerm: p.searchTerm,
  };
}

async function fuzzyPostgres(queryFn: QueryFn, p: ResolvedParams): Promise<RawFuzzyMatchResult> {
  const extra = extraSelectCols(p.returnColumns);
  const searched = searchedSelectCols(p.columns);
  const fromTable = qualifiedTable(p.schema, p.table);
  const term = escapeLiteral(p.searchTerm);

  const simExprs = p.columns.map(col => {
    const castCol = `CAST(${escapeIdent(col)} AS TEXT)`;
    return `similarity(lower(${castCol}), lower('${term}'))`;
  });
  const greatestSim = simExprs.length === 1 ? simExprs[0] : `GREATEST(${simExprs.join(', ')})`;

  const whereConditions = p.columns.map((col, i) =>
    `(${escapeIdent(col)} IS NOT NULL AND ${simExprs[i]} > 0.3)`,
  );

  const trigramSql = `
    SELECT ${searched}, ${greatestSim} AS similarity${extra}
    FROM ${fromTable}
    WHERE ${whereConditions.join('\n      OR ')}
    ORDER BY similarity DESC
    LIMIT ${p.limit}
  `;
  // Run substring in parallel; attempt trigram separately so its failure
  // doesn't cancel substring. CRITICAL: wrap substring's promise in a
  // catch IMMEDIATELY (before any other await) — otherwise if it rejects
  // during the `await queryFn(trigramSql)` below, Node sees an unattended
  // rejection and (>= v15) terminates the process. We capture the
  // rejection here and re-throw at the await point so the caller gets a
  // normal error path.
  const substringSettled: Promise<FuzzyMatchResultEntry | { __err: unknown }> =
    fuzzySubstring(queryFn, p).catch((err: unknown) => ({ __err: err }));
  let trigramEntry: FuzzyMatchResultEntry | null = null;
  try {
    const trigramResult = await queryFn(trigramSql);
    trigramEntry = { matches: rowsToMatches(trigramResult.rows, p.columns, p.returnColumns), method: 'trigram', query: trigramSql.trim() };
  } catch {
    // pg_trgm not available — skip trigram
  }
  const substringResult = await substringSettled;
  if (substringResult && typeof substringResult === 'object' && '__err' in substringResult) {
    throw substringResult.__err;
  }
  const substringEntry = substringResult as FuzzyMatchResultEntry;
  const results = trigramEntry ? [trigramEntry, substringEntry] : [substringEntry];
  return { results, searchTerm: p.searchTerm };
}

async function fuzzyAthena(queryFn: QueryFn, p: ResolvedParams): Promise<RawFuzzyMatchResult> {
  const maxDist = Math.max(Math.floor(p.searchTerm.length / 3), 3);
  const extra = extraSelectCols(p.returnColumns);
  const searched = searchedSelectCols(p.columns);
  const fromTable = qualifiedTable(p.schema, p.table);
  const term = escapeLiteral(p.searchTerm);

  const simExprs = p.columns.map(col =>
    `1.0 - CAST(levenshtein_distance(lower(CAST(${escapeIdent(col)} AS VARCHAR)), lower('${term}')) AS DOUBLE)
                 / GREATEST(length(${escapeIdent(col)}), length('${term}'), 1)`,
  );
  const greatestSim = simExprs.length === 1 ? simExprs[0] : `GREATEST(${simExprs.join(', ')})`;

  const whereConditions = p.columns.map(col =>
    `(${escapeIdent(col)} IS NOT NULL AND levenshtein_distance(lower(CAST(${escapeIdent(col)} AS VARCHAR)), lower('${term}')) <= ${maxDist})`,
  );

  const sql = `
    SELECT ${searched}, ${greatestSim} AS similarity${extra}
    FROM ${fromTable}
    WHERE ${whereConditions.join('\n      OR ')}
    ORDER BY similarity DESC
    LIMIT ${p.limit}
  `;
  const [levenResult, substringEntry] = await Promise.all([
    queryFn(sql),
    fuzzySubstring(queryFn, p),
  ]);
  return {
    results: [
      { matches: rowsToMatches(levenResult.rows, p.columns, p.returnColumns), method: 'levenshtein', query: sql.trim() },
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
  const words = term.split(/\s+/).filter(Boolean);
  const wordPattern = words.length > 1 ? `'%${words.join('%')}%'` : null;

  // Build OR conditions across all columns
  const conditions: string[] = [];
  for (const column of p.columns) {
    conditions.push(`LOWER(${q(column)}) LIKE '%${term}%'`);
    if (wordPattern) {
      conditions.push(`LOWER(${q(column)}) LIKE ${wordPattern}`);
    }
    if (words.length > 1) {
      for (const word of words) {
        conditions.push(`LOWER(${q(column)}) LIKE '%${word}%'`);
      }
    }
  }

  // Similarity = best match across columns (ratio of search term length to column value length)
  const termLen = term.length;
  const simExprs = p.columns.map(column =>
    `${termLen}.0 / (CASE WHEN LENGTH(${q(column)}) > 0 THEN LENGTH(${q(column)}) ELSE 1 END)`,
  );
  const greatestSim = simExprs.length === 1 ? simExprs[0] : `GREATEST(${simExprs.join(', ')})`;

  const searched = searchedSelectCols(p.columns, q);
  const extra = extraSelectCols(p.returnColumns, q);
  const sql = `
    SELECT ${searched}, ${greatestSim} AS similarity${extra}
    FROM ${qualifiedTable(p.schema, p.table, q)}
    WHERE (${conditions.join(' OR ')})
    ORDER BY similarity DESC
    LIMIT ${p.limit}
  `;
  const result = await queryFn(sql);
  return { matches: rowsToMatches(result.rows, p.columns, p.returnColumns), method: 'substring', query: sql.trim() };
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
  // Build $or match across all columns
  const orConditions = p.columns.map(column => ({
    [column]: { $regex: escapeRegex(p.searchTerm), $options: 'i' },
  }));
  const matchStage = { $match: orConditions.length === 1 ? orConditions[0] : { $or: orConditions } };

  const projectFields: Record<string, unknown> = { _id: 0, similarity: { $literal: 1 } };
  for (const col of p.columns) {
    projectFields[col] = `$${col}`;
  }
  for (const col of p.returnColumns) {
    projectFields[col] = `$${col}`;
  }

  const pipeline = [
    matchStage,
    { $limit: p.limit },
    { $project: projectFields },
  ];
  const query = JSON.stringify({ collection: p.table, pipeline });
  const result = await queryFn(query);
  return {
    results: [{ matches: rowsToMatches(result.rows, p.columns, p.returnColumns), method: 'substring', query }],
    searchTerm: p.searchTerm,
  };
}

async function fuzzyBigQuery(queryFn: QueryFn, p: ResolvedParams): Promise<RawFuzzyMatchResult> {
  const term = escapeLiteral(p.searchTerm);
  const q = (name: string) => `\`${name.replace(/`/g, '\\`')}\``;
  const extra = extraSelectCols(p.returnColumns, q);
  const searched = searchedSelectCols(p.columns, q);
  const fromTable = qualifiedTable(p.schema, p.table, q);

  const whereConditions = p.columns.map(column =>
    `(${q(column)} IS NOT NULL AND (CONTAINS_SUBSTR(${q(column)}, '${term}') OR LOWER(${q(column)}) LIKE '%${term.toLowerCase()}%'))`,
  );

  const sql = `
    SELECT ${searched}, 1.0 AS similarity${extra}
    FROM ${fromTable}
    WHERE ${whereConditions.join('\n      OR ')}
    LIMIT ${p.limit}
  `;
  const result = await queryFn(sql);
  return {
    results: [{ matches: rowsToMatches(result.rows, p.columns, p.returnColumns), method: 'substring', query: sql.trim() }],
    searchTerm: p.searchTerm,
  };
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

export async function fuzzyMatch(
  connectorType: string,
  queryFn: QueryFn,
  params: FuzzyMatchParams,
): Promise<FuzzyMatchResult> {
  const p: ResolvedParams = {
    ...params,
    schema: params.schema,
    limit: params.limit || 100,
    returnColumns: params.returnColumns ?? [],
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
