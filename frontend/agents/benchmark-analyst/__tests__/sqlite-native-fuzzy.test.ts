/**
 * Benchmark FuzzyMatch on a native sqlite connector must emit SQL that
 * runs on real SQLite — no DuckDB-only functions like jaro_winkler /
 * levenshtein. Production sqlite (DuckDB-attached) keeps the existing
 * fuzzy path; this dispatch is connector-class-based.
 */
import { describe, it, expect } from 'vitest';
import { fuzzyMatch } from '@/lib/connections/fuzzy-search';

describe('fuzzyMatch dispatch — sqlite-native', () => {
  it('the "sqlite-native" connectorType emits SQL with no DuckDB-only functions', async () => {
    const seen: string[] = [];
    const queryFn = async (sql: string) => {
      seen.push(sql);
      return { columns: [], types: [], rows: [], finalQuery: sql };
    };
    await fuzzyMatch('sqlite-native', queryFn, {
      table: 'patents',
      columns: ['title'],
      searchTerm: 'solar',
      schema: 'main',
    });
    const joined = seen.join('\n').toLowerCase();
    expect(joined).not.toContain('jaro_winkler');
    expect(joined).not.toContain('levenshtein');
    expect(joined).not.toContain('summarize');
    // It MUST emit a real SQL string that hits the column.
    expect(joined).toContain('title');
    expect(joined).toMatch(/like\s+'/i);
  });

  it('the "sqlite-native" dialect emits substring-style SQL only (no jaro_winkler fallback)', async () => {
    const seen: string[] = [];
    const queryFn = async (sql: string) => {
      seen.push(sql);
      return { columns: [], types: [], rows: [], finalQuery: sql };
    };
    const result = await fuzzyMatch('sqlite-native', queryFn, {
      table: 't',
      columns: ['a'],
      searchTerm: 'foo',
    });
    // The result should only contain a 'substring' method entry — no
    // 'jaro_winkler' or 'levenshtein' fakery.
    for (const r of result.results) {
      expect(r.method).toBe('substring');
    }
  });

  it('the existing "sqlite" dialect (production / DuckDB-attached) is unchanged', async () => {
    // Production sqlite path still uses jaro_winkler — this is the
    // explicit non-regression. The query for dialect:'sqlite' should
    // still emit jaro_winkler_similarity, because production sqlite
    // is DuckDB-attached.
    const seen: string[] = [];
    const queryFn = async (sql: string) => {
      seen.push(sql);
      return { columns: [], types: [], rows: [], finalQuery: sql };
    };
    await fuzzyMatch('sqlite', queryFn, {
      table: 't',
      columns: ['a'],
      searchTerm: 'foo',
    });
    const joined = seen.join('\n').toLowerCase();
    expect(joined).toContain('jaro_winkler_similarity');
  });
});

describe('benchmark FuzzyMatch tool — dialect dispatch by connector class', () => {
  it('benchmarkFuzzyDialect maps BenchmarkSqliteConnector → "sqlite-native"', async () => {
    const { benchmarkFuzzyDialect } = await import('../db-tools');
    const { BenchmarkSqliteConnector } = await import('../sqlite-native-connector');
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const Database = (await import('better-sqlite3')).default;
    const tmp = mkdtempSync(join(tmpdir(), 'fuzzy-dispatch-'));
    const dbPath = join(tmp, 'x.db');
    new Database(dbPath).close();
    try {
      const conn = new BenchmarkSqliteConnector('x', { file_path: dbPath });
      expect(benchmarkFuzzyDialect(conn, 'sqlite')).toBe('sqlite-native');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('benchmarkFuzzyDialect passes through non-sqlite dialects unchanged', async () => {
    const { benchmarkFuzzyDialect } = await import('../db-tools');
    // Any non-native connector — using a stub shaped like NodeConnector.
    const stub = { name: 's' } as never;
    expect(benchmarkFuzzyDialect(stub, 'duckdb')).toBe('duckdb');
    expect(benchmarkFuzzyDialect(stub, 'postgresql')).toBe('postgresql');
    expect(benchmarkFuzzyDialect(stub, 'mongo')).toBe('mongo');
  });
});

