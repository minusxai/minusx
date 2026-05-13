/**
 * Inline `:name` parameter placeholders into a SQL string with their literal
 * values. Produces a single human-readable SQL string that approximates what
 * the database engine effectively saw — useful for display, logging, and
 * surfacing to LLMs as part of `ExecuteQuery` tool results.
 *
 * Caveat: the engine actually receives a prepared statement plus separately
 * bound values. Inlined strings can drift from engine semantics in edge cases
 * (NULL byte handling, dialect-specific date literals, etc.), but for every
 * normal value (number, boolean, string, Date, null) the round-trip is
 * faithful. This is the contract every `NodeConnector` returns as
 * `QueryResult.finalQuery`.
 */
function formatSqlLiteral(value: unknown): string {
  if (value == null) return 'NULL';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'NULL';
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date) return `'${value.toISOString()}'`;
  // Strings + everything else: double internal single quotes (standard SQL).
  // Backslashes are intentionally left as-is — Postgres (with the default
  // `standard_conforming_strings = on`), DuckDB, SQLite, and BigQuery all
  // treat backslash as a literal in single-quoted strings.
  const s = String(value);
  return `'${s.replace(/'/g, "''")}'`;
}

/**
 * Replace every `:name` placeholder in `sql` with the inlined SQL literal
 * form of `params[name]`. Placeholders without a matching param are left
 * untouched. Returns `sql` unchanged when there are no params.
 *
 * Placeholder grammar matches what every connector accepts: a `:` followed
 * by a leading letter/underscore and any number of word characters. The
 * regex captures the whole identifier in one go, so prefix collisions
 * (`:foo` vs `:foobar`) cannot occur.
 */
export function inlineSqlParams(
  sql: string,
  params?: Record<string, unknown>,
): string {
  if (!params || Object.keys(params).length === 0) return sql;
  return sql.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (match, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(params, name)) return match;
    return formatSqlLiteral(params[name]);
  });
}
