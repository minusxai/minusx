// Behaviour for the benchmark ExecuteQuery tool:
//  - `clampQueryTimeoutSeconds` — pure clamp logic (default 60s, max 300s).
//  - `BaseExecuteQuery` with a tiny `timeout` against a real slow query —
//    verifies the DuckDB `interrupt()` wiring actually cancels an
//    in-flight query and surfaces a clean error (rather than hanging).
//  - `BaseExecuteQuery` against a MongoDB connection — the `query` string is
//    JSON `{collection, pipeline}` run natively (mongodb driver mocked).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import RealDatabase from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

// Mongo driver mock — `mock`-prefixed state so vitest's vi.mock hoisting
// permits the factory closure to reference them.
let mockMongoAggregate: (collection: string, pipeline: unknown) => Record<string, unknown>[] = () => [];
const mockMongoAggregateCalls: Array<{ collection: string; pipeline: unknown; options: unknown }> = [];
vi.mock('mongodb', () => ({
  MongoClient: vi.fn().mockImplementation(function (this: any) {
    this.connect = vi.fn().mockImplementation(async () => this);
    this.db = vi.fn().mockReturnValue({
      command: vi.fn().mockResolvedValue({ ok: 1 }),
      collection: vi.fn().mockImplementation((name: string) => ({
        aggregate: vi.fn().mockImplementation((pipeline: unknown, options: unknown) => {
          mockMongoAggregateCalls.push({ collection: name, pipeline, options });
          return { toArray: vi.fn().mockImplementation(async () => mockMongoAggregate(name, pipeline)) };
        }),
      })),
    });
  }),
}));

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

describe('BaseExecuteQuery — MongoDB connection (native aggregation pipeline)', () => {
  beforeEach(() => {
    mockMongoAggregate = () => [];
    mockMongoAggregateCalls.length = 0;
  });

  const mongoCtx = (): BenchmarkAnalystContext => ({
    connections: [
      { name: 'm', dialect: 'mongo', config: { host: 'localhost', port: 27017, database: 'd' } },
    ],
  });

  it('runs the JSON {collection,pipeline} query natively and returns a compressed result', async () => {
    mockMongoAggregate = () => [{ city: 'NYC', n: 12 }, { city: 'LA', n: 7 }];
    const tool = new BaseExecuteQuery(
      undefined as never,
      {
        connectionId: 'm',
        query: JSON.stringify({ collection: 'biz', pipeline: [{ $group: { _id: '$city' } }] }),
      },
      mongoCtx(),
    );
    const res = await tool.run();

    expect(res.isError).toBe(false);
    // The JSON query string reached MongoConnector.query → collection.aggregate;
    // enforceMongoLimit appended {$limit:1000} (no SQL enforceQueryLimit ran).
    expect(mockMongoAggregateCalls[0].collection).toBe('biz');
    expect(mockMongoAggregateCalls[0].pipeline).toEqual([
      { $group: { _id: '$city' } },
      { $limit: 1000 },
    ]);
    const payload = JSON.parse((res.content[0] as { text: string }).text);
    expect(payload.success).toBe(true);
  });

  it('surfaces a helpful error when an LLM sends SQL to a mongo connection', async () => {
    const tool = new BaseExecuteQuery(
      undefined as never,
      { connectionId: 'm', query: 'SELECT * FROM biz' },
      mongoCtx(),
    );
    const res = await tool.run();
    expect(res.isError).toBe(true);
    const payload = JSON.parse((res.content[0] as { text: string }).text);
    expect(payload.error).toMatch(/JSON parse failed/i);
  });
});
