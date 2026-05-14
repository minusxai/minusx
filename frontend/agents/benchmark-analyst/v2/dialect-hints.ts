/**
 * Dialect-specific hints for the V2 agent system prompt.
 * Only hints for dialects present in the connection set are rendered.
 */

export interface DialectHint {
  dialect: string;
  hints: string[];
}

export const DIALECT_HINTS: Record<string, DialectHint> = {
  duckdb: {
    dialect: 'duckdb',
    hints: [
      'DuckDB supports `jaro_winkler_similarity(a, b)` and `levenshtein(a, b)` for fuzzy string matching.',
      'Use `SUMMARIZE table_name` to get quick column statistics.',
      'DuckDB supports list comprehensions: `[x * 2 FOR x IN [1,2,3]]`.',
      'Use `read_csv_auto()` and `read_parquet()` for direct file queries.',
    ],
  },
  sqlite: {
    dialect: 'sqlite',
    hints: [
      'SQLite supports basic string functions: `LIKE`, `GLOB`, `INSTR()`, `SUBSTR()`.',
      'Use `COALESCE()` for null handling.',
      'SQLite has limited window function support compared to other databases.',
    ],
  },
  postgresql: {
    dialect: 'postgresql',
    hints: [
      'PostgreSQL supports `similarity(a, b)` from pg_trgm extension for fuzzy matching.',
      'Use `ILIKE` for case-insensitive matching.',
      'PostgreSQL has full window function support with `OVER()` clauses.',
      'Use `generate_series()` for sequence generation.',
    ],
  },
  bigquery: {
    dialect: 'bigquery',
    hints: [
      'BigQuery uses backticks for identifiers: `project.dataset.table`.',
      'Use `SAFE_DIVIDE(a, b)` to avoid division by zero errors.',
      'BigQuery supports `APPROX_COUNT_DISTINCT()` for fast cardinality estimation.',
      'Use `STRUCT` and `ARRAY` for complex data types.',
    ],
  },
  mongo: {
    dialect: 'mongo',
    hints: [
      'MongoDB queries use aggregation pipelines: `{"collection": "...", "pipeline": [...]}`.',
      'Common stages: `$match`, `$group`, `$project`, `$sort`, `$limit`, `$lookup` (for joins).',
      'Use `$regex` for pattern matching: `{"field": {"$regex": "pattern", "$options": "i"}}`.',
      'For text search: `{"$text": {"$search": "keywords"}}`.',
      '$label.column references expand to JSON arrays in pipelines.',
    ],
  },
};

/**
 * Render dialect hints for only the dialects present in the connection set.
 */
export function renderDialectHints(dialects: Set<string>): string {
  const relevantHints: string[] = [];

  for (const dialect of dialects) {
    const hint = DIALECT_HINTS[dialect];
    if (hint) {
      relevantHints.push(`### ${dialect.toUpperCase()}`);
      for (const h of hint.hints) {
        relevantHints.push(`- ${h}`);
      }
      relevantHints.push('');
    }
  }

  if (relevantHints.length === 0) {
    return '';
  }

  return `## Dialect-Specific Tips\n\n${relevantHints.join('\n')}`;
}

/**
 * Extract unique dialects from a list of connections.
 */
export function extractDialects(connections: Array<{ dialect: string }>): Set<string> {
  return new Set(connections.map(c => c.dialect));
}
