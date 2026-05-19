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
    crossDb: `Handle tables WORK here — \`FROM handle_xyz JOIN realtable ...\` is the right pattern, since duckdb queries run against the same in-memory engine where handles are registered. For non-duckdb connections, chain via \`sequential: true\` + \`$label.column\` instead.`,
  },
  sqlite: {
    dialect: 'sqlite',
    fuzzyFunctions: 'LIKE (case-insensitive for ASCII) and GLOB (case-sensitive, shell-style wildcards) for pattern matching; instr() / substr() for substrings. No built-in fuzzy/similarity functions — use the FuzzyMatch tool for that.',
    additionalInfo: `String concat: \`||\`. JSON parsing (built-in JSON1): \`json_each(arr)\` iterates an array, \`json_extract(val, '$.path')\` reads a field, \`json_array_length(arr)\`. Dates are stored as TEXT — parse with \`date()\` / \`datetime()\` / \`strftime('%Y', col)\`; extract a year as INT with \`CAST(strftime('%Y', col) AS INTEGER)\`. Math: \`POW(x, y)\`, \`ABS\`, \`ROUND\`. Sequence generation: \`WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n < 100) SELECT * FROM seq\`. Free-text pattern matching: combine \`substr\` + \`instr\` + \`GLOB\`; for case-insensitive substring use \`LIKE '%term%'\`.`,
    crossDb: `To chain into a sqlite connection from another connection, use \`sequential: true\` + \`$label.column\` — the referenced values inline as a SQL literal list (e.g. \`WHERE id IN ($amy.article_id)\` → \`WHERE id IN (192, 2161, ...)\`).`,
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
    crossDb: `Handle tables do NOT apply (Mongo isn't SQL). To chain from a SQL connection into Mongo, use \`$label.column\` — the string \`"$label.col"\` inside a mongo pipeline JSON expands to a real JSON array of the labeled column's values. **Labels persist across ExecuteQuery calls within an agent run**, so either pattern works:
  (a) Both queries in ONE call (sequential: true) — fine.
  (b) Labeling query in call 1, mongo reference in a SEPARATE call 2 — also fine. Most natural for "run SQL, see results, then go to mongo".

Example (separate calls — the common case):
  Call 1: ExecuteQuery({queries: [{connection: "metadata_db", query: "SELECT article_id FROM article_metadata WHERE author='Amy Jones'", label: "amy"}]})
  Call 2: ExecuteQuery({queries: [{connection: "articles_db", query: '{"collection":"articles","pipeline":[{"$match":{"article_id":{"$in":"$amy.article_id"}}},{"$project":{"title":1,"description":1,"_id":0}}]}'}]})
The "$amy.article_id" string in call 2's pipeline expands to the JSON array of article_ids labeled "amy" in call 1.

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
