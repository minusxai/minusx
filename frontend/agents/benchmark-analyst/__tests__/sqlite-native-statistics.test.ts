/**
 * Statistics enrichment must run cleanly against `BenchmarkSqliteConnector`
 * using only native SQLite primitives. No SUMMARIZE, no DuckDB-only
 * functions, no DuckDB type names in the classification path.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BenchmarkSqliteConnector } from '../sqlite-native-connector';
import { profileDatabase } from '@/lib/connections/statistics-engine';

const TMP = mkdtempSync(join(tmpdir(), 'sqlite-native-stats-'));
const DB_PATH = join(TMP, 'fixture.db');

beforeAll(() => {
  const db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE products (
      id INTEGER PRIMARY KEY,
      name TEXT,
      category TEXT,
      price REAL,
      stock INTEGER
    );
    INSERT INTO products VALUES
      (1, 'a', 'cat1', 1.5, 10),
      (2, 'b', 'cat1', 2.5, 20),
      (3, 'c', 'cat2', NULL, 5),
      (4, 'd', 'cat2', 4.0, NULL);
  `);
  db.close();
});

afterAll(() => rmSync(TMP, { recursive: true, force: true }));

describe('profileDatabase against BenchmarkSqliteConnector', () => {
  it('runs profileGeneric using only native SQLite SQL (no SUMMARIZE)', async () => {
    const c = new BenchmarkSqliteConnector('t', { file_path: DB_PATH });
    const schemas = await c.getSchema();

    const seenSql: string[] = [];
    const result = await profileDatabase('sqlite', schemas, async (sql) => {
      seenSql.push(sql);
      return c.query(sql);
    });

    const joined = seenSql.join('\n').toUpperCase();
    // Must not use DuckDB-only constructs in the emitted SQL.
    expect(joined).not.toContain('SUMMARIZE');
    expect(joined).not.toContain('QUALIFY');
    expect(joined).not.toContain('UNNEST');

    // Profile completed — schema is enriched with column metadata.
    expect(result.schema).toHaveLength(1);
    expect(result.connectorType).toBe('sqlite');
    expect(result.queryCount).toBeGreaterThan(0);
  });

  it('every column gets enriched metadata — proves profileGeneric ran end-to-end', async () => {
    const c = new BenchmarkSqliteConnector('t', { file_path: DB_PATH });
    const schemas = await c.getSchema();
    const result = await profileDatabase('sqlite', schemas, async (sql) => c.query(sql));

    const products = result.schema[0].tables.find((t) => t.table === 'products')!;
    for (const col of products.columns) {
      expect(col.meta, `${col.name} should have meta`).toBeDefined();
      expect(col.meta?.category, `${col.name} category`).toBeDefined();
    }
    // TEXT column with low cardinality (4 rows, 2 distinct of 'cat1'/'cat2')
    // is the unambiguous classification: categorical with top values.
    const category = products.columns.find((c) => c.name === 'category')!;
    expect(category.meta?.category).toBe('categorical');
    expect(category.meta?.topValues).toBeDefined();
    const cats = (category.meta?.topValues ?? []).map((t) => t.value).sort();
    expect(cats).toEqual(['cat1', 'cat2']);
  });
});
