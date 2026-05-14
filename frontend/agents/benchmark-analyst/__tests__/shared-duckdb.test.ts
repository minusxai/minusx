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
    INSERT INTO publicationinfo VALUES (1, 'ACME', 'US', '2020-01-01');
    INSERT INTO publicationinfo VALUES (2, 'GLOBEX', 'DE', '2021-06-15');
    INSERT INTO publicationinfo VALUES (3, 'INITECH', 'US', '2022-03-30');
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

  it('serves many concurrent queries correctly through the bounded connection pool', async () => {
    // Far more concurrent queries than the pool's MAX_POOL (8) — exercises
    // the acquire/wait/release path under contention. All must return the
    // correct result with no deadlock and no cross-talk between borrowed
    // connections. (Pre-pool, this churned connect()/closeSync() per query
    // and crashed natively under the benchmark's real concurrency.)
    const connector = await getOrCreateBenchmarkConnector(
      'bench_patents',
      'sqlite',
      { file_path: sqlitePath },
    );

    const results = await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        // Alternate two distinct queries so a mis-released connection
        // serving the wrong result would show up as a wrong count.
        i % 2 === 0
          ? connector.query('SELECT count(*) AS c FROM publicationinfo')
          : connector.query("SELECT count(*) AS c FROM publicationinfo WHERE country = 'US'"),
      ),
    );

    results.forEach((res, i) => {
      expect(res.rows).toEqual([{ c: i % 2 === 0 ? 3 : 2 }]);
    });
  });
});
