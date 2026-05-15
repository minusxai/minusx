// Dialect hints for the V2 agent system prompt
// Rendered only for dialects present in the connection set

export interface DialectHint {
  dialect: string;
  fuzzyFunctions: string;
  additionalInfo?: string;
}

export const DIALECT_HINTS: Record<string, DialectHint> = {
  duckdb: {
    dialect: 'duckdb',
    fuzzyFunctions: 'jaro_winkler_similarity(), levenshtein(), jaccard()',
    additionalInfo: `DuckDB supports SUMMARIZE <table> for quick column stats. Use QUALIFY for window function filtering. Supports list/struct types natively.`,
  },
  sqlite: {
    dialect: 'sqlite',
    fuzzyFunctions: 'Use LIKE for basic pattern matching; no built-in fuzzy functions',
    additionalInfo: `SQLite uses || for string concatenation. Date functions: date(), datetime(), strftime().`,
  },
  postgresql: {
    dialect: 'postgresql',
    fuzzyFunctions: 'similarity() (requires pg_trgm extension), levenshtein() (requires fuzzystrmatch)',
    additionalInfo: `PostgreSQL supports ILIKE for case-insensitive matching. Use DISTINCT ON for deduplication. Array and JSON operators available.`,
  },
  bigquery: {
    dialect: 'bigquery',
    fuzzyFunctions: 'No built-in fuzzy functions; use SOUNDEX() or REGEXP for pattern matching',
    additionalInfo: `BigQuery uses backticks for identifiers. Supports SAFE_ prefix for error-tolerant functions. Use STRUCT and ARRAY for nested data.`,
  },
  mongo: {
    dialect: 'mongo',
    fuzzyFunctions: '$regex for pattern matching; Atlas Search for full-text/fuzzy search',
    additionalInfo: `For MongoDB connections, write native aggregation pipelines as JSON: {"collection": "<name>", "pipeline": [<stages>]}.
Common stages: $match, $group, $project, $sort, $limit, $lookup (joins), $unwind (array expansion).
Use $expr for complex conditions. $facet for multiple aggregations in one query.
Field references use $ prefix: "$fieldName", "$nested.field".
In sequential mode, $label.column references expand to JSON arrays for use with $in.`,
  },
};

/**
 * Render dialect hints for the given set of dialects.
 * Only includes hints for dialects actually present in connections.
 */
export function renderDialectHints(dialects: Set<string>): string {
  const hints: string[] = [];

  for (const dialect of dialects) {
    const hint = DIALECT_HINTS[dialect];
    if (!hint) continue;

    hints.push(`### ${dialect.toUpperCase()}
- Fuzzy/similarity: ${hint.fuzzyFunctions}
${hint.additionalInfo ? `- ${hint.additionalInfo}` : ''}`);
  }

  if (hints.length === 0) return '';

  return `## Dialect-Specific Features

${hints.join('\n\n')}`;
}

/**
 * Extract the set of dialects from connections.
 */
export function extractDialects(
  connections: Array<{ dialect: string }>,
): Set<string> {
  return new Set(connections.map((c) => c.dialect));
}
