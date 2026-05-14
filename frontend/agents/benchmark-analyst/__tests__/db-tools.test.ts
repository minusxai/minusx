// Timeout behaviour for the benchmark ExecuteQuery tool:
//  - `clampQueryTimeoutSeconds` — pure clamp logic (default 60s, max 300s).
//  - `BaseExecuteQuery` with a tiny `timeout` against a real slow query —
//    verifies the DuckDB `interrupt()` wiring actually cancels an
//    in-flight query and surfaces a clean error (rather than hanging).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import RealDatabase from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import {
  BaseExecuteQuery,
  clampQueryTimeoutSeconds,
  DEFAULT_QUERY_TIMEOUT_SEC,
  MAX_QUERY_TIMEOUT_SEC,
} from '../db-tools';
import type { BenchmarkAnalystContext } from '../types';

describe('clampQueryTimeoutSeconds', () => {
  it('defaults to 60s when unset / non-finite', () => {
    expect(clampQueryTimeoutSeconds(undefined)).toBe(DEFAULT_QUERY_TIMEOUT_SEC);
    expect(clampQueryTimeoutSeconds(NaN)).toBe(DEFAULT_QUERY_TIMEOUT_SEC);
    expect(DEFAULT_QUERY_TIMEOUT_SEC).toBe(60);
  });

  it('clamps above the 300s (5 min) ceiling', () => {
    expect(clampQueryTimeoutSeconds(99999)).toBe(MAX_QUERY_TIMEOUT_SEC);
    expect(MAX_QUERY_TIMEOUT_SEC).toBe(300);
  });

  it('clamps non-positive values up to 1s', () => {
    expect(clampQueryTimeoutSeconds(0)).toBe(1);
    expect(clampQueryTimeoutSeconds(-5)).toBe(1);
  });

  it('passes through valid in-range values (floored)', () => {
    expect(clampQueryTimeoutSeconds(120)).toBe(120);
    expect(clampQueryTimeoutSeconds(45.9)).toBe(45);
  });
});

describe('BaseExecuteQuery timeout', () => {
  let tmpDir: string;
  let sqlitePath: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'db-tools-timeout-'));
    sqlitePath = path.join(tmpDir, 'tiny.sqlite');
    const db = new RealDatabase(sqlitePath);
    db.exec(`CREATE TABLE t (id INTEGER); INSERT INTO t VALUES (1);`);
    db.close();
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const ctx = (): BenchmarkAnalystContext => ({
    connections: [{ name: 'tiny', dialect: 'sqlite', config: { file_path: sqlitePath } }],
  });

  it('interrupts a slow query when it exceeds the timeout, returns a clean error', async () => {
    // `range(20_000_000_000)` is a multi-second scan in DuckDB; a 1s
    // timeout must cancel it well before it would finish on its own.
    const tool = new BaseExecuteQuery(
      // orchestrator not used by run() for this path
      undefined as never,
      { connectionId: 'tiny', query: 'SELECT count(*) AS c FROM range(20000000000)', timeout: 1 },
      ctx(),
    );
    const start = Date.now();
    const res = await tool.run();
    const elapsedMs = Date.now() - start;

    expect(res.isError).toBe(true);
    // The in-flight promise rejected (didn't hang) — well under the time
    // the full scan would have taken.
    expect(elapsedMs).toBeLessThan(15000);
  }, 20000);

  it('completes a fast query normally within the timeout', async () => {
    const tool = new BaseExecuteQuery(
      undefined as never,
      { connectionId: 'tiny', query: 'SELECT id FROM t', timeout: 60 },
      ctx(),
    );
    const res = await tool.run();
    expect(res.isError).toBe(false);
  });
});
