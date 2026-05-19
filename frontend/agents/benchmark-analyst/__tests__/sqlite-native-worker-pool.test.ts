/**
 * Concurrency invariant: queries dispatched through the worker pool
 * actually run in parallel on different OS threads.
 *
 * We seed a sqlite fixture with enough rows to make a heavy recursive
 * CTE take a measurable wall-clock time, then dispatch 4 of them in
 * parallel. If the worker pool is working correctly the total wall-clock
 * is much closer to the single-query time than to 4× it (the synchronous
 * blocking we're trying to avoid).
 *
 * Threshold: 4 parallel calls should take less than ~2× a solo call.
 * If it's anywhere near 4× we're back to JS-thread serialization.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BenchmarkSqliteConnector } from '../sqlite-native-connector';

const TMP = mkdtempSync(join(tmpdir(), 'sqlite-worker-pool-'));
const DB_PATH = join(TMP, 'pool.db');

// Heavy-enough query so wall-clock dominates measurement noise even when
// the suite runs in vitest's own worker pool (which causes OS-level
// contention with our workers). ~1M-row recursive series gives ~200-500ms
// per call on a typical dev machine.
const HEAVY_SQL = `
  WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < 1000000)
  SELECT COUNT(*) AS c, SUM(n) AS s, AVG(n * 1.0) AS a FROM seq
`;

/**
 * Run a function 3 times, return the median duration in ms. Median is
 * resistant to one-off OS scheduling spikes (which dominate variance in
 * short workloads inside a busy test suite).
 */
async function medianMs(fn: () => Promise<unknown>): Promise<number> {
  const samples: number[] = [];
  for (let i = 0; i < 3; i++) {
    const t = Date.now();
    await fn();
    samples.push(Date.now() - t);
  }
  samples.sort((a, b) => a - b);
  return samples[1];
}

beforeAll(() => {
  const db = new Database(DB_PATH);
  db.exec('CREATE TABLE t (id INTEGER); INSERT INTO t VALUES (1);');
  db.close();
});

afterAll(() => rmSync(TMP, { recursive: true, force: true }));

describe('BenchmarkSqliteConnector — worker pool concurrency', () => {
  it('4 parallel heavy queries finish in significantly less than 4× the solo time', async () => {
    const connector = new BenchmarkSqliteConnector('p', { file_path: DB_PATH });
    try {
      // Warm: spawn workers + page cache.
      await connector.query(HEAVY_SQL);

      const soloMs = await medianMs(() => connector.query(HEAVY_SQL));
      const parallelMs = await medianMs(() =>
        Promise.all(Array.from({ length: 4 }, () => connector.query(HEAVY_SQL))),
      );

      // If the pool serialized on the JS thread we'd see ~4× solo.
      // With true parallelism we'd see ~1× solo + overhead.
      // Threshold of 3× catches real regressions (5×+ that we saw with
      // sync better-sqlite3) while tolerating noisy CI/test environments.
      const ratio = parallelMs / Math.max(soloMs, 1);
      // eslint-disable-next-line no-console
      console.log(`[worker-pool] solo=${soloMs}ms  4parallel=${parallelMs}ms  ratio=${ratio.toFixed(2)}×`);
      expect(ratio, `expected <3×; got ${ratio.toFixed(2)}× (solo=${soloMs}ms parallel=${parallelMs}ms)`).toBeLessThan(3);
    } finally {
      connector.close();
    }
  }, 120000);

  it('all 10 parallel queries resolve with correct results', async () => {
    const connector = new BenchmarkSqliteConnector('p', { file_path: DB_PATH });
    try {
      const results = await Promise.all(
        Array.from({ length: 10 }, () => connector.query('SELECT 42 AS x')),
      );
      for (const r of results) expect(r.rows).toEqual([{ x: 42 }]);
    } finally {
      connector.close();
    }
  });

  it('errors propagate correctly — bad SQL on one call does not poison the pool', async () => {
    const connector = new BenchmarkSqliteConnector('p', { file_path: DB_PATH });
    try {
      await expect(connector.query('SELECT * FROM no_such_table')).rejects.toThrow(/no such table/i);
      // Subsequent good queries still work.
      const r = await connector.query('SELECT 1 AS x');
      expect(r.rows).toEqual([{ x: 1 }]);
    } finally {
      connector.close();
    }
  });
});
