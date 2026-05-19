/**
 * BenchmarkSqliteConnector — real SQLite via better-sqlite3.
 *
 * Pins the contract: the connector behaves like any other NodeConnector,
 * but uses the actual SQLite engine (not DuckDB-via-ATTACH). Schema types
 * are SQLite-native (INTEGER/TEXT/REAL/BLOB/NUMERIC), errors are real
 * SQLite errors, and DuckDB-only syntax fails as it would on real SQLite.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BenchmarkSqliteConnector } from '../sqlite-native-connector';

const TMP = mkdtempSync(join(tmpdir(), 'sqlite-native-conn-'));
const DB_PATH = join(TMP, 'fixture.db');

beforeAll(() => {
  const db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE patents (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      filing_year INTEGER,
      score REAL,
      cpc TEXT
    );
    CREATE INDEX idx_patents_year ON patents(filing_year);
    INSERT INTO patents VALUES
      (1, 'first',  2020, 1.5, '[{"code":"A01B"}]'),
      (2, 'second', 2021, 2.5, '[{"code":"A01B"},{"code":"B02C"}]'),
      (3, 'third',  2022, NULL, '[]');
  `);
  db.close();
});

afterAll(() => rmSync(TMP, { recursive: true, force: true }));

describe('BenchmarkSqliteConnector', () => {
  describe('testConnection', () => {
    it('returns success for a valid sqlite file', async () => {
      const c = new BenchmarkSqliteConnector('t', { file_path: DB_PATH });
      const r = await c.testConnection();
      expect(r.success).toBe(true);
    });

    it('returns failure for a missing file', async () => {
      const c = new BenchmarkSqliteConnector('t', { file_path: '/nonexistent.db' });
      const r = await c.testConnection();
      expect(r.success).toBe(false);
      expect(r.message).toMatch(/not found|no such/i);
    });

    it('includes schema when requested', async () => {
      const c = new BenchmarkSqliteConnector('t', { file_path: DB_PATH });
      const r = await c.testConnection(true);
      expect(r.success).toBe(true);
      expect(r.schema?.schemas).toBeDefined();
      expect(r.schema?.schemas[0].tables.map((t) => t.table)).toContain('patents');
    });
  });

  describe('query', () => {
    it('runs a simple SELECT and returns rows', async () => {
      const c = new BenchmarkSqliteConnector('t', { file_path: DB_PATH });
      const r = await c.query('SELECT id, title, filing_year FROM patents ORDER BY id');
      expect(r.rows).toEqual([
        { id: 1, title: 'first', filing_year: 2020 },
        { id: 2, title: 'second', filing_year: 2021 },
        { id: 3, title: 'third', filing_year: 2022 },
      ]);
      expect(r.columns).toEqual(['id', 'title', 'filing_year']);
    });

    it('supports :name parameters', async () => {
      const c = new BenchmarkSqliteConnector('t', { file_path: DB_PATH });
      const r = await c.query(
        'SELECT title FROM patents WHERE filing_year = :year',
        { year: 2021 },
      );
      expect(r.rows).toEqual([{ title: 'second' }]);
    });

    it('returns SQLite-native column types (no DuckDB type names)', async () => {
      const c = new BenchmarkSqliteConnector('t', { file_path: DB_PATH });
      const r = await c.query('SELECT id, title, score FROM patents LIMIT 1');
      // SQLite declared types from sqlite_master: INTEGER, TEXT, REAL.
      // Must NOT be DuckDB types like BIGINT, VARCHAR, DOUBLE.
      const joined = r.types.join(',').toUpperCase();
      expect(joined).not.toContain('BIGINT');
      expect(joined).not.toContain('VARCHAR');
      expect(joined).not.toContain('DOUBLE');
      // Should contain at least one SQLite-style type.
      expect(joined).toMatch(/INTEGER|TEXT|REAL/);
    });

    it('errors with real SQLite messages — no DuckDB prefixes', async () => {
      const c = new BenchmarkSqliteConnector('t', { file_path: DB_PATH });
      await expect(c.query('SELECT * FROM no_such_table')).rejects.toThrow(/no such table/i);
    });

    it('DuckDB-only functions fail with SQLite errors, not silent success', async () => {
      const c = new BenchmarkSqliteConnector('t', { file_path: DB_PATH });
      // UNNEST, regexp_extract, generate_series are DuckDB-only.
      await expect(c.query('SELECT UNNEST([1,2,3])')).rejects.toThrow();
      await expect(c.query("SELECT regexp_extract('abc', '[a-z]', 0)")).rejects.toThrow();
      // The error text must NOT mention DuckDB or Binder Error.
      try {
        await c.query("SELECT regexp_extract('abc', '[a-z]', 0)");
      } catch (e) {
        const msg = (e as Error).message.toLowerCase();
        expect(msg).not.toContain('duckdb');
        expect(msg).not.toContain('binder error');
      }
    });

    it('json_each + json_extract work as native JSON1', async () => {
      const c = new BenchmarkSqliteConnector('t', { file_path: DB_PATH });
      const r = await c.query(`
        SELECT json_extract(j.value, '$.code') AS code
        FROM patents p, json_each(p.cpc) j
        WHERE p.id = 2
        ORDER BY code
      `);
      expect(r.rows).toEqual([{ code: 'A01B' }, { code: 'B02C' }]);
    });

    it('exposes finalQuery with inlined params', async () => {
      const c = new BenchmarkSqliteConnector('t', { file_path: DB_PATH });
      const r = await c.query(
        'SELECT title FROM patents WHERE filing_year = :year',
        { year: 2021 },
      );
      expect(r.finalQuery).toContain('2021');
      expect(r.finalQuery).not.toContain(':year');
    });
  });

  describe('getSchema', () => {
    it('returns the patents table with SQLite-native column types', async () => {
      const c = new BenchmarkSqliteConnector('t', { file_path: DB_PATH });
      const schemas = await c.getSchema();
      // Single sqlite "main" schema.
      expect(schemas).toHaveLength(1);
      const tables = schemas[0].tables;
      const patents = tables.find((t) => t.table === 'patents');
      expect(patents).toBeDefined();
      const cols = patents!.columns.map((c) => ({ name: c.name, type: c.type.toUpperCase() }));
      expect(cols).toEqual(
        expect.arrayContaining([
          { name: 'id', type: 'INTEGER' },
          { name: 'title', type: 'TEXT' },
          { name: 'filing_year', type: 'INTEGER' },
          { name: 'score', type: 'REAL' },
          { name: 'cpc', type: 'TEXT' },
        ]),
      );
    });

    it('exposes indexes via PRAGMA introspection', async () => {
      const c = new BenchmarkSqliteConnector('t', { file_path: DB_PATH });
      const schemas = await c.getSchema();
      const patents = schemas[0].tables.find((t) => t.table === 'patents')!;
      expect(patents.indexes).toBeDefined();
      const idxNames = patents.indexes!.map((i) => i.name);
      expect(idxNames).toContain('idx_patents_year');
      const yearIdx = patents.indexes!.find((i) => i.name === 'idx_patents_year')!;
      expect(yearIdx.columns).toEqual(['filing_year']);
      expect(yearIdx.unique).toBe(false);
    });

    it('skips sqlite_* internal tables', async () => {
      const c = new BenchmarkSqliteConnector('t', { file_path: DB_PATH });
      const schemas = await c.getSchema();
      for (const s of schemas) {
        for (const t of s.tables) {
          expect(t.table.startsWith('sqlite_')).toBe(false);
        }
      }
    });
  });
});
