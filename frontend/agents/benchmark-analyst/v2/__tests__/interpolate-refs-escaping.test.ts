/**
 * A value from a prior query's results must not be able to inject SQL.
 *
 * `interpolateRefs` splices `$label.column` with values taken from an EARLIER
 * query's rows, and the result is executed as literal SQL with no bound
 * parameters (`connector.query(finalQuery, undefined, …)` in `db-tools.ts`). Those
 * rows come out of the customer's warehouse, so wherever that warehouse ingests
 * user input this is a second-order injection path.
 *
 * It escaped by doubling single quotes only, which is correct on DuckDB/Postgres
 * (backslash is an ordinary character) and wrong on ClickHouse/BigQuery (backslash
 * escapes the next character, so `\'` eats the closing quote and the rest of the
 * value is parsed as SQL).
 *
 * The escaping itself is `escapeSqlLiteral`; this asserts the call site passes the
 * dialect through, which is the half that was missing.
 */
import { describe, it, expect } from 'vitest';
import { interpolateRefs } from '@/agents/benchmark-analyst/v2/query-refs';

const rows = (v: unknown) => new Map([['prior', [{ name: v }]]]);

/**
 * True when the literal's contents can close it early. Walks the body the way the
 * engine would: on an escape-processing dialect a backslash consumes the next
 * character, and a doubled quote is one literal quote.
 */
function terminatesEarly(sql: string, backslashEscapes: boolean): boolean {
  const open = sql.indexOf("'");
  if (open === -1) return false;
  const inner = sql.slice(open + 1, sql.lastIndexOf("'"));
  for (let i = 0; i < inner.length; i++) {
    if (backslashEscapes && inner[i] === '\\') { i++; continue; }
    if (inner[i] === "'") {
      if (inner[i + 1] === "'") { i++; continue; }
      return true;
    }
  }
  return false;
}

describe('interpolateRefs escapes per dialect', () => {
  it('neutralises a backslash breakout on ClickHouse', () => {
    const out = interpolateRefs("SELECT * FROM t WHERE n IN ($prior.name)", rows(String.raw`\' OR 1=1 --`), 'clickhouse');
    // The backslash must be doubled so it escapes itself; the OR then stays inside
    // the literal instead of becoming SQL.
    expect(out).toContain(String.raw`\\`);
    expect(terminatesEarly(out, true)).toBe(false);
  });

  it('neutralises the same value on BigQuery', () => {
    const out = interpolateRefs("SELECT $prior.name", rows(String.raw`\'`), 'bigquery');
    expect(out).toContain(String.raw`\\`);
  });

  it('does NOT double backslashes on DuckDB, where they are literal', () => {
    // Doubling here would corrupt the value rather than protect the query.
    const out = interpolateRefs("SELECT $prior.name", rows(String.raw`a\b`), 'duckdb');
    expect(out).toBe(String.raw`SELECT 'a\b'`);
  });

  it('still doubles quotes on every dialect', () => {
    expect(interpolateRefs("SELECT $prior.name", rows("O'Brien"), 'duckdb')).toBe("SELECT 'O''Brien'");
    expect(interpolateRefs("SELECT $prior.name", rows("O'Brien"), 'clickhouse')).toBe("SELECT 'O''Brien'");
  });

  it('leaves numbers bare and missing labels as NULL', () => {
    expect(interpolateRefs("SELECT $prior.name", rows(42), 'duckdb')).toBe('SELECT 42');
    expect(interpolateRefs("SELECT $missing.name", rows(1), 'duckdb')).toBe('SELECT NULL');
  });
});
