/**
 * The fuzzy-search term escape must depend on the dialect, for the same reason
 * `escapeSqlLiteral` does — and it is a sharper problem here, because the search
 * term is supplied directly by the caller rather than read back out of a warehouse.
 *
 * `fuzzyMatch` builds its SQL by hand and splices the term into single-quoted
 * literals (`LIKE '%<term>%'`, `CONTAINS_SUBSTR(col, '<term>')`). `escapeFuzzyTerm`
 * doubled single quotes only. That is correct on DuckDB / Postgres / Athena, where
 * a backslash is an ordinary character, and WRONG on the engines that process
 * backslash escapes: there `\'` consumes the quote meant to close the literal and
 * the remainder of the term is parsed as SQL.
 *
 * Two call paths reach such an engine. `fuzzyBigQuery` is dispatched explicitly for
 * `bigquery`, and the `default:` branch of `fuzzyMatch` sends every UNRECOGNISED
 * connector to `fuzzySubstring` — which is where ClickHouse, a shipped connector with
 * no `case` of its own, lands. So the unsafe camp is reached both by name and by
 * falling through. (`mysql` is in the same camp in sql-literal.ts, but no MySQL
 * connector exists yet; it is covered here so one cannot arrive unprotected.)
 *
 * Sibling of `fuzzy-escape-truncation.test.ts`: that one pins truncate-before-escape,
 * this one pins dialect-correct escaping. Both are about the same literal staying closed.
 */
import { describe, it, expect } from 'vitest';
import { escapeFuzzyTerm, escapeBacktickIdent, FUZZY_TERM_MAX } from '@/lib/connections/fuzzy-search';

/**
 * Walk the literal body the way the engine would: where backslashes escape, a
 * backslash consumes the next character; a doubled quote is one literal quote.
 * Returns true when a bare quote closes the string early.
 */
function terminatesEarly(body: string, backslashEscapes: boolean): boolean {
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (backslashEscapes && ch === '\\') { i++; continue; }
    if (ch === "'") {
      if (body[i + 1] === "'") { i++; continue; }
      return true;
    }
  }
  return false;
}

const BACKSLASH_DIALECTS = ['clickhouse', 'bigquery', 'mysql'];
const LITERAL_BACKSLASH_DIALECTS = ['duckdb', 'postgres', 'sqlite', 'athena'];

const HOSTILE = [
  String.raw`\'`,                        // the breakout: escapes the quote the escaper added
  String.raw`\' OR 1=1 --`,
  String.raw`\' UNION SELECT password FROM users --`,
  "'",
  String.raw`a\b`,                       // an ordinary backslash, no attack
  String.raw`\\`,
  'plain term',
];

describe('escapeFuzzyTerm — dialect-correct escaping', () => {
  for (const dialect of [...BACKSLASH_DIALECTS, ...LITERAL_BACKSLASH_DIALECTS]) {
    for (const value of HOSTILE) {
      it(`${dialect}: ${JSON.stringify(value)} cannot close the literal it sits in`, () => {
        const term = escapeFuzzyTerm(value, dialect);
        // How the term is actually used: spliced between quotes, often inside %…%.
        expect(terminatesEarly(term, BACKSLASH_DIALECTS.includes(dialect))).toBe(false);
        expect(terminatesEarly(`%${term}%`, BACKSLASH_DIALECTS.includes(dialect))).toBe(false);
      });
    }
  }

  it('does not double backslashes where a backslash is an ordinary character', () => {
    // Doing so on DuckDB/Postgres would change the VALUE — a search for a\b would
    // silently stop matching a\b.
    expect(escapeFuzzyTerm(String.raw`a\b`, 'duckdb')).toBe(String.raw`a\b`);
    expect(escapeFuzzyTerm(String.raw`a\b`, 'postgres')).toBe(String.raw`a\b`);
  });

  it('doubles backslashes where the engine processes escapes', () => {
    expect(escapeFuzzyTerm(String.raw`a\b`, 'bigquery')).toBe(String.raw`a\\b`);
    expect(escapeFuzzyTerm(String.raw`a\b`, 'clickhouse')).toBe(String.raw`a\\b`);
  });

  it('treats an unknown dialect as escape-processing', () => {
    // `fuzzyMatch`'s default: branch routes unrecognised connectors to
    // fuzzySubstring, so "unknown" is a REACHABLE state, not a hypothetical.
    // Over-escaping there is a wrong search result; under-escaping is an injection.
    expect(terminatesEarly(escapeFuzzyTerm(String.raw`\'`, 'some-new-engine'), true)).toBe(false);
  });

  it('still doubles quotes, and still truncates on the raw value', () => {
    expect(escapeFuzzyTerm("O'Brien", 'duckdb')).toBe("O''Brien");
    expect(escapeFuzzyTerm('y'.repeat(FUZZY_TERM_MAX + 50), 'duckdb')).toBe('y'.repeat(FUZZY_TERM_MAX));
  });

  it('keeps the cap on the raw value even when backslashes are doubled', () => {
    // Truncate-then-escape must survive the added backslash pass: a backslash at
    // the cap boundary must not be split from the one it introduces.
    for (let n = FUZZY_TERM_MAX - 3; n <= FUZZY_TERM_MAX + 3; n++) {
      const value = 'x'.repeat(n) + '\\' + "'";
      expect(terminatesEarly(escapeFuzzyTerm(value, 'bigquery'), true), `backslash at ${n}`).toBe(false);
    }
  });
});

/**
 * The IDENTIFIER quoting has the same defect the term escaping had.
 *
 * BigQuery (and the generic backtick path) quote table/column/schema names with
 * backticks, escaping an inner backtick as `` \` ``. That spelling only works
 * because the engine processes backslash escapes — and the escaper did not double
 * backslashes, so a name ending in one consumed the closing backtick and the rest
 * of the statement was parsed as SQL.
 *
 * These names are not developer constants: they arrive as `table` / `columns` /
 * `schema` on the agent's FuzzyMatch tool call, so they are model-supplied and
 * reachable by prompt injection.
 */
describe('escapeBacktickIdent', () => {
  /** True when the quoted identifier is closed by something other than its final backtick. */
  function closesEarly(quoted: string): boolean {
    const inner = quoted.slice(1, -1);
    for (let i = 0; i < inner.length; i++) {
      if (inner[i] === '\\') { i++; continue; }   // escapes the next char
      if (inner[i] === '`') return true;          // an unescaped backtick closes it
    }
    return false;
  }

  const HOSTILE_IDENTS = [
    'col\\',                                     // trailing backslash eats the closing backtick
    '`',
    'a\\',
    'a`b',
    'x\\` , (SELECT password FROM users) AS p, ', // the breakout, spelled out
    'normal_col',
  ];

  for (const name of HOSTILE_IDENTS) {
    it(`${JSON.stringify(name)} cannot close its own identifier`, () => {
      const quoted = escapeBacktickIdent(name);
      expect(quoted.startsWith('`')).toBe(true);
      expect(quoted.endsWith('`')).toBe(true);
      expect(closesEarly(quoted)).toBe(false);
    });
  }

  it('leaves an ordinary name untouched apart from its quotes', () => {
    expect(escapeBacktickIdent('user_id')).toBe('`user_id`');
  });

  it('escapes backslashes before backticks, so neither pass doubles the other', () => {
    expect(escapeBacktickIdent('a\\b')).toBe('`a\\\\b`');
  });
});
