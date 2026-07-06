// Named-parameter (`:paramName`) rewriting grammar, shared by every SQL
// connector. Each connector rewrites `:name` into its own driver's
// placeholder syntax — Postgres/DuckDB/SQLite/Athena's-internal-form → `$N`
// positional (`namedToPositional`, below), ClickHouse → `{name:Type}`,
// BigQuery → `@name`, Athena → `?` — but they all share the SAME matching
// grammar, so that grammar is centralized here as `rewriteNamedParams` and
// each connector supplies only its own replacement/mapping function.
//
// `(?<!:)` negative lookbehind: the second `:` of a PostgreSQL-style `::cast`
// operator (`col::text`, `::numeric`, etc.) is NOT a placeholder. Without
// this, the substitution mangles type casts and the query reaches the
// engine as `col:$N` — syntax error at the colon position. That's how the
// catalog-build `pg_stats` query died: `most_common_vals::text` became
// `most_common_vals:$1` in the rewritten SQL. Every dialect that uses this
// grammar (Postgres, DuckDB, SQLite, Athena/Trino, ClickHouse, and legacy
// SQL BigQuery may still contain) supports or tolerates `::cast` syntax, so
// the lookbehind is preserved verbatim wherever this grammar is reused —
// do not simplify it.

/**
 * Rewrite every `:name` placeholder in `sql`. For each match, `mapFn` is
 * called with the parameter name and its value (`params?.[name]`, `undefined`
 * if absent) and must return the replacement text for that occurrence.
 * `mapFn` is expected to do its own side-effecting accumulation (push a
 * positional value, record a `query_params` entry, …) via closure.
 */
export function rewriteNamedParams(
  sql: string,
  params: Record<string, string | number> | undefined,
  mapFn: (name: string, value: string | number | undefined) => string,
): string {
  return sql.replace(/(?<!:):([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, key: string) => mapFn(key, params?.[key]));
}

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
  const out = rewriteNamedParams(sql, params, (key, value) => {
    if (!(key in seen)) {
      values.push(value ?? null);
      seen[key] = values.length;
    }
    return `$${seen[key]}`;
  });
  return { sql: out, values };
}
