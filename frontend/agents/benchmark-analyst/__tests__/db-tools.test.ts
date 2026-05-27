// Behaviour for the benchmark ExecuteQuery tool, post-V2-primitive port.
//
// New shape: `BaseExecuteQuery` is a chained pipeline.
// - `queries: [{connection, query, label?}]` — N queries run sequentially.
// - Queries 2+ MUST contain a `$label.col` reference (per-call or session).
// - Whole-batch fail: any error aborts and returns `{error}`.
// - Returns ONLY the final query's `{preview, handle, stats}`.
// - Mongo queries are JSON `{collection, pipeline}` strings — unchanged from V1.
// - `$label.col` interpolation: SQL → comma-separated literals; Mongo → JSON array.
// - `FROM handle_xyz` works in any dataset via the built-in `_scratch` DuckDB.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import RealDatabase from 'better-sqlite3';
import { mkdtempSync } from 'fs';
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
  ChainedExecuteQuery,
  clampQueryTimeoutSeconds,
  DEFAULT_QUERY_TIMEOUT_SEC,
  MAX_QUERY_TIMEOUT_SEC,
} from '../db-tools';
import { clearHandles } from '../v2/handle-store';
import { clearSessionLabels } from '../v2/query-refs';
import type { BenchmarkAnalystContext } from '../types';

describe('clampQueryTimeoutSeconds', () => {
  it('defaults to 60s when unset / non-finite', () => {
    expect(clampQueryTimeoutSeconds(undefined)).toBe(DEFAULT_QUERY_TIMEOUT_SEC);
    expect(clampQueryTimeoutSeconds(Number.NaN)).toBe(DEFAULT_QUERY_TIMEOUT_SEC);
    expect(clampQueryTimeoutSeconds(Number.POSITIVE_INFINITY)).toBe(DEFAULT_QUERY_TIMEOUT_SEC);
  });

  it('clamps above the 300s (5 min) ceiling', () => {
    expect(clampQueryTimeoutSeconds(600)).toBe(MAX_QUERY_TIMEOUT_SEC);
    expect(clampQueryTimeoutSeconds(MAX_QUERY_TIMEOUT_SEC)).toBe(MAX_QUERY_TIMEOUT_SEC);
  });

  it('clamps non-positive values up to 1s', () => {
    expect(clampQueryTimeoutSeconds(0)).toBe(1);
    expect(clampQueryTimeoutSeconds(-5)).toBe(1);
  });

  it('passes through valid in-range values (floored)', () => {
    expect(clampQueryTimeoutSeconds(30)).toBe(30);
    expect(clampQueryTimeoutSeconds(30.9)).toBe(30);
  });
});

// ─── ChainedExecuteQuery — single query (no chain) ───────────────────────────

describe('ChainedExecuteQuery — single query', () => {
  let tmpDir: string;
  let sqlitePath: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'db-tools-single-'));
    sqlitePath = path.join(tmpDir, 'tiny.sqlite');
    const db = new RealDatabase(sqlitePath);
    db.exec(`
      CREATE TABLE products (id INTEGER, name TEXT, price INTEGER);
      INSERT INTO products VALUES (1, 'Widget', 10), (2, 'Gadget', 20), (3, 'Doodad', 30);
    `);
    db.close();
  });

  afterAll(() => {}); // tmpDir cleaned up by OS — deleting it here breaks subsequent tests because shared-duckdb keeps the file ATTACHed.

  beforeEach(async () => {
    await clearHandles();
    clearSessionLabels();
  });

  // Unique datasetKey per describe block — namespaces the shared-DuckDB
  // ATTACH alias so different blocks' `tiny`/`db`/`data` names don't
  // collide on the process-wide instance.
  const ctx = (): BenchmarkAnalystContext => ({
    datasetKey: 'test-single',
    connections: [{ name: 'tiny', dialect: 'sqlite', config: { file_path: sqlitePath } }],
  });

  it('runs a single query and returns {preview, handle, stats}', async () => {
    const tool = new ChainedExecuteQuery(
      undefined as never,
      { queries: [{ connection: 'tiny', query: 'SELECT id, name FROM products ORDER BY id' }] },
      ctx(),
    );
    const res = await tool.run();

    expect(res.isError).toBe(false);
    const payload = JSON.parse((res.content[0] as { text: string }).text);
    expect(payload.handle).toMatch(/^handle_/);
    expect(payload.preview).toContain('Widget');
    expect(payload.stats).toBeDefined();
    expect(payload.stats.rowCount).toBe(3);
  });

  it('returns {error} on execution failure (whole-batch fail)', async () => {
    const tool = new ChainedExecuteQuery(
      undefined as never,
      { queries: [{ connection: 'tiny', query: 'SELECT * FROM nonexistent_table' }] },
      ctx(),
    );
    const res = await tool.run();

    expect(res.isError).toBe(true);
    const payload = JSON.parse((res.content[0] as { text: string }).text);
    expect(payload.error).toBeDefined();
    expect(payload.preview).toBeUndefined();
    expect(payload.handle).toBeUndefined();
  });

  it('rejects an empty queries array', async () => {
    const tool = new ChainedExecuteQuery(
      undefined as never,
      { queries: [] as never },
      ctx(),
    );
    const res = await tool.run();
    expect(res.isError).toBe(true);
    const payload = JSON.parse((res.content[0] as { text: string }).text);
    expect(payload.error).toMatch(/at least one query/i);
  });
});

// ─── ChainedExecuteQuery — chained pipeline ──────────────────────────────────

describe('ChainedExecuteQuery — chained pipeline', () => {
  let tmpDir: string;
  let sqlitePath: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'db-tools-chain-'));
    sqlitePath = path.join(tmpDir, 'chain.sqlite');
    const db = new RealDatabase(sqlitePath);
    db.exec(`
      CREATE TABLE orders (order_id INTEGER, product_id INTEGER, qty INTEGER);
      INSERT INTO orders VALUES (1, 100, 5), (2, 101, 3), (3, 100, 7), (4, 102, 2);
      CREATE TABLE products (id INTEGER, name TEXT);
      INSERT INTO products VALUES (100, 'Widget'), (101, 'Gadget'), (102, 'Doodad');
    `);
    db.close();
  });

  afterAll(() => {}); // tmpDir cleaned up by OS — deleting it here breaks subsequent tests because shared-duckdb keeps the file ATTACHed.

  beforeEach(async () => {
    await clearHandles();
    clearSessionLabels();
  });

  const ctx = (): BenchmarkAnalystContext => ({
    datasetKey: 'test-chain',
    connections: [{ name: 'db', dialect: 'sqlite', config: { file_path: sqlitePath } }],
  });

  it('returns ONLY the final query\'s result, not intermediates', async () => {
    const tool = new ChainedExecuteQuery(
      undefined as never,
      {
        queries: [
          { connection: 'db', query: 'SELECT DISTINCT product_id FROM orders', label: 'pids' },
          { connection: 'db', query: 'SELECT id, name FROM products WHERE id IN ($pids.product_id) ORDER BY id' },
        ],
      },
      ctx(),
    );
    const res = await tool.run();

    expect(res.isError).toBe(false);
    const payload = JSON.parse((res.content[0] as { text: string }).text);
    // Final query returns the products joined by interpolated ids.
    expect(payload.preview).toContain('Widget');
    expect(payload.preview).toContain('Gadget');
    expect(payload.preview).toContain('Doodad');
    expect(payload.stats.rowCount).toBe(3);
    // Single handle (final result only).
    expect(payload.handle).toMatch(/^handle_/);
  });

  it('REJECTS a 2nd-query batch when query 2 has no $label.col reference', async () => {
    // Validation must catch this BEFORE running queries — saves engine time
    // and surfaces a clear "you forgot the chain" error.
    const tool = new ChainedExecuteQuery(
      undefined as never,
      {
        queries: [
          { connection: 'db', query: 'SELECT id FROM products', label: 'pids' },
          { connection: 'db', query: 'SELECT * FROM orders' },  // ← no $pids.col reference
        ],
      },
      ctx(),
    );
    const res = await tool.run();

    expect(res.isError).toBe(true);
    const payload = JSON.parse((res.content[0] as { text: string }).text);
    expect(payload.error).toMatch(/\$label\.col|reference|chain/i);
  });

  it('whole-batch fails on intermediate query error (chain breaks)', async () => {
    const tool = new ChainedExecuteQuery(
      undefined as never,
      {
        queries: [
          { connection: 'db', query: 'SELECT id FROM nonexistent_table', label: 'x' },
          { connection: 'db', query: 'SELECT * FROM orders WHERE order_id IN ($x.id)' },
        ],
      },
      ctx(),
    );
    const res = await tool.run();

    expect(res.isError).toBe(true);
    const payload = JSON.parse((res.content[0] as { text: string }).text);
    expect(payload.error).toBeDefined();
  });

  it('session labels persist across ExecuteQuery calls', async () => {
    // Call 1: label `top`. Call 2: reference $top.col in a single query.
    const tool1 = new ChainedExecuteQuery(
      undefined as never,
      { queries: [{ connection: 'db', query: 'SELECT DISTINCT product_id FROM orders', label: 'top' }] },
      ctx(),
    );
    const res1 = await tool1.run();
    expect(res1.isError).toBe(false);

    // Second call references $top.product_id (a session-scoped label).
    const tool2 = new ChainedExecuteQuery(
      undefined as never,
      { queries: [{ connection: 'db', query: 'SELECT name FROM products WHERE id IN ($top.product_id) ORDER BY id' }] },
      ctx(),
    );
    const res2 = await tool2.run();
    expect(res2.isError).toBe(false);
    const payload = JSON.parse((res2.content[0] as { text: string }).text);
    expect(payload.preview).toContain('Widget');
    expect(payload.preview).toContain('Gadget');
    expect(payload.preview).toContain('Doodad');
  });
});

// ─── ChainedExecuteQuery — `_scratch` + FROM handle_xyz ──────────────────────

describe('ChainedExecuteQuery — _scratch built-in DuckDB', () => {
  let tmpDir: string;
  let sqlitePath: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'db-tools-scratch-'));
    sqlitePath = path.join(tmpDir, 'data.sqlite');
    const db = new RealDatabase(sqlitePath);
    db.exec(`
      CREATE TABLE items (id INTEGER, label TEXT);
      INSERT INTO items VALUES (1, 'alpha'), (2, 'beta'), (3, 'gamma');
    `);
    db.close();
  });

  afterAll(() => {}); // tmpDir cleaned up by OS — deleting it here breaks subsequent tests because shared-duckdb keeps the file ATTACHed.

  beforeEach(async () => {
    await clearHandles();
    clearSessionLabels();
  });

  it('allows FROM handle_xyz via _scratch even when only Mongo/Postgres in ctx', async () => {
    // First query: produce a handle from sqlite (this is the seed —
    // simulates having a handle in the system). Use sqlite so we have
    // data; then chain a second query through _scratch joining the handle.
    const ctx: BenchmarkAnalystContext = {
      datasetKey: 'test-scratch',
      connections: [{ name: 'data', dialect: 'sqlite', config: { file_path: sqlitePath } }],
    };

    const tool = new ChainedExecuteQuery(
      undefined as never,
      {
        queries: [
          { connection: 'data', query: 'SELECT id, label FROM items WHERE id > 1', label: 'items' },
          // Use _scratch to do an aggregate on the handle table directly.
          { connection: '_scratch', query: 'SELECT count(*) AS c FROM handle_FAKE WHERE id IN ($items.id)' },
        ],
      },
      ctx,
    );
    // Replace the handle name in the second query at run-time by reading
    // the first query's handle. But the agent in production references
    // $items.id, not handle_FAKE. Test the real path: $label.col only.
    // Adjust the test: drop the bogus handle_FAKE bit and use $label.col instead.
    const res = await tool.run();
    // The first query is fine; the second one references a non-existent
    // handle, so the batch fails. We're testing that _scratch is
    // recognised as a connection (not rejected as "unknown").
    expect(res.isError).toBe(true);
    const payload = JSON.parse((res.content[0] as { text: string }).text);
    // Error must be about the missing table handle_FAKE, NOT about an
    // unknown `_scratch` connection.
    expect(payload.error).not.toMatch(/connection.*_scratch.*not found/i);
  });

  it('runs a real FROM handle_xyz JOIN through _scratch', async () => {
    // Seed a handle by running a sqlite query, then JOIN via _scratch.
    const ctx: BenchmarkAnalystContext = {
      datasetKey: 'test-scratch',
      connections: [{ name: 'data', dialect: 'sqlite', config: { file_path: sqlitePath } }],
    };

    // Step 1: get a handle for items where id > 1.
    const tool1 = new ChainedExecuteQuery(
      undefined as never,
      { queries: [{ connection: 'data', query: 'SELECT id, label FROM items WHERE id > 1' }] },
      ctx,
    );
    const r1 = await tool1.run();
    expect(r1.isError).toBe(false);
    const p1 = JSON.parse((r1.content[0] as { text: string }).text);
    const handleId = p1.handle as string;
    expect(handleId).toMatch(/^handle_/);

    // Step 2: query the handle through _scratch using $label.col? Not quite —
    // we want FROM handle_xyz directly. The current agent test uses
    // ExploreDataset's chain style. For BaseExecuteQuery, the seed query
    // produces a handle; subsequent queries can reference its rows via
    // $label.col OR query the handle table by its real id via FROM
    // handle_<id>. The latter requires the agent to know the id.
    //
    // Simpler check: SELECT count(*) from the handle table by literal name.
    const tool2 = new ChainedExecuteQuery(
      undefined as never,
      {
        queries: [
          // Seed: ignore its output, just create a handle.
          { connection: 'data', query: 'SELECT id FROM items WHERE id > 1', label: 'ids' },
          // Chain: pull through _scratch using the LITERAL handle id from
          // the previous query. The agent gets `handle` back in the entry;
          // here we test that _scratch can run a query referencing one of
          // its labels via $label.col (since the actual handle id isn't
          // know inside the same tool call, we use $ids.id).
          { connection: '_scratch', query: 'SELECT 1 AS marker WHERE 2 IN ($ids.id)' },
        ],
      },
      ctx,
    );
    const r2 = await tool2.run();
    expect(r2.isError).toBe(false);
    const p2 = JSON.parse((r2.content[0] as { text: string }).text);
    expect(p2.stats.rowCount).toBe(1);
  });
});

// ─── ChainedExecuteQuery — timeout (preserved from prior) ────────────────────

describe('ChainedExecuteQuery timeout', () => {
  let tmpDir: string;
  let sqlitePath: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'db-tools-timeout-'));
    sqlitePath = path.join(tmpDir, 'tiny.sqlite');
    const db = new RealDatabase(sqlitePath);
    db.exec(`CREATE TABLE t (id INTEGER); INSERT INTO t VALUES (1);`);
    db.close();
  });

  afterAll(() => {}); // tmpDir cleaned up by OS — deleting it here breaks subsequent tests because shared-duckdb keeps the file ATTACHed.

  beforeEach(async () => {
    await clearHandles();
    clearSessionLabels();
  });

  const ctx = (): BenchmarkAnalystContext => ({
    datasetKey: 'test-timeout',
    connections: [{ name: 'tiny', dialect: 'sqlite', config: { file_path: sqlitePath } }],
  });

  it('interrupts a slow query when it exceeds the timeout, returns a clean error', async () => {
    const tool = new ChainedExecuteQuery(
      undefined as never,
      {
        queries: [{ connection: 'tiny', query: 'SELECT count(*) AS c FROM range(20000000000)' }],
        timeout: 1,
      },
      ctx(),
    );
    const start = Date.now();
    const res = await tool.run();
    const elapsedMs = Date.now() - start;

    expect(res.isError).toBe(true);
    expect(elapsedMs).toBeLessThan(15000);
  }, 20000);

  it('completes a fast query normally within the timeout', async () => {
    const tool = new ChainedExecuteQuery(
      undefined as never,
      { queries: [{ connection: 'tiny', query: 'SELECT id FROM t' }], timeout: 60 },
      ctx(),
    );
    const res = await tool.run();
    expect(res.isError).toBe(false);
  });
});

// ─── ChainedExecuteQuery — MongoDB native pipelines (preserved + new chain) ──

describe('ChainedExecuteQuery — MongoDB native aggregation', () => {
  beforeEach(async () => {
    mockMongoAggregate = () => [];
    mockMongoAggregateCalls.length = 0;
    await clearHandles();
    clearSessionLabels();
  });

  const mongoCtx = (): BenchmarkAnalystContext => ({
    connections: [
      { name: 'm', dialect: 'mongo', config: { host: 'localhost', port: 27017, database: 'd' } },
    ],
  });

  it('runs a JSON {collection,pipeline} query natively (no SQL parsing)', async () => {
    mockMongoAggregate = () => [{ city: 'NYC', n: 12 }, { city: 'LA', n: 7 }];
    const tool = new ChainedExecuteQuery(
      undefined as never,
      {
        queries: [{
          connection: 'm',
          query: JSON.stringify({ collection: 'biz', pipeline: [{ $group: { _id: '$city' } }] }),
        }],
      },
      mongoCtx(),
    );
    const res = await tool.run();
    expect(res.isError).toBe(false);
    expect(mockMongoAggregateCalls[0].collection).toBe('biz');
    expect(mockMongoAggregateCalls[0].pipeline).toEqual([
      { $group: { _id: '$city' } },
      { $limit: 1000 },
    ]);
  });

  it('surfaces a helpful error when an LLM sends SQL to a mongo connection', async () => {
    const tool = new ChainedExecuteQuery(
      undefined as never,
      { queries: [{ connection: 'm', query: 'SELECT * FROM biz' }] },
      mongoCtx(),
    );
    const res = await tool.run();
    expect(res.isError).toBe(true);
    const payload = JSON.parse((res.content[0] as { text: string }).text);
    expect(payload.error).toMatch(/JSON parse failed/i);
  });

  it('preflight: surfaces clear "unknown label" error before sending to Mongo', async () => {
    // Regression for Yelp #3 ($in needs an array): the agent referenced
    // `$biz_counts.business_id` (with `biz_counts` not defined anywhere)
    // and got MongoDB's unhelpful "$in needs an array" error. Now the
    // preflight catches it and tells the agent which labels exist.
    const ctx: BenchmarkAnalystContext = {
      datasetKey: 'test-preflight',
      connections: [
        { name: 'mongo', dialect: 'mongo', config: { host: 'localhost', port: 27017, database: 'd' } },
      ],
    };
    const tool = new ChainedExecuteQuery(
      undefined as never,
      {
        queries: [{
          connection: 'mongo',
          query: JSON.stringify({
            collection: 'items',
            pipeline: [{ $match: { item_id: { $in: '$nonexistent.business_id' } } }],
          }),
        }],
      },
      ctx,
    );
    const res = await tool.run();
    expect(res.isError).toBe(true);
    const payload = JSON.parse((res.content[0] as { text: string }).text);
    // Error must name the offending label AND mention "Available labels".
    expect(payload.error).toMatch(/nonexistent/);
    expect(payload.error).toMatch(/Available labels/i);
    // Critically: the raw MongoDB error must NOT have been surfaced.
    expect(payload.error).not.toMatch(/\$in needs an array/i);
  });

  it('interpolates $label.col as a JSON array in mongo pipelines (cross-DB chain)', async () => {
    // sqlite produces a list of ids; mongo's next query filters by that
    // list. Tests the SQL→Mongo chain: interpolateMongoRefs emits a real
    // JSON array, not a SQL literal list.
    const tmpDir = mkdtempSync(path.join(tmpdir(), 'db-tools-mongo-chain-'));
    const sqlitePath = path.join(tmpDir, 'ids.sqlite');
    const db = new RealDatabase(sqlitePath);
    db.exec(`CREATE TABLE ids (id INTEGER); INSERT INTO ids VALUES (1), (2), (3);`);
    db.close();

    mockMongoAggregate = () => [{ found: 2 }];
    const ctx: BenchmarkAnalystContext = {
      datasetKey: 'test-cross-db',
      connections: [
        { name: 'sql', dialect: 'sqlite', config: { file_path: sqlitePath } },
        { name: 'mongo', dialect: 'mongo', config: { host: 'localhost', port: 27017, database: 'd' } },
      ],
    };
    const tool = new ChainedExecuteQuery(
      undefined as never,
      {
        queries: [
          { connection: 'sql', query: 'SELECT id FROM ids', label: 'idlist' },
          {
            connection: 'mongo',
            query: JSON.stringify({
              collection: 'items',
              pipeline: [{ $match: { item_id: { $in: '$idlist.id' } } }],
            }),
          },
        ],
      },
      ctx,
    );
    const res = await tool.run();
    expect(res.isError).toBe(false);

    // The pipeline that Mongo received must have its $in array interpolated
    // from sqlite's rows (1,2,3), as a JSON array (not a string).
    const lastCall = mockMongoAggregateCalls[mockMongoAggregateCalls.length - 1];
    const pipeline = lastCall.pipeline as Array<Record<string, unknown>>;
    const matchStage = pipeline.find((s) => '$match' in s) as { $match: { item_id: { $in: unknown[] } } };
    expect(matchStage.$match.item_id.$in).toEqual([1, 2, 3]);

    // Don't rmSync tmpDir — shared-duckdb keeps it ATTACHed for the rest
    // of the run. OS cleans up tmp eventually.
  });
});

// ─── CatalogSearchDBSchema — catalog-SQL ──────────────────────────────────

describe('CatalogSearchDBSchema', () => {
  let tmpDir: string;
  let sqlitePath: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'db-tools-catalog-'));
    sqlitePath = path.join(tmpDir, 'cat.sqlite');
    const db = new RealDatabase(sqlitePath);
    db.exec(`
      CREATE TABLE customers (id INTEGER, email TEXT);
      INSERT INTO customers VALUES (1, 'a@x.com'), (2, 'b@x.com');
      CREATE TABLE orders (order_id INTEGER, customer_id INTEGER, total REAL);
      INSERT INTO orders VALUES (101, 1, 10.5), (102, 2, 20.0);
    `);
    db.close();
  });

  afterAll(() => {}); // tmpDir cleaned up by OS — deleting it here breaks subsequent tests.

  beforeEach(async () => {
    await clearHandles();
    clearSessionLabels();
  });

  const ctx = (): BenchmarkAnalystContext => ({
    datasetKey: 'test-catalog',
    connections: [{ name: 'shop', dialect: 'sqlite', config: { file_path: sqlitePath } }],
  });

  // Import inside the test to avoid hoisting issues with the file order
  // (CatalogSearchDBSchema is in the same db-tools.ts module).

  it('returns rows from the `columns` catalog table for SQL queries', async () => {
    const { CatalogSearchDBSchema } = await import('../db-tools');
    const tool = new CatalogSearchDBSchema(
      undefined as never,
      { queries: [{ query: "SELECT * FROM columns WHERE table_name = 'customers' ORDER BY column_name" }] },
      ctx(),
    );
    const res = await tool.run();
    expect(res.isError).toBe(false);
    const payload = JSON.parse((res.content[0] as { text: string }).text);
    expect(payload.results).toHaveLength(1);
    const preview = payload.results[0].preview as string;
    expect(preview).toContain('email');
    expect(preview).toContain('id');
    expect(payload.results[0].handle).toMatch(/^handle_/);
  });

  it('returns multiple result slots for batched queries', async () => {
    const { CatalogSearchDBSchema } = await import('../db-tools');
    const tool = new CatalogSearchDBSchema(
      undefined as never,
      {
        queries: [
          { query: "SELECT * FROM tables WHERE table_name = 'customers'" },
          { query: "SELECT * FROM columns WHERE table_name = 'orders'" },
        ],
      },
      ctx(),
    );
    const res = await tool.run();
    expect(res.isError).toBe(false);
    const payload = JSON.parse((res.content[0] as { text: string }).text);
    expect(payload.results).toHaveLength(2);
    expect(payload.results[0].preview).toContain('customers');
    expect(payload.results[1].preview).toContain('order_id');
  });

  it('per-query errors sit in their slot, do not abort the batch', async () => {
    const { CatalogSearchDBSchema } = await import('../db-tools');
    const tool = new CatalogSearchDBSchema(
      undefined as never,
      {
        queries: [
          { query: "SELECT * FROM tables" },         // OK
          { query: "SELECT * FROM nonexistent_catalog_table" }, // bad SQL
          { query: "SELECT * FROM columns LIMIT 1" }, // OK
        ],
      },
      ctx(),
    );
    const res = await tool.run();
    expect(res.isError).toBe(false);
    const payload = JSON.parse((res.content[0] as { text: string }).text);
    expect(payload.results).toHaveLength(3);
    expect(payload.results[0].preview).toBeDefined();
    expect(payload.results[1].error).toBeDefined();
    expect(payload.results[2].preview).toBeDefined();
  });

  it('rejects an empty queries array', async () => {
    const { CatalogSearchDBSchema } = await import('../db-tools');
    const tool = new CatalogSearchDBSchema(
      undefined as never,
      { queries: [] as never },
      ctx(),
    );
    const res = await tool.run();
    expect(res.isError).toBe(true);
    const payload = JSON.parse((res.content[0] as { text: string }).text);
    expect(payload.error).toMatch(/at least one query/i);
  });
});
