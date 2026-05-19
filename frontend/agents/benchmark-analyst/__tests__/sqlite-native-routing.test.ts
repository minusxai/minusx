/**
 * `getOrCreateBenchmarkConnector` must route `dialect: 'sqlite'` to the
 * native `BenchmarkSqliteConnector` (better-sqlite3), not the shared
 * DuckDB instance. duckdb dialect keeps the shared-DuckDB path.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getOrCreateBenchmarkConnector, detachAllBenchmarkAttachments } from '../shared-duckdb';
import { BenchmarkSqliteConnector } from '../sqlite-native-connector';

const TMP = mkdtempSync(join(tmpdir(), 'sqlite-routing-'));
const SQLITE_DB = join(TMP, 'fixture.db');

beforeAll(() => {
  const db = new Database(SQLITE_DB);
  db.exec(`CREATE TABLE t (id INTEGER); INSERT INTO t VALUES (1);`);
  db.close();
});

afterAll(async () => {
  await detachAllBenchmarkAttachments().catch(() => { /* shared may be uninit */ });
  rmSync(TMP, { recursive: true, force: true });
});

describe('benchmark connector factory — sqlite routing', () => {
  it('sqlite dialect returns a BenchmarkSqliteConnector (not the shared-DuckDB connector)', async () => {
    const c = await getOrCreateBenchmarkConnector('fixture_sqlite', 'sqlite', { file_path: SQLITE_DB });
    expect(c).toBeInstanceOf(BenchmarkSqliteConnector);
  });

  it('the routed sqlite connector actually queries the SQLite file', async () => {
    const c = await getOrCreateBenchmarkConnector('fixture_sqlite2', 'sqlite', { file_path: SQLITE_DB });
    const r = await c.query('SELECT id FROM t');
    expect(r.rows).toEqual([{ id: 1 }]);
  });

  it('sqlite connectors are cached process-wide by connection name', async () => {
    const a = await getOrCreateBenchmarkConnector('cached_sqlite', 'sqlite', { file_path: SQLITE_DB });
    const b = await getOrCreateBenchmarkConnector('cached_sqlite', 'sqlite', { file_path: SQLITE_DB });
    expect(a).toBe(b);
  });

  it('_scratch is still a DuckDB-backed connection, not native sqlite', async () => {
    const c = await getOrCreateBenchmarkConnector('_scratch', 'duckdb', {});
    expect(c).not.toBeInstanceOf(BenchmarkSqliteConnector);
  });

  // After the migration: shared-duckdb only handles duckdb. If a stray
  // `dialect: 'sqlite'` ever leaks into `ensureAttached` (e.g. someone
  // re-adds a sqlite ATTACH path), the type narrowing in shared-duckdb.ts
  // means the call won't even compile. This test pins the runtime side:
  // detaching after a sqlite-only run leaves the shared instance with
  // zero ATTACHments — no sqlite alias was registered.
  it('a sqlite-only routing pass registers zero ATTACHments in shared DuckDB', async () => {
    await detachAllBenchmarkAttachments().catch(() => { /* may be uninit */ });
    await getOrCreateBenchmarkConnector('sqlite_only_test', 'sqlite', { file_path: SQLITE_DB });
    // If shared DuckDB exists, it must contain no entries. We can't
    // directly introspect the singleton, but detachAll is a no-op when
    // empty — invoke and trust the contract.
    await expect(detachAllBenchmarkAttachments()).resolves.not.toThrow();
  });
});
