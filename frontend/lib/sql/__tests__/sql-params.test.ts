import { extractParametersFromSQL } from '../sql-params';

describe('extractParametersFromSQL', () => {
  // ── Basic extraction ──────────────────────────────────────────
  it('returns [] for empty string', () => {
    expect(extractParametersFromSQL('')).toEqual([]);
  });

  it('returns [] for whitespace-only string', () => {
    expect(extractParametersFromSQL('   \n\t  ')).toEqual([]);
  });

  it('extracts a single param', () => {
    expect(extractParametersFromSQL('SELECT :foo')).toEqual(['foo']);
  });

  it('extracts multiple params', () => {
    expect(extractParametersFromSQL('WHERE a = :x AND b = :y')).toEqual(['x', 'y']);
  });

  it('deduplicates repeated params', () => {
    expect(extractParametersFromSQL(':limit OFFSET :limit')).toEqual(['limit']);
  });

  it('extracts params with numbers in name', () => {
    expect(extractParametersFromSQL('SELECT :param1')).toEqual(['param1']);
  });

  it('extracts params with underscores', () => {
    expect(extractParametersFromSQL('WHERE date >= :start_date')).toEqual(['start_date']);
  });

  // ── Type casts — must NOT extract ────────────────────────────
  it('ignores :: DuckDB/PG type cast', () => {
    expect(extractParametersFromSQL('SELECT col::VARCHAR')).toEqual([]);
  });

  it('ignores :: after a value', () => {
    expect(extractParametersFromSQL("SELECT 'foo'::TEXT")).toEqual([]);
  });

  it(':p directly followed by :: is not extracted (lookahead fires) — add a space: :p ::INT', () => {
    // Regex limitation: (?!:) lookahead prevents matching :p when :: follows immediately.
    // Workaround: write ':p ::INT' (space before the cast).
    expect(extractParametersFromSQL('SELECT :p::INT')).toEqual([]);
    expect(extractParametersFromSQL('SELECT :p ::INT')).toEqual(['p']);
  });

  it('ignores DuckDB timestamp cast', () => {
    expect(extractParametersFromSQL("SELECT '2021-01-01'::TIMESTAMP")).toEqual([]);
  });

  // ── Colons preceded by word chars — skipped via lookbehind ───
  it('ignores colon in time literal', () => {
    // digits are \w, so lookbehind fires on '10:30:00'
    expect(extractParametersFromSQL("WHERE time = '10:30:00'")).toEqual([]);
  });

  it('ignores colon in timestamp literal', () => {
    expect(extractParametersFromSQL("WHERE ts = '2024-01-01 10:30:00'")).toEqual([]);
  });

  it('ignores URL in string', () => {
    // 's' in 'https:' is \w, so lookbehind fires
    expect(extractParametersFromSQL("WHERE url = 'https://example.com'")).toEqual([]);
  });

  it('ignores :param inside double-quoted identifier', () => {
    // 'l' in "col:name" is \w, so lookbehind fires
    expect(extractParametersFromSQL('SELECT "col:name"')).toEqual([]);
  });

  it('extracts param after double-quoted identifier', () => {
    expect(extractParametersFromSQL('SELECT "col" = :p')).toEqual(['p']);
  });

  // ── Escaped colon — must NOT extract ─────────────────────────
  it('ignores \\: escaped colon', () => {
    // backslash is in lookbehind (?<![:\w\\])
    expect(extractParametersFromSQL('WHERE x = \\:not')).toEqual([]);
  });

  // ── Complex real-world queries ────────────────────────────────
  it('handles full query with casts and params', () => {
    const sql = `SELECT id, name::TEXT, created_at::DATE
     FROM users
     WHERE status = 'active'
       AND created_at >= :start_date
       AND region = :region
     LIMIT :limit`;
    expect(extractParametersFromSQL(sql)).toEqual(['start_date', 'region', 'limit']);
  });

  it('handles DuckDB STRPTIME pattern', () => {
    // colons inside '%Y-%m-%d' format string — no colons present, param outside is extracted
    const sql = "SELECT strptime(col, '%Y-%m-%d') FROM t WHERE date >= :start";
    expect(extractParametersFromSQL(sql)).toEqual(['start']);
  });

  it('handles param immediately followed by punctuation', () => {
    expect(extractParametersFromSQL('SELECT :p,')).toEqual(['p']);
    expect(extractParametersFromSQL('fn(:p)')).toEqual(['p']);
    expect(extractParametersFromSQL(':p\n')).toEqual(['p']);
  });
});
