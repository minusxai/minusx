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
// Second SQLite file with a different schema, addressed by the SAME logical
// connection name as the primary one — simulates two benchmark datasets in
// parallel that both call their database `bench_metadata` but point at
// different physical files.
let sqlitePathDatasetB: string;

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

  sqlitePathDatasetB = path.join(tmpDir, 'recipes.sqlite');
  const dbB = new RealDatabase(sqlitePathDatasetB);
  dbB.exec(`
    CREATE TABLE recipes (id INTEGER PRIMARY KEY, name TEXT);
    INSERT INTO recipes VALUES (1, 'tacos');
    INSERT INTO recipes VALUES (2, 'pasta');
  `);
  dbB.close();
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

  // Regression for the parallel-datasets ATTACH collision:
  //   `Benchmark shared DuckDB alias 'metadata_database' is already attached
  //    to '/path/to/A.db'; cannot re-attach to '/path/to/B.db'.`
  // Two benchmark datasets dispatch in parallel (per main's runner) and both
  // declare a connection named `metadata_database` for different files. The
  // shared DuckDB instance is process-wide — but the ATTACH alias namespace
  // should be per-`datasetKey` so the second dataset doesn't blow up.
  it('isolates same-name connections across datasets via `datasetKey`', async () => {
    const aConn = await getOrCreateBenchmarkConnector(
      'bench_metadata', 'sqlite', { file_path: sqlitePath },
      { datasetKey: 'dataset-a' },
    );
    const bConn = await getOrCreateBenchmarkConnector(
      'bench_metadata', 'sqlite', { file_path: sqlitePathDatasetB },
      { datasetKey: 'dataset-b' },
    );

    // Each connector resolves to its OWN underlying SQLite file. If the
    // ATTACH was globally shared, dataset-b would either error here or
    // return rows from dataset-a's schema.
    const a = await aConn.query('SELECT count(*) AS c FROM publicationinfo');
    const b = await bConn.query('SELECT count(*) AS c FROM recipes');
    expect(a.rows[0].c).toBe(3);
    expect(b.rows[0].c).toBe(2);
  });

  it('reuses the cached connector when called twice with the same name + datasetKey', async () => {
    // Re-call must NOT re-attach (idempotency invariant within a dataset).
    // If the namespacing was wrong this could throw with the alias-collision
    // error against itself.
    const c1 = await getOrCreateBenchmarkConnector(
      'bench_dup', 'sqlite', { file_path: sqlitePath },
      { datasetKey: 'dataset-c' },
    );
    const c2 = await getOrCreateBenchmarkConnector(
      'bench_dup', 'sqlite', { file_path: sqlitePath },
      { datasetKey: 'dataset-c' },
    );
    // Same display name — agent's view of the connection is unchanged.
    const r1 = await c1.query('SELECT count(*) AS c FROM publicationinfo');
    const r2 = await c2.query('SELECT count(*) AS c FROM publicationinfo');
    expect(r1.rows[0].c).toBe(3);
    expect(r2.rows[0].c).toBe(3);
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
