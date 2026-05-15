// Per-dialect hints for the V2 agent system prompt.
//
// Rendered ONLY for dialects actually present in the connection set — so the
// prompt scales with the dataset's connections rather than carrying every
// dialect's syntax and chaining advice all the time. Three things per dialect:
//   - fuzzyFunctions: per-dialect lexical/fuzzy SQL/operators
//   - additionalInfo: dialect-specific SQL/pipeline syntax notes
//   - crossDb: how this dialect interacts with the handle-and-chain model
//     (handle tables only resolve inside the shared in-memory DuckDB engine,
//     so duckdb/sqlite chain by handle; everything else chains by sequential
//     mode + `$label.column` interpolation).

export interface DialectHint {
  dialect: string;
  fuzzyFunctions: string;
  additionalInfo?: string;
  /** Handle-table applicability + $label.column chaining notes for this dialect. */
  crossDb?: string;
}

export const DIALECT_HINTS: Record<string, DialectHint> = {
  duckdb: {
    dialect: 'duckdb',
    fuzzyFunctions: 'jaro_winkler_similarity(), levenshtein(), jaccard()',
    additionalInfo: `DuckDB supports SUMMARIZE <table> for quick column stats. Use QUALIFY for window function filtering. Supports list/struct types natively.`,
    crossDb: `Handle tables WORK here — \`FROM handle_xyz JOIN realtable ...\` is the right pattern. Both duckdb and benchmark-sqlite share one in-memory DuckDB instance, so handles can be joined across either.`,
  },
  sqlite: {
    dialect: 'sqlite',
    // Benchmark sqlite is DuckDB-attached, so DuckDB SQL functions work here.
    fuzzyFunctions: 'jaro_winkler_similarity() (benchmark sqlite routes through DuckDB), LIKE/ILIKE for substring',
    additionalInfo: `SQLite uses || for string concatenation. Date functions: date(), datetime(), strftime().`,
    crossDb: `Handle tables WORK here — \`FROM handle_xyz JOIN realtable ...\`. Benchmark sqlite shares the same in-memory DuckDB instance as duckdb connections, so handles can be joined across either.`,
  },
  postgresql: {
    dialect: 'postgresql',
    fuzzyFunctions: 'similarity() (requires pg_trgm extension), levenshtein() (requires fuzzystrmatch)',
    additionalInfo: `PostgreSQL supports ILIKE for case-insensitive matching. Use DISTINCT ON for deduplication. Array and JSON operators available.`,
    crossDb: `Handle tables do NOT work here — the handle lives in the local DuckDB instance, not in postgres. To chain from another connection into postgres (or vice versa), use \`sequential: true\` + \`$label.column\` — the referenced values inline as a SQL literal list (e.g. \`WHERE id IN ($amy.article_id)\` → \`WHERE id IN (192, 2161, ...)\`).`,
  },
  bigquery: {
    dialect: 'bigquery',
    fuzzyFunctions: 'No built-in fuzzy functions; use SOUNDEX() or REGEXP for pattern matching',
    additionalInfo: `BigQuery uses backticks for identifiers. Supports SAFE_ prefix for error-tolerant functions. Use STRUCT and ARRAY for nested data.`,
    crossDb: `Handle tables do NOT work here — the handle lives in the local DuckDB instance, not in BigQuery. To chain into BigQuery, use \`sequential: true\` + \`$label.column\` (inlined as a SQL literal list).`,
  },
  mongo: {
    dialect: 'mongo',
    fuzzyFunctions: '$regex for pattern matching; Atlas Search for full-text/fuzzy search',
    additionalInfo: `MongoDB connections take native aggregation pipelines as JSON: \`{"collection": "<name>", "pipeline": [<stages>]}\`.
Common stages: $match, $group, $project, $sort, $limit, $lookup (joins), $unwind (array expansion).
Use $expr for complex conditions. $facet for multiple aggregations in one query.
Field references use $ prefix: "$fieldName", "$nested.field".`,
    crossDb: `Handle tables do NOT apply (Mongo isn't SQL). To chain from a SQL connection into Mongo, use \`sequential: true\` + \`$label.column\` — the string \`"$label.col"\` inside the pipeline JSON expands to a real JSON array:
  sequential: true
  query1: {connection: "metadata_db", query: "SELECT article_id FROM article_metadata WHERE author='Amy Jones'", label: "amy"}
  query2: {connection: "articles_db", query: '{"collection":"articles","pipeline":[{"$match":{"article_id":{"$in":"$amy.article_id"}}},{"$project":{"title":1,"description":1}}]}'}
NEVER paste long inline \`$in\` arrays — \`$label.col\` is exactly the way to avoid that.`,
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

    const lines = [`### ${dialect.toUpperCase()}`];
    lines.push(`- Fuzzy/similarity: ${hint.fuzzyFunctions}`);
    if (hint.additionalInfo) lines.push(`- ${hint.additionalInfo}`);
    if (hint.crossDb) lines.push(`- Cross-DB: ${hint.crossDb}`);
    hints.push(lines.join('\n'));
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
