// Convert `:paramName` placeholders to `$N` positional ones, reusing the
// same index for repeated names. Shared by every SQL connector
// (Postgres / DuckDB / SQLite / Athena / Internal pglite); BigQuery does
// its own thing (`:name → @name`).
//
// `(?<!:)` negative lookbehind: the second `:` of a PostgreSQL `::cast`
// operator (`col::text`, `::numeric`, etc.) is NOT a placeholder. Without
// this, the substitution mangles type casts and the query reaches the
// engine as `col:$N` — syntax error at the colon position. That's how the
// catalog-build `pg_stats` query died: `most_common_vals::text` became
// `most_common_vals:$1` in the rewritten SQL.

export interface NamedToPositionalResult {
  sql: string;
  /** Values in `$1, $2, …` order. `null` filled in for any name not in `params`. */
  values: unknown[];
}

export function namedToPositional(
  sql: string,
  params?: Record<string, string | number>,
): NamedToPositionalResult {
  const values: unknown[] = [];
  const seen: Record<string, number> = {};
  const out = sql.replace(/(?<!:):([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, key: string) => {
    if (!(key in seen)) {
      values.push(params?.[key] ?? null);
      seen[key] = values.length;
    }
    return `$${seen[key]}`;
  });
  return { sql: out, values };
}
