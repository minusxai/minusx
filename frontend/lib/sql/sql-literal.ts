/**
 * Escape a value into a SQL string literal, correctly for the target engine.
 *
 * Prefer bound parameters. This exists for the paths that genuinely cannot use
 * them — chiefly `interpolateRefs`, which splices values from a prior query's
 * RESULTS into the next query's text before executing it with no parameters at
 * all. Those values come out of the customer's warehouse, so they are
 * attacker-influenced wherever that warehouse ingests user input.
 *
 * Doubling `'` is not sufficient on its own, and doubling `\` is not safe on its
 * own. Engines split into two camps:
 *
 *   - a backslash is an ordinary character (Postgres with the default
 *     `standard_conforming_strings`, DuckDB, SQLite, Presto/Athena). Verified for
 *     DuckDB: `SELECT 'a\\b'` returns two literal backslashes, and `SELECT '\''`
 *     is a parser error because the backslash did NOT escape the quote. Doubling
 *     backslashes here would change the value, not merely its encoding.
 *
 *   - a backslash escapes the next character (ClickHouse, BigQuery, MySQL). Here
 *     `\'` swallows the quote that was meant to close the literal, and everything
 *     after it is parsed as SQL. Backslashes must be doubled BEFORE quotes are.
 *
 * An unknown dialect is treated as escape-processing: over-escaping there is a
 * wrong value, while under-escaping is an injection.
 */

import { immutableSet } from '@/lib/utils/immutable-collections';

/** Dialects where a backslash escapes the following character inside a literal. */
const BACKSLASH_ESCAPES = immutableSet(['clickhouse', 'bigquery', 'mysql']);

/** Dialects where a backslash is an ordinary character inside a literal. */
const BACKSLASH_LITERAL = immutableSet(['postgres', 'postgresql', 'duckdb', 'sqlite', 'presto', 'trino', 'athena']);

/**
 * Wrap `value` as a single-quoted SQL literal, escaped for `dialect`.
 *
 * The result always starts and ends with a quote and can never be terminated by
 * its own contents. Never truncate the result: cutting it could split a `''` or
 * `\\` pair and reopen the string.
 */
export function escapeSqlLiteral(value: unknown, dialect: string): string {
  const s = String(value);
  const processesEscapes = BACKSLASH_ESCAPES.has(dialect) || !BACKSLASH_LITERAL.has(dialect);
  // Backslashes first — doubling them after the quotes would also double the
  // backslashes this step introduces.
  const escaped = (processesEscapes ? s.replace(/\\/g, '\\\\') : s).replace(/'/g, "''");
  return `'${escaped}'`;
}
