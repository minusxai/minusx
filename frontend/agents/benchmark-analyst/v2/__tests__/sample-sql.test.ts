// Per-dialect sample-SQL builder. Pure function; tests are just shape checks.

import { describe, it, expect } from 'vitest';
import { buildSampleSql } from '../sample-sql';

describe('buildSampleSql', () => {
  it('uses DuckDB USING SAMPLE for duckdb / sqlite (benchmark-sqlite routes through DuckDB)', () => {
    expect(buildSampleSql('duckdb', 'main', 'orders', 100)).toBe(
      'SELECT * FROM "orders" USING SAMPLE 100 ROWS',
    );
    expect(buildSampleSql('sqlite', 'main', 'orders', 100)).toBe(
      'SELECT * FROM "orders" USING SAMPLE 100 ROWS',
    );
  });

  it('qualifies with schema when not the default `main`', () => {
    expect(buildSampleSql('duckdb', 'public', 'orders', 50)).toBe(
      'SELECT * FROM "public"."orders" USING SAMPLE 50 ROWS',
    );
  });

  it('uses TABLESAMPLE BERNOULLI for postgresql', () => {
    expect(buildSampleSql('postgresql', 'public', 'users', 100)).toBe(
      'SELECT * FROM "public"."users" TABLESAMPLE BERNOULLI(1) LIMIT 100',
    );
  });

  it('uses TABLESAMPLE SYSTEM with backticks for bigquery', () => {
    expect(buildSampleSql('bigquery', 'mydataset', 'events', 100)).toBe(
      'SELECT * FROM `mydataset.events` TABLESAMPLE SYSTEM (1 PERCENT) LIMIT 100',
    );
  });

  it('emits a Mongo aggregation pipeline JSON for mongo', () => {
    const result = buildSampleSql('mongo', null, 'business', 100);
    expect(JSON.parse(result)).toEqual({
      collection: 'business',
      pipeline: [{ $sample: { size: 100 } }],
    });
  });

  it('falls back to ORDER BY RANDOM() for unknown dialects', () => {
    expect(buildSampleSql('mysql', 'public', 't', 50)).toBe(
      'SELECT * FROM "public"."t" ORDER BY RANDOM() LIMIT 50',
    );
  });

  it('escapes embedded double-quotes in identifiers', () => {
    // The catalog must not let an exotic table name break the SQL.
    expect(buildSampleSql('duckdb', null, 'weird"name', 10)).toBe(
      'SELECT * FROM "weird""name" USING SAMPLE 10 ROWS',
    );
  });
});
