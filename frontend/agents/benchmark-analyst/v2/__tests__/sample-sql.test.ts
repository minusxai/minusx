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

  // Postgres: was `TABLESAMPLE BERNOULLI(1) LIMIT N`. That's a 1%
  // sample, which on small tables (typical of benchmark datasets — many
  // <100 rows) returns 0 or 1 row. Switched to `ORDER BY RANDOM()
  // LIMIT N` — always returns up to N rows regardless of table size.
  // Slower on huge tables (full sort) but fine for benchmark scale.
  it('uses ORDER BY RANDOM() LIMIT for postgresql (handles small tables)', () => {
    expect(buildSampleSql('postgresql', 'public', 'users', 100)).toBe(
      'SELECT * FROM "public"."users" ORDER BY RANDOM() LIMIT 100',
    );
  });

  // BigQuery: same story — `TABLESAMPLE SYSTEM (1 PERCENT)` is
  // block-level sampling that fails for small tables. `ORDER BY RAND()`
  // is BigQuery's idiomatic random-sample (RAND() not RANDOM()).
  it('uses ORDER BY RAND() LIMIT for bigquery (handles small tables)', () => {
    expect(buildSampleSql('bigquery', 'mydataset', 'events', 100)).toBe(
      'SELECT * FROM `mydataset.events` ORDER BY RAND() LIMIT 100',
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
