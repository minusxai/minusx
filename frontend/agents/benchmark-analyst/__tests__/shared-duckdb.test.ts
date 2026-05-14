// Exercises the benchmark shared-DuckDB connector against a real temp
// SQLite file attached READ_ONLY — the exact path the benchmark CLI uses
// for sqlite/duckdb datasets. Verifies index introspection survives the
// DuckDB-attached-SQLite hop (confirmed manually; locked in here).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import RealDatabase from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { getOrCreateBenchmarkConnector } from '../shared-duckdb';

let tmpDir: string;
let sqlitePath: string;

beforeAll(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'bench-shared-'));
  sqlitePath = path.join(tmpDir, 'patents.sqlite');
  const db = new RealDatabase(sqlitePath);
  db.exec(`
    CREATE TABLE publicationinfo (id INTEGER PRIMARY KEY, assignee TEXT, country TEXT, filing_date TEXT);
    CREATE INDEX idx_assignee ON publicationinfo(assignee);
    CREATE INDEX idx_country_date ON publicationinfo(country, filing_date);
  `);
  db.close();
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('getOrCreateBenchmarkConnector → getSchema', () => {
  it('surfaces indexes from an attached READ_ONLY SQLite db', async () => {
    const connector = await getOrCreateBenchmarkConnector(
      'bench_patents',
      'sqlite',
      { file_path: sqlitePath },
    );
    const schema = await connector.getSchema();

    // Single schema, single table.
    const table = schema.flatMap(s => s.tables).find(t => t.table === 'publicationinfo')!;
    expect(table).toBeDefined();
    expect(table.indexes).toEqual([
      { name: 'idx_assignee', columns: ['assignee'], unique: false },
      { name: 'idx_country_date', columns: ['country', 'filing_date'], unique: false },
    ]);
  });
});
