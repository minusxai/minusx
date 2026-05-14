/**
 * Tests for fuzzy-search.ts
 *
 * Tests each connector strategy with mock queryFn:
 * - SQL generation (correct function, quoting, thresholds)
 * - Result parsing
 * - Escaping / injection safety
 * - Multi-strategy results (similarity + substring)
 * - Fallback behavior (PostgreSQL pg_trgm → substring-only)
 * - Default parameters
 */

import { fuzzyMatch } from '../fuzzy-search';
import type { QueryResult } from '../base';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function qr(rows: Record<string, unknown>[]): QueryResult {
  return { columns: ['value', 'similarity'], types: ['text', 'float'], rows, finalQuery: '<test>' };
}

function getCapturedSql(queryFn: any, callIndex = 0): string {
  return queryFn.mock.calls[callIndex]?.[0] ?? '';
}

const DEFAULT_PARAMS = { table: 'tracks', column: 'title', searchTerm: 'Strawberry Jam' };

// ─── DuckDB ─────────────────────────────────────────────────────────────────

describe('fuzzyMatch — DuckDB', () => {
  it('returns both jaro_winkler and substring results', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    const result = await fuzzyMatch('duckdb', queryFn, DEFAULT_PARAMS);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].method).toBe('jaro_winkler');
    expect(result.results[1].method).toBe('substring');
  });

  it('uses jaro_winkler_similarity in first strategy', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    await fuzzyMatch('duckdb', queryFn, DEFAULT_PARAMS);
    const sql = getCapturedSql(queryFn, 0);
    expect(sql).toContain('jaro_winkler_similarity');
  });

  it('uses LIKE in second strategy', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    await fuzzyMatch('duckdb', queryFn, DEFAULT_PARAMS);
    const sql = getCapturedSql(queryFn, 1);
    expect(sql).toContain('LIKE');
  });

  it('applies > 0.8 threshold for jaro_winkler', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    await fuzzyMatch('duckdb', queryFn, DEFAULT_PARAMS);
    expect(getCapturedSql(queryFn, 0)).toContain('> 0.8');
  });

  it('double-quotes identifiers', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    await fuzzyMatch('duckdb', queryFn, { ...DEFAULT_PARAMS, schema: 'my_schema' });
    const sql = getCapturedSql(queryFn, 0);
    expect(sql).toContain('"my_schema"."tracks"');
    expect(sql).toContain('"title"');
  });

  it('casts column to VARCHAR', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    await fuzzyMatch('duckdb', queryFn, DEFAULT_PARAMS);
    expect(getCapturedSql(queryFn, 0)).toContain('CAST');
  });

  it('parses result rows into matches', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>()
      .mockResolvedValueOnce(qr([
        { value: 'Strawbery Jam', similarity: 0.92 },
        { value: 'Strawberry Jam (Remix)', similarity: 0.78 },
      ]))
      .mockResolvedValueOnce(qr([]));
    const result = await fuzzyMatch('duckdb', queryFn, DEFAULT_PARAMS);
    expect(result.results[0].matches).toHaveLength(2);
    expect(result.results[0].matches[0]).toEqual({ value: 'Strawbery Jam', similarity: 0.92 });
    expect(result.results[0].matches[1]).toEqual({ value: 'Strawberry Jam (Remix)', similarity: 0.78 });
    expect(result.searchTerm).toBe('Strawberry Jam');
  });

  it('handles empty result set', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    const result = await fuzzyMatch('duckdb', queryFn, DEFAULT_PARAMS);
    expect(result.results[0].matches).toEqual([]);
    expect(result.results[1].matches).toEqual([]);
  });

  it('orders by similarity DESC and applies LIMIT', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    await fuzzyMatch('duckdb', queryFn, { ...DEFAULT_PARAMS, limit: 5 });
    const sql = getCapturedSql(queryFn, 0);
    expect(sql).toMatch(/ORDER BY similarity DESC/);
    expect(sql).toMatch(/LIMIT 5/);
  });

  it('substring catches short terms in long text that jaro_winkler misses', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>()
      // jaro_winkler returns nothing (short term vs long value)
      .mockResolvedValueOnce(qr([]))
      // substring finds it
      .mockResolvedValueOnce(qr([
        { value: 'Shell is a command-line scripting language', similarity: 1.0 },
      ]));
    const result = await fuzzyMatch('duckdb', queryFn, { table: 'languages', column: 'language_description', searchTerm: 'Shell' });
    expect(result.results[0].method).toBe('jaro_winkler');
    expect(result.results[0].matches).toHaveLength(0);
    expect(result.results[1].method).toBe('substring');
    expect(result.results[1].matches).toHaveLength(1);
    expect(result.results[1].matches[0].value).toBe('Shell is a command-line scripting language');
  });

  it('includes returnColumns in SELECT and match results', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>()
      .mockResolvedValueOnce(qr([
        { value: 'Strawbery Jam', similarity: 0.92, artist: 'Animal Collective', id: 42 },
      ]))
      .mockResolvedValueOnce(qr([]));
    const result = await fuzzyMatch('duckdb', queryFn, {
      ...DEFAULT_PARAMS,
      returnColumns: ['artist', 'id'],
    });
    // jaro_winkler SQL should include extra columns and drop DISTINCT
    const sql = getCapturedSql(queryFn, 0);
    expect(sql).toContain('"artist"');
    expect(sql).toContain('"id"');
    expect(sql).not.toMatch(/SELECT\s+DISTINCT/i);
    // Match result should include the extra columns
    expect(result.results[0].matches[0]).toEqual({
      value: 'Strawbery Jam',
      similarity: 0.92,
      artist: 'Animal Collective',
      id: 42,
    });
  });

  it('uses DISTINCT when returnColumns is empty', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    await fuzzyMatch('duckdb', queryFn, DEFAULT_PARAMS);
    const sql = getCapturedSql(queryFn, 0);
    expect(sql).toMatch(/SELECT\s+DISTINCT/i);
  });
});

// ─── SQLite (routes through DuckDB) ─────────────────────────────────────────

describe('fuzzyMatch — SQLite', () => {
  it('uses same dual strategy as DuckDB', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    const result = await fuzzyMatch('sqlite', queryFn, DEFAULT_PARAMS);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].method).toBe('jaro_winkler');
    expect(result.results[1].method).toBe('substring');
  });
});

// ─── CSV ─────────────────────────────────────────────────────────────────────

describe('fuzzyMatch — CSV', () => {
  it('uses same dual strategy as DuckDB', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    const result = await fuzzyMatch('csv', queryFn, DEFAULT_PARAMS);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].method).toBe('jaro_winkler');
    expect(result.results[1].method).toBe('substring');
  });
});

// ─── Google Sheets ───────────────────────────────────────────────────────────

describe('fuzzyMatch — Google Sheets', () => {
  it('uses same dual strategy as DuckDB', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    const result = await fuzzyMatch('google-sheets', queryFn, DEFAULT_PARAMS);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].method).toBe('jaro_winkler');
    expect(result.results[1].method).toBe('substring');
  });
});

// ─── PostgreSQL ──────────────────────────────────────────────────────────────

describe('fuzzyMatch — PostgreSQL', () => {
  it('returns both trigram and substring when pg_trgm is available', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([
      { value: 'Strawbery Jam', similarity: 0.55 },
    ]));
    const result = await fuzzyMatch('postgresql', queryFn, DEFAULT_PARAMS);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].method).toBe('trigram');
    expect(result.results[0].matches).toHaveLength(1);
    expect(result.results[1].method).toBe('substring');
  });

  it('uses similarity() with > 0.3 threshold for trigram', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    const result = await fuzzyMatch('postgresql', queryFn, DEFAULT_PARAMS);
    const trigramQuery = result.results[0].query;
    expect(trigramQuery).toContain('similarity(');
    expect(trigramQuery).toContain('> 0.3');
  });

  it('casts column to TEXT', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    const result = await fuzzyMatch('postgresql', queryFn, DEFAULT_PARAMS);
    expect(result.results[0].query).toContain('CAST');
  });

  it('returns only substring when pg_trgm is not installed', async () => {
    // Substring runs in parallel (call 1), trigram fails (call 0)
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>()
      .mockImplementation((sql: string) => {
        if (sql.includes('similarity(')) {
          return Promise.reject(new Error('function similarity(text, text) does not exist'));
        }
        return Promise.resolve(qr([{ value: 'Strawbery Jam', similarity: 1.0 }]));
      });

    const result = await fuzzyMatch('postgresql', queryFn, DEFAULT_PARAMS);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].method).toBe('substring');
    expect(result.results[0].query).toContain('LIKE');
    expect(result.results[0].query).not.toContain('similarity(');
  });

  it('omits schema prefix when schema not provided', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    await fuzzyMatch('postgresql', queryFn, { table: 'users', column: 'name', searchTerm: 'alice' });
    const sql = getCapturedSql(queryFn);
    expect(sql).not.toContain('"main".');
    expect(sql).toContain('"users"');
  });

  it('includes returnColumns in trigram and substring queries', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([
      { value: 'alice', similarity: 0.6, email: 'alice@test.com' },
    ]));
    const result = await fuzzyMatch('postgresql', queryFn, {
      table: 'users', column: 'name', searchTerm: 'alice', returnColumns: ['email'],
    });
    // Trigram query should include extra column
    const trigramSql = result.results[0].query;
    expect(trigramSql).toContain('"email"');
    expect(trigramSql).not.toMatch(/SELECT\s+DISTINCT/i);
    // Match should include the extra column
    expect(result.results[0].matches[0].email).toBe('alice@test.com');
  });
});

// ─── BigQuery ────────────────────────────────────────────────────────────────

describe('fuzzyMatch — BigQuery', () => {
  it('uses CONTAINS_SUBSTR and LIKE (no native fuzzy)', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    const result = await fuzzyMatch('bigquery', queryFn, DEFAULT_PARAMS);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].method).toBe('substring');
    const sql = result.results[0].query;
    expect(sql).toContain('CONTAINS_SUBSTR');
    expect(sql).toContain('LIKE');
  });

  it('uses backtick quoting for identifiers', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    await fuzzyMatch('bigquery', queryFn, { ...DEFAULT_PARAMS, schema: 'dataset1' });
    const result = await fuzzyMatch('bigquery', queryFn, { ...DEFAULT_PARAMS, schema: 'dataset1' });
    const sql = result.results[0].query;
    expect(sql).toContain('`dataset1`');
    expect(sql).toContain('`tracks`');
    expect(sql).toContain('`title`');
  });

  it('returns similarity 1.0 for all matches (no scoring)', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([
      { value: 'Strawberry Jam', similarity: 1.0 },
    ]));
    const result = await fuzzyMatch('bigquery', queryFn, DEFAULT_PARAMS);
    expect(result.results[0].matches[0]?.similarity).toBe(1.0);
  });
});

// ─── Athena ──────────────────────────────────────────────────────────────────

describe('fuzzyMatch — Athena', () => {
  it('returns both levenshtein and substring results', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    const result = await fuzzyMatch('athena', queryFn, DEFAULT_PARAMS);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].method).toBe('levenshtein');
    expect(result.results[1].method).toBe('substring');
  });

  it('uses levenshtein_distance in first strategy', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    await fuzzyMatch('athena', queryFn, DEFAULT_PARAMS);
    const sql = getCapturedSql(queryFn, 0);
    expect(sql).toContain('levenshtein_distance');
  });

  it('normalizes distance to 0-1 similarity', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    await fuzzyMatch('athena', queryFn, DEFAULT_PARAMS);
    const sql = getCapturedSql(queryFn, 0);
    expect(sql).toContain('1.0 -');
    expect(sql).toContain('GREATEST');
  });

  it('sets max distance threshold based on search term length', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    // "Strawberry Jam" is 14 chars → max distance = max(floor(14/3), 3) = 4
    await fuzzyMatch('athena', queryFn, DEFAULT_PARAMS);
    const sql = getCapturedSql(queryFn, 0);
    expect(sql).toContain('<= 4');
  });

  it('uses minimum distance of 3 for short search terms', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    // "ab" is 2 chars → max(floor(2/3), 3) = max(0, 3) = 3
    await fuzzyMatch('athena', queryFn, { table: 't', column: 'c', searchTerm: 'ab' });
    expect(getCapturedSql(queryFn, 0)).toContain('<= 3');
  });
});

// ─── MongoDB (native aggregation) ────────────────────────────────────────────

describe('fuzzyMatch — MongoDB (native aggregation)', () => {
  // Mongo fuzzy match runs a native aggregation pipeline, not SQL. The
  // `queryFn` receives a JSON `{collection,pipeline}` string (the same
  // string MongoConnector.query() expects).

  it('builds a native {collection,pipeline} JSON query, not SQL', async () => {
    const queryFn = vi.fn<(q: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    await fuzzyMatch('mongo', queryFn, DEFAULT_PARAMS);
    const sent = JSON.parse(getCapturedSql(queryFn));
    expect(sent.collection).toBe('tracks');
    expect(Array.isArray(sent.pipeline)).toBe(true);
  });

  it('uses a case-insensitive $regex $match on the target column', async () => {
    const queryFn = vi.fn<(q: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    await fuzzyMatch('mongo', queryFn, DEFAULT_PARAMS);
    const { pipeline } = JSON.parse(getCapturedSql(queryFn));
    expect(pipeline[0]).toEqual({
      $match: { title: { $regex: 'Strawberry Jam', $options: 'i' } },
    });
  });

  it('regex-escapes special characters in the search term', async () => {
    const queryFn = vi.fn<(q: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    await fuzzyMatch('mongo', queryFn, { table: 't', column: 'c', searchTerm: 'a.b*c(d)' });
    const { pipeline } = JSON.parse(getCapturedSql(queryFn));
    expect(pipeline[0].$match.c.$regex).toBe('a\\.b\\*c\\(d\\)');
  });

  it('groups for distinct values, limits, and projects to {value, similarity}', async () => {
    const queryFn = vi.fn<(q: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    await fuzzyMatch('mongo', queryFn, { ...DEFAULT_PARAMS, limit: 25 });
    const { pipeline } = JSON.parse(getCapturedSql(queryFn));
    expect(pipeline).toContainEqual({ $group: { _id: '$title' } });
    expect(pipeline).toContainEqual({ $limit: 25 });
    expect(pipeline[pipeline.length - 1]).toEqual({
      $project: { _id: 0, value: '$_id', similarity: { $literal: 1 } },
    });
  });

  it('maps result rows to matches (method: substring, binary $regex match)', async () => {
    const queryFn = vi.fn<(q: string) => Promise<QueryResult>>().mockResolvedValue(qr([
      { value: 'Strawberry Jam', similarity: 1 },
      { value: 'Strawberry Jam Deluxe', similarity: 1 },
    ]));
    const result = await fuzzyMatch('mongo', queryFn, DEFAULT_PARAMS);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].method).toBe('substring');
    expect(result.results[0].matches).toEqual([
      { value: 'Strawberry Jam', similarity: 1 },
      { value: 'Strawberry Jam Deluxe', similarity: 1 },
    ]);
    expect(result.searchTerm).toBe('Strawberry Jam');
  });
});

// ─── Unknown connector (SQL substring fallback) ──────────────────────────────

describe('fuzzyMatch — unknown connector', () => {
  it('uses substring matching for unknown connector types', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    const result = await fuzzyMatch('some_future_db', queryFn, DEFAULT_PARAMS);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].method).toBe('substring');
    expect(result.results[0].query).toContain('LIKE');
  });

  it('splits search term into words for flexible matching', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    await fuzzyMatch('some_future_db', queryFn, DEFAULT_PARAMS);
    const sql = getCapturedSql(queryFn);
    // "Strawberry Jam" → should produce '%strawberry%jam%' pattern
    expect(sql).toContain('%strawberry%jam%');
  });

  it('adds per-word LIKE conditions for multi-word search', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    await fuzzyMatch('mongo', queryFn, { table: 't', column: 'c', searchTerm: 'green energy' });
    const sql = getCapturedSql(queryFn);
    // Should match individual words, not just the full phrase
    expect(sql).toContain("'%green%'");
    expect(sql).toContain("'%energy%'");
  });

  it('does not add per-word conditions for single-word search', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    await fuzzyMatch('mongo', queryFn, { table: 't', column: 'c', searchTerm: 'green' });
    const sql = getCapturedSql(queryFn);
    expect(sql).toContain("'%green%'");
    // Should only have one LIKE — no per-word split needed
    const likeCount = (sql.match(/LIKE/g) || []).length;
    expect(likeCount).toBe(1);
  });

  it('does not add word-split pattern for single-word search', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    await fuzzyMatch('some_future_db', queryFn, { table: 't', column: 'c', searchTerm: 'hello' });
    const sql = getCapturedSql(queryFn);
    expect(sql).toContain("'%hello%'");
    const likeCount = (sql.match(/LIKE/g) || []).length;
    expect(likeCount).toBe(1);
  });
});

// ─── Dual-Strategy Positive/Negative Scenarios ──────────────────────────────

describe('fuzzyMatch — DuckDB dual-strategy scenarios', () => {
  // Helper: mock queryFn that routes by SQL content
  function routedMock(jaroRows: Record<string, unknown>[], substrRows: Record<string, unknown>[]) {
    return vi.fn<(sql: string) => Promise<QueryResult>>().mockImplementation((sql: string) => {
      if (sql.includes('jaro_winkler_similarity')) return Promise.resolve(qr(jaroRows));
      if (sql.includes('LIKE')) return Promise.resolve(qr(substrRows));
      return Promise.resolve(qr([]));
    });
  }

  it('both strategies find matches — similarity match ranked first', async () => {
    // "Strawbery Jam" is a typo match (jaro_winkler) AND a substring match
    const queryFn = routedMock(
      [{ value: 'Strawberry Jam', similarity: 0.95 }],
      [{ value: 'Strawberry Jam', similarity: 1.0 }, { value: 'Strawberry Jam Deluxe', similarity: 1.0 }],
    );
    const result = await fuzzyMatch('duckdb', queryFn, { table: 't', column: 'c', searchTerm: 'Strawbery Jam' });
    expect(result.results[0].method).toBe('jaro_winkler');
    expect(result.results[0].matches).toHaveLength(1);
    expect(result.results[0].matches[0].similarity).toBe(0.95);
    expect(result.results[1].method).toBe('substring');
    expect(result.results[1].matches).toHaveLength(2);
  });

  it('similarity finds typo match, substring misses (different enough spelling)', async () => {
    // jaro_winkler catches "Jonh" → "John" but LIKE '%jonh%' won't match "John"
    const queryFn = routedMock(
      [{ value: 'John Smith', similarity: 0.92 }],
      [], // no substring match for "Jonh"
    );
    const result = await fuzzyMatch('duckdb', queryFn, { table: 't', column: 'c', searchTerm: 'Jonh' });
    expect(result.results[0].matches).toHaveLength(1);
    expect(result.results[0].matches[0].value).toBe('John Smith');
    expect(result.results[1].matches).toHaveLength(0);
  });

  it('substring finds containment match, similarity misses (short term in long text)', async () => {
    // "SQL" in "SQL is a structured query language" — jaro_winkler fails on length mismatch
    const queryFn = routedMock(
      [], // jaro_winkler misses
      [{ value: 'SQL is a structured query language', similarity: 1.0 }],
    );
    const result = await fuzzyMatch('duckdb', queryFn, { table: 't', column: 'c', searchTerm: 'SQL' });
    expect(result.results[0].matches).toHaveLength(0);
    expect(result.results[1].matches).toHaveLength(1);
    expect(result.results[1].matches[0].value).toBe('SQL is a structured query language');
  });

  it('neither strategy finds matches — both return empty', async () => {
    const queryFn = routedMock([], []);
    const result = await fuzzyMatch('duckdb', queryFn, { table: 't', column: 'c', searchTerm: 'xyznonexistent' });
    expect(result.results[0].matches).toHaveLength(0);
    expect(result.results[1].matches).toHaveLength(0);
  });

  it('sets allEmpty=true when all results are empty', async () => {
    const queryFn = routedMock([], []);
    const result = await fuzzyMatch('duckdb', queryFn, { table: 't', column: 'c', searchTerm: 'xyznonexistent' });
    expect(result.allEmpty).toBe(true);
  });

  it('sets allEmpty=false when matches exist', async () => {
    const queryFn = routedMock(
      [{ value: 'Revenue', similarity: 0.96 }],
      [],
    );
    const result = await fuzzyMatch('duckdb', queryFn, { table: 't', column: 'c', searchTerm: 'Revenue' });
    expect(result.allEmpty).toBe(false);
  });

  it('similarity returns multiple ranked matches', async () => {
    const queryFn = routedMock(
      [
        { value: 'Revenue', similarity: 0.96 },
        { value: 'Revnue', similarity: 0.91 },
        { value: 'Revenues', similarity: 0.88 },
      ],
      [{ value: 'Revenue', similarity: 1.0 }, { value: 'Revenues', similarity: 1.0 }],
    );
    const result = await fuzzyMatch('duckdb', queryFn, { table: 't', column: 'c', searchTerm: 'Revenue' });
    // Similarity results should preserve order (DESC by similarity)
    expect(result.results[0].matches).toHaveLength(3);
    expect(result.results[0].matches[0].similarity).toBeGreaterThanOrEqual(result.results[0].matches[1].similarity);
    expect(result.results[0].matches[1].similarity).toBeGreaterThanOrEqual(result.results[0].matches[2].similarity);
    // Substring also finds exact and prefix matches
    expect(result.results[1].matches).toHaveLength(2);
  });

  it('case-insensitive: search term casing does not affect SQL generation', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    await fuzzyMatch('duckdb', queryFn, { table: 't', column: 'c', searchTerm: 'HELLO World' });
    const jaroSql = getCapturedSql(queryFn, 0);
    const substrSql = getCapturedSql(queryFn, 1);
    // jaro_winkler uses lower()
    expect(jaroSql).toContain("lower('HELLO World')");
    // substring uses LOWER() on column and lowercased term
    expect(substrSql).toContain("'%hello world%'");
  });

  it('multi-word search term generates word-split LIKE pattern in substring', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    await fuzzyMatch('duckdb', queryFn, { table: 't', column: 'c', searchTerm: 'New York City' });
    const substrSql = getCapturedSql(queryFn, 1);
    // Should have both exact phrase and word-split patterns
    expect(substrSql).toContain("'%new york city%'");
    expect(substrSql).toContain("'%new%york%city%'");
    expect(substrSql).toContain(' OR ');
  });

  it('single-word search term does not generate word-split pattern in substring', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    await fuzzyMatch('duckdb', queryFn, { table: 't', column: 'c', searchTerm: 'Python' });
    const substrSql = getCapturedSql(queryFn, 1);
    expect(substrSql).toContain("'%python%'");
    expect(substrSql).not.toContain(' OR ');
  });

  it('substring ranks by term/value length ratio and orders DESC', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    await fuzzyMatch('duckdb', queryFn, { table: 't', column: 'c', searchTerm: 'Shell' });
    const substrSql = getCapturedSql(queryFn, 1);
    // "Shell" is 5 chars → similarity = 5.0 / (CASE WHENcol), 1)
    expect(substrSql).toContain('5.0 / (CASE WHEN');
    expect(substrSql).toContain('ORDER BY similarity DESC');
  });
});

describe('fuzzyMatch — PostgreSQL dual-strategy scenarios', () => {
  function routedMock(trigramRows: Record<string, unknown>[], substrRows: Record<string, unknown>[]) {
    return vi.fn<(sql: string) => Promise<QueryResult>>().mockImplementation((sql: string) => {
      if (sql.includes('similarity(')) return Promise.resolve(qr(trigramRows));
      if (sql.includes('LIKE')) return Promise.resolve(qr(substrRows));
      return Promise.resolve(qr([]));
    });
  }

  it('trigram finds close match, substring finds containment — both returned', async () => {
    const queryFn = routedMock(
      [{ value: 'Strawbery Jam', similarity: 0.55 }],
      [{ value: 'Strawberry Jam (Deluxe Edition)', similarity: 1.0 }],
    );
    const result = await fuzzyMatch('postgresql', queryFn, DEFAULT_PARAMS);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].method).toBe('trigram');
    expect(result.results[0].matches[0].value).toBe('Strawbery Jam');
    expect(result.results[1].method).toBe('substring');
    expect(result.results[1].matches[0].value).toBe('Strawberry Jam (Deluxe Edition)');
  });

  it('trigram fails gracefully — only substring returned, no error', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockImplementation((sql: string) => {
      if (sql.includes('similarity(')) return Promise.reject(new Error('pg_trgm not installed'));
      return Promise.resolve(qr([{ value: 'Strawberry Jam', similarity: 1.0 }]));
    });
    const result = await fuzzyMatch('postgresql', queryFn, DEFAULT_PARAMS);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].method).toBe('substring');
    expect(result.results[0].matches).toHaveLength(1);
  });

  it('both trigram and substring return empty — no error, just empty results', async () => {
    const queryFn = routedMock([], []);
    const result = await fuzzyMatch('postgresql', queryFn, { table: 't', column: 'c', searchTerm: 'zzzznotfound' });
    expect(result.results).toHaveLength(2);
    expect(result.results[0].matches).toHaveLength(0);
    expect(result.results[1].matches).toHaveLength(0);
  });

  it('trigram uses lower threshold (0.3) than jaro_winkler (0.8)', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    const result = await fuzzyMatch('postgresql', queryFn, DEFAULT_PARAMS);
    expect(result.results[0].query).toContain('> 0.3');
    expect(result.results[0].query).not.toContain('> 0.8');
  });
});

describe('fuzzyMatch — Athena dual-strategy scenarios', () => {
  function routedMock(levenRows: Record<string, unknown>[], substrRows: Record<string, unknown>[]) {
    return vi.fn<(sql: string) => Promise<QueryResult>>().mockImplementation((sql: string) => {
      if (sql.includes('levenshtein_distance')) return Promise.resolve(qr(levenRows));
      if (sql.includes('LIKE')) return Promise.resolve(qr(substrRows));
      return Promise.resolve(qr([]));
    });
  }

  it('levenshtein finds close match, substring finds containment', async () => {
    const queryFn = routedMock(
      [{ value: 'Strawbery Jam', similarity: 0.85 }],
      [{ value: 'Strawberry Jam Remix', similarity: 1.0 }],
    );
    const result = await fuzzyMatch('athena', queryFn, DEFAULT_PARAMS);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].method).toBe('levenshtein');
    expect(result.results[0].matches[0].value).toBe('Strawbery Jam');
    expect(result.results[1].method).toBe('substring');
    expect(result.results[1].matches[0].value).toBe('Strawberry Jam Remix');
  });

  it('levenshtein misses long text (distance too high), substring catches it', async () => {
    // Short search term "API" in "API Gateway for microservices" — distance is huge
    const queryFn = routedMock(
      [],
      [{ value: 'API Gateway for microservices', similarity: 1.0 }],
    );
    const result = await fuzzyMatch('athena', queryFn, { table: 't', column: 'c', searchTerm: 'API' });
    expect(result.results[0].matches).toHaveLength(0);
    expect(result.results[1].matches).toHaveLength(1);
  });

  it('both strategies return empty — no error', async () => {
    const queryFn = routedMock([], []);
    const result = await fuzzyMatch('athena', queryFn, { table: 't', column: 'c', searchTerm: 'nonexistent' });
    expect(result.results).toHaveLength(2);
    expect(result.results[0].matches).toHaveLength(0);
    expect(result.results[1].matches).toHaveLength(0);
  });

  it('max distance scales with search term length', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    // "a]" → 1 char → max(floor(1/3), 3) = 3
    await fuzzyMatch('athena', queryFn, { table: 't', column: 'c', searchTerm: 'a' });
    expect(getCapturedSql(queryFn, 0)).toContain('<= 3');

    queryFn.mockClear();
    // "abcdefghijklmnopqrstuvwx" → 24 chars → max(floor(24/3), 3) = 8
    await fuzzyMatch('athena', queryFn, { table: 't', column: 'c', searchTerm: 'abcdefghijklmnopqrstuvwx' });
    expect(getCapturedSql(queryFn, 0)).toContain('<= 8');
  });
});

describe('fuzzyMatch — substring-only connectors (BigQuery, default)', () => {
  it('BigQuery: positive match via CONTAINS_SUBSTR', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([
      { value: 'United States of America', similarity: 1.0 },
    ]));
    const result = await fuzzyMatch('bigquery', queryFn, { table: 't', column: 'c', searchTerm: 'States' });
    expect(result.results).toHaveLength(1);
    expect(result.results[0].matches).toHaveLength(1);
    expect(result.results[0].matches[0].value).toBe('United States of America');
  });

  it('BigQuery: negative match — no results', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    const result = await fuzzyMatch('bigquery', queryFn, { table: 't', column: 'c', searchTerm: 'xyznotfound' });
    expect(result.results).toHaveLength(1);
    expect(result.results[0].matches).toHaveLength(0);
  });

  it('default connector: positive match via LIKE', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([
      { value: 'hello world', similarity: 1.0 },
    ]));
    const result = await fuzzyMatch('some_db', queryFn, { table: 't', column: 'c', searchTerm: 'hello' });
    expect(result.results).toHaveLength(1);
    expect(result.results[0].matches).toHaveLength(1);
  });

  it('default connector: negative match — empty results', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    const result = await fuzzyMatch('some_db', queryFn, { table: 't', column: 'c', searchTerm: 'notfound' });
    expect(result.results).toHaveLength(1);
    expect(result.results[0].matches).toHaveLength(0);
  });

  it('default connector: substring SQL scores by term/value length ratio', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    // "hello" is 5 chars
    const result = await fuzzyMatch('some_db', queryFn, { table: 't', column: 'c', searchTerm: 'hello' });
    const sql = result.results[0].query;
    expect(sql).toContain('5.0 / (CASE WHEN');
    expect(sql).toContain('ORDER BY similarity DESC');
    // Should NOT have the old hardcoded 1.0
    expect(sql).not.toContain('1.0 AS similarity');
  });
});

// ─── Defaults ────────────────────────────────────────────────────────────────

describe('fuzzyMatch — defaults', () => {
  it('omits schema prefix when schema not provided', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    await fuzzyMatch('duckdb', queryFn, { table: 'tracks', column: 'title', searchTerm: 'test' });
    const sql = getCapturedSql(queryFn);
    expect(sql).not.toContain('"main".');
    expect(sql).toContain('"tracks"');
  });

  it('defaults limit to 100', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    await fuzzyMatch('duckdb', queryFn, { table: 't', column: 'c', searchTerm: 'x' });
    expect(getCapturedSql(queryFn)).toMatch(/LIMIT 100/);
  });

  it('respects explicit limit', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    await fuzzyMatch('duckdb', queryFn, { table: 't', column: 'c', searchTerm: 'x', limit: 25 });
    expect(getCapturedSql(queryFn)).toMatch(/LIMIT 25/);
  });
});

// ─── SQL Escaping ────────────────────────────────────────────────────────────

describe('fuzzyMatch — escaping', () => {
  it('escapes double quotes in identifiers', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    await fuzzyMatch('duckdb', queryFn, {
      table: 'my"table', column: 'my"col', searchTerm: 'test', schema: 'my"schema',
    });
    const sql = getCapturedSql(queryFn);
    expect(sql).toContain('"my""table"');
    expect(sql).toContain('"my""col"');
    expect(sql).toContain('"my""schema"');
  });

  it('escapes single quotes in search term', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    await fuzzyMatch('duckdb', queryFn, {
      table: 't', column: 'c', searchTerm: "it's a test",
    });
    const sql = getCapturedSql(queryFn);
    expect(sql).toContain("it''s a test");
  });

  it('truncates search term to 200 chars', async () => {
    const longTerm = 'a'.repeat(300);
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    await fuzzyMatch('duckdb', queryFn, { table: 't', column: 'c', searchTerm: longTerm });
    const sql = getCapturedSql(queryFn);
    // Should contain exactly 200 'a's, not 300
    expect(sql).not.toContain('a'.repeat(201));
    expect(sql).toContain('a'.repeat(200));
  });
});

// ─── Error Propagation ───────────────────────────────────────────────────────

describe('fuzzyMatch — errors', () => {
  it('propagates query execution errors (non-PostgreSQL)', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>()
      .mockRejectedValue(new Error('connection refused'));
    await expect(fuzzyMatch('duckdb', queryFn, DEFAULT_PARAMS)).rejects.toThrow('connection refused');
  });

  it('PostgreSQL propagates error when substring also fails', async () => {
    // Both trigram and substring fail — the substring error propagates
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>()
      .mockRejectedValue(new Error('relation does not exist'));
    await expect(fuzzyMatch('postgresql', queryFn, DEFAULT_PARAMS)).rejects.toThrow('relation does not exist');
  });
});
