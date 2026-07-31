/**
 * Escaping a value into SQL text must depend on the dialect.
 *
 * `interpolateRefs` substitutes values from a PRIOR query's results into the SQL
 * of the next one, and that SQL is then executed as a literal string with no bound
 * parameters (`connector.query(finalQuery, undefined, …)`). The values are rows out
 * of the customer's warehouse, so they are attacker-influenced wherever the
 * warehouse ingests user input — second-order injection.
 *
 * It escaped by doubling single quotes only. That is correct on engines where a
 * backslash is an ordinary character, and WRONG on engines where a backslash
 * escapes the following character: there, `\'` consumes the quote that was meant to
 * close the string, and everything after it is parsed as SQL.
 *
 * Verified empirically for DuckDB — `SELECT '\''` is a parser error and
 * `SELECT 'a\\b'` yields the two literal backslashes — which is why doubling
 * backslashes unconditionally is not the fix either: on DuckDB and Postgres it
 * would corrupt every value containing one. ClickHouse and BigQuery do process
 * backslash escapes, so they need it.
 *
 * The property under test is the one that matters: whatever the dialect, a value
 * cannot terminate its own literal.
 */
import { describe, it, expect } from 'vitest';
import { escapeSqlLiteral } from '@/lib/sql/sql-literal';

/** Everything after the opening quote, with the closing quote removed. */
const body = (lit: string) => lit.slice(1, -1);

/** Count quote characters that are NOT part of a doubled pair or backslash-escaped. */
function terminatesEarly(literal: string, backslashEscapes: boolean): boolean {
  const inner = body(literal);
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (backslashEscapes && ch === '\\') { i++; continue; }   // escaped char, skip
    if (ch === "'") {
      if (inner[i + 1] === "'") { i++; continue; }            // doubled, fine
      return true;                                            // a bare quote closes the string
    }
  }
  return false;
}

const BACKSLASH_DIALECTS = ['clickhouse', 'bigquery'];
const LITERAL_BACKSLASH_DIALECTS = ['duckdb', 'postgres', 'sqlite', 'presto'];

const HOSTILE = [
  String.raw`\'`,                 // the breakout: escapes the quote the escaper added
  String.raw`\' OR 1=1 --`,
  "'",                            // plain quote
  String.raw`a\b`,                // an ordinary Windows-ish path
  String.raw`\\`,
  "normal value",
];

describe('escapeSqlLiteral', () => {
  for (const dialect of [...BACKSLASH_DIALECTS, ...LITERAL_BACKSLASH_DIALECTS]) {
    for (const value of HOSTILE) {
      it(`${dialect}: ${JSON.stringify(value)} cannot terminate its own literal`, () => {
        const lit = escapeSqlLiteral(value, dialect);
        expect(lit.startsWith("'")).toBe(true);
        expect(lit.endsWith("'")).toBe(true);
        expect(terminatesEarly(lit, BACKSLASH_DIALECTS.includes(dialect))).toBe(false);
      });
    }
  }

  it('does not double backslashes where a backslash is an ordinary character', () => {
    // Doing so on DuckDB/Postgres would change the VALUE, not just its encoding.
    expect(escapeSqlLiteral(String.raw`a\b`, 'duckdb')).toBe(String.raw`'a\b'`);
    expect(escapeSqlLiteral(String.raw`a\b`, 'postgres')).toBe(String.raw`'a\b'`);
  });

  it('doubles backslashes where the engine processes escapes', () => {
    expect(escapeSqlLiteral(String.raw`a\b`, 'clickhouse')).toBe(String.raw`'a\\b'`);
    expect(escapeSqlLiteral(String.raw`a\b`, 'bigquery')).toBe(String.raw`'a\\b'`);
  });

  it('defaults to the safer treatment for an unknown dialect', () => {
    // An unrecognised engine might process escapes; assume it does.
    expect(escapeSqlLiteral(String.raw`\'`, 'something-new')).toBe(String.raw`'\\'''`);
  });

  it('never truncates after escaping, which would split an escape pair', () => {
    const long = "x".repeat(300) + "'";
    const lit = escapeSqlLiteral(long, 'duckdb');
    expect(terminatesEarly(lit, false)).toBe(false);
  });
});
