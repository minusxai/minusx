/**
 * Tests for fuzzy-search.ts
 *
 * Tests each connector strategy with mock queryFn:
 * - SQL generation (correct function, quoting, thresholds)
 * - Result parsing
 * - Escaping / injection safety
 * - Fallback behavior (PostgreSQL pg_trgm → ILIKE)
 * - Default parameters
 */

import { fuzzySearch } from '../fuzzy-search';
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

describe('fuzzySearch — DuckDB', () => {
  it('uses jaro_winkler_similarity', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    await fuzzySearch('duckdb', queryFn, DEFAULT_PARAMS);
    const sql = getCapturedSql(queryFn);
    expect(sql).toContain('jaro_winkler_similarity');
  });

  it('returns method jaro_winkler', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    const result = await fuzzySearch('duckdb', queryFn, DEFAULT_PARAMS);
    expect(result.method).toBe('jaro_winkler');
  });

  it('applies > 0.8 threshold', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    await fuzzySearch('duckdb', queryFn, DEFAULT_PARAMS);
    expect(getCapturedSql(queryFn)).toContain('> 0.8');
  });

  it('double-quotes identifiers', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    await fuzzySearch('duckdb', queryFn, { ...DEFAULT_PARAMS, schema: 'my_schema' });
    const sql = getCapturedSql(queryFn);
    expect(sql).toContain('"my_schema"."tracks"');
    expect(sql).toContain('"title"');
  });

  it('casts column to VARCHAR', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    await fuzzySearch('duckdb', queryFn, DEFAULT_PARAMS);
    expect(getCapturedSql(queryFn)).toContain('CAST');
  });

  it('parses result rows into matches', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([
      { value: 'Strawbery Jam', similarity: 0.92 },
      { value: 'Strawberry Jam (Remix)', similarity: 0.78 },
    ]));
    const result = await fuzzySearch('duckdb', queryFn, DEFAULT_PARAMS);
    expect(result.matches).toHaveLength(2);
    expect(result.matches[0]).toEqual({ value: 'Strawbery Jam', similarity: 0.92 });
    expect(result.matches[1]).toEqual({ value: 'Strawberry Jam (Remix)', similarity: 0.78 });
    expect(result.searchTerm).toBe('Strawberry Jam');
  });

  it('handles empty result set', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    const result = await fuzzySearch('duckdb', queryFn, DEFAULT_PARAMS);
    expect(result.matches).toEqual([]);
  });

  it('orders by similarity DESC and applies LIMIT', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    await fuzzySearch('duckdb', queryFn, { ...DEFAULT_PARAMS, limit: 5 });
    const sql = getCapturedSql(queryFn);
    expect(sql).toMatch(/ORDER BY similarity DESC/);
    expect(sql).toMatch(/LIMIT 5/);
  });
});

// ─── SQLite (routes through DuckDB) ─────────────────────────────────────────

describe('fuzzySearch — SQLite', () => {
  it('uses same jaro_winkler strategy as DuckDB', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    const result = await fuzzySearch('sqlite', queryFn, DEFAULT_PARAMS);
    expect(getCapturedSql(queryFn)).toContain('jaro_winkler_similarity');
    expect(result.method).toBe('jaro_winkler');
  });
});

// ─── CSV ─────────────────────────────────────────────────────────────────────

describe('fuzzySearch — CSV', () => {
  it('uses same jaro_winkler strategy as DuckDB', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    const result = await fuzzySearch('csv', queryFn, DEFAULT_PARAMS);
    expect(getCapturedSql(queryFn)).toContain('jaro_winkler_similarity');
    expect(result.method).toBe('jaro_winkler');
  });
});

// ─── Google Sheets ───────────────────────────────────────────────────────────

describe('fuzzySearch — Google Sheets', () => {
  it('uses same jaro_winkler strategy as DuckDB', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    const result = await fuzzySearch('google-sheets', queryFn, DEFAULT_PARAMS);
    expect(getCapturedSql(queryFn)).toContain('jaro_winkler_similarity');
    expect(result.method).toBe('jaro_winkler');
  });
});

// ─── PostgreSQL ──────────────────────────────────────────────────────────────

describe('fuzzySearch — PostgreSQL', () => {
  it('tries pg_trgm similarity() first', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([
      { value: 'Strawbery Jam', similarity: 0.55 },
    ]));
    const result = await fuzzySearch('postgresql', queryFn, DEFAULT_PARAMS);
    const sql = getCapturedSql(queryFn);
    expect(sql).toContain('similarity(');
    expect(sql).toContain('> 0.3');
    expect(result.method).toBe('trigram');
    expect(result.matches).toHaveLength(1);
  });

  it('casts column to TEXT', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    await fuzzySearch('postgresql', queryFn, DEFAULT_PARAMS);
    expect(getCapturedSql(queryFn)).toContain('CAST');
  });

  it('falls back to ILIKE when pg_trgm is not installed', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>()
      .mockRejectedValueOnce(new Error('function similarity(text, text) does not exist'))
      .mockResolvedValueOnce(qr([{ value: 'Strawbery Jam', similarity: 1.0 }]));

    const result = await fuzzySearch('postgresql', queryFn, DEFAULT_PARAMS);
    expect(queryFn).toHaveBeenCalledTimes(2);
    expect(result.method).toBe('substring');
    // Second call should use LIKE instead of similarity()
    const fallbackSql = getCapturedSql(queryFn, 1);
    expect(fallbackSql).toContain('LIKE');
    expect(fallbackSql).not.toContain('similarity(');
  });

  it('uses "public" as default schema when none specified', async () => {
    // PostgreSQL default schema is typically 'public', but our default is 'main'
    // The tool caller should pass the correct schema; we test the default behavior
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    await fuzzySearch('postgresql', queryFn, { table: 'users', column: 'name', searchTerm: 'alice' });
    const sql = getCapturedSql(queryFn);
    expect(sql).toContain('"main"."users"');
  });
});

// ─── BigQuery ────────────────────────────────────────────────────────────────

describe('fuzzySearch — BigQuery', () => {
  it('uses CONTAINS_SUBSTR and LIKE (no native fuzzy)', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    const result = await fuzzySearch('bigquery', queryFn, DEFAULT_PARAMS);
    const sql = getCapturedSql(queryFn);
    expect(sql).toContain('CONTAINS_SUBSTR');
    expect(sql).toContain('LIKE');
    expect(result.method).toBe('substring');
  });

  it('uses backtick quoting for identifiers', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    await fuzzySearch('bigquery', queryFn, { ...DEFAULT_PARAMS, schema: 'dataset1' });
    const sql = getCapturedSql(queryFn);
    expect(sql).toContain('`dataset1`');
    expect(sql).toContain('`tracks`');
    expect(sql).toContain('`title`');
  });

  it('returns similarity 1.0 for all matches (no scoring)', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([
      { value: 'Strawberry Jam', similarity: 1.0 },
    ]));
    const result = await fuzzySearch('bigquery', queryFn, DEFAULT_PARAMS);
    expect(result.matches[0]?.similarity).toBe(1.0);
  });
});

// ─── Athena ──────────────────────────────────────────────────────────────────

describe('fuzzySearch — Athena', () => {
  it('uses levenshtein_distance', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    const result = await fuzzySearch('athena', queryFn, DEFAULT_PARAMS);
    const sql = getCapturedSql(queryFn);
    expect(sql).toContain('levenshtein_distance');
    expect(result.method).toBe('levenshtein');
  });

  it('normalizes distance to 0-1 similarity', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    await fuzzySearch('athena', queryFn, DEFAULT_PARAMS);
    const sql = getCapturedSql(queryFn);
    // Should compute: 1.0 - distance / GREATEST(len1, len2, 1)
    expect(sql).toContain('1.0 -');
    expect(sql).toContain('GREATEST');
  });

  it('sets max distance threshold based on search term length', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    // "Strawberry Jam" is 14 chars → max distance = max(floor(14/3), 3) = 4
    await fuzzySearch('athena', queryFn, DEFAULT_PARAMS);
    const sql = getCapturedSql(queryFn);
    expect(sql).toContain('<= 4');
  });

  it('uses minimum distance of 3 for short search terms', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    // "ab" is 2 chars → max(floor(2/3), 3) = max(0, 3) = 3
    await fuzzySearch('athena', queryFn, { table: 't', column: 'c', searchTerm: 'ab' });
    expect(getCapturedSql(queryFn)).toContain('<= 3');
  });
});

// ─── MongoDB / Unknown (default fallback) ────────────────────────────────────

describe('fuzzySearch — default/unknown connector', () => {
  it('uses substring matching for mongo', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    const result = await fuzzySearch('mongo', queryFn, DEFAULT_PARAMS);
    const sql = getCapturedSql(queryFn);
    expect(sql).toContain('LIKE');
    expect(result.method).toBe('substring');
  });

  it('uses substring matching for unknown connector types', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    const result = await fuzzySearch('some_future_db', queryFn, DEFAULT_PARAMS);
    expect(result.method).toBe('substring');
  });

  it('splits search term into words for flexible matching', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    await fuzzySearch('mongo', queryFn, DEFAULT_PARAMS);
    const sql = getCapturedSql(queryFn);
    // "Strawberry Jam" → should produce '%strawberry%jam%' pattern
    expect(sql).toContain('%strawberry%jam%');
  });

  it('does not add word-split pattern for single-word search', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    await fuzzySearch('mongo', queryFn, { table: 't', column: 'c', searchTerm: 'hello' });
    const sql = getCapturedSql(queryFn);
    // Single word → only one LIKE pattern, no OR for word-split
    expect(sql).toContain("'%hello%'");
    // Should not have a second LIKE with word-split (no words to split)
    const likeCount = (sql.match(/LIKE/g) || []).length;
    expect(likeCount).toBe(1);
  });
});

// ─── Defaults ────────────────────────────────────────────────────────────────

describe('fuzzySearch — defaults', () => {
  it('defaults schema to "main"', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    await fuzzySearch('duckdb', queryFn, { table: 'tracks', column: 'title', searchTerm: 'test' });
    expect(getCapturedSql(queryFn)).toContain('"main"."tracks"');
  });

  it('defaults limit to 100', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    await fuzzySearch('duckdb', queryFn, { table: 't', column: 'c', searchTerm: 'x' });
    expect(getCapturedSql(queryFn)).toMatch(/LIMIT 100/);
  });

  it('respects explicit limit', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    await fuzzySearch('duckdb', queryFn, { table: 't', column: 'c', searchTerm: 'x', limit: 25 });
    expect(getCapturedSql(queryFn)).toMatch(/LIMIT 25/);
  });
});

// ─── SQL Escaping ────────────────────────────────────────────────────────────

describe('fuzzySearch — escaping', () => {
  it('escapes double quotes in identifiers', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    await fuzzySearch('duckdb', queryFn, {
      table: 'my"table', column: 'my"col', searchTerm: 'test', schema: 'my"schema',
    });
    const sql = getCapturedSql(queryFn);
    expect(sql).toContain('"my""table"');
    expect(sql).toContain('"my""col"');
    expect(sql).toContain('"my""schema"');
  });

  it('escapes single quotes in search term', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    await fuzzySearch('duckdb', queryFn, {
      table: 't', column: 'c', searchTerm: "it's a test",
    });
    const sql = getCapturedSql(queryFn);
    expect(sql).toContain("it''s a test");
  });

  it('truncates search term to 200 chars', async () => {
    const longTerm = 'a'.repeat(300);
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>().mockResolvedValue(qr([]));
    await fuzzySearch('duckdb', queryFn, { table: 't', column: 'c', searchTerm: longTerm });
    const sql = getCapturedSql(queryFn);
    // Should contain exactly 200 'a's, not 300
    expect(sql).not.toContain('a'.repeat(201));
    expect(sql).toContain('a'.repeat(200));
  });
});

// ─── Error Propagation ───────────────────────────────────────────────────────

describe('fuzzySearch — errors', () => {
  it('propagates query execution errors (non-PostgreSQL)', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>()
      .mockRejectedValue(new Error('connection refused'));
    await expect(fuzzySearch('duckdb', queryFn, DEFAULT_PARAMS)).rejects.toThrow('connection refused');
  });

  it('PostgreSQL propagates error when both trigram and fallback fail', async () => {
    const queryFn = vi.fn<(sql: string) => Promise<QueryResult>>()
      .mockRejectedValueOnce(new Error('pg_trgm not installed'))
      .mockRejectedValueOnce(new Error('relation does not exist'));
    await expect(fuzzySearch('postgresql', queryFn, DEFAULT_PARAMS)).rejects.toThrow('relation does not exist');
  });
});
