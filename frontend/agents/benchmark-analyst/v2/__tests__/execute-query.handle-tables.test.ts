// Real integration test for `FROM handle_xyz` — handles as queryable tables.
//
// Unlike execute-query.test.ts (which mocks the connector), this test uses a
// REAL sqlite fixture + the REAL shared-DuckDB connector path, so it actually
// verifies that a stored handle resolves as a table and joins against live
// connection data. With the connector mocked you can never prove this — the
// mock returns canned rows regardless of SQL.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import RealDatabase from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import type { TextContent } from '@mariozechner/pi-ai';
import { ExecuteQueryV2 } from '../execute-query';
import { storeHandle, fetchHandle, clearHandles } from '../handle-store';
import type { QueryResult } from '@/lib/connections/base';
import type { BenchmarkAnalystContext } from '../../types';

describe('ExecuteQueryV2 — FROM handle_xyz (real handle tables)', () => {
  let tmpDir: string;
  let sqlitePath: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'v2-handle-tables-'));
    sqlitePath = path.join(tmpDir, 'products.sqlite');
    const db = new RealDatabase(sqlitePath);
    db.exec(`
      CREATE TABLE products (id INTEGER, name TEXT);
      INSERT INTO products VALUES (1, 'Alpha'), (2, 'Beta'), (3, 'Gamma'), (4, 'Delta');
    `);
    db.close();
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await clearHandles();
  });

  const ctx = (): BenchmarkAnalystContext => ({
    connections: [
      { name: 'products_db', dialect: 'sqlite', description: 'products', config: { file_path: sqlitePath } },
    ],
  });

  it('joins a live connection table against a stored handle', async () => {
    // A handle holding the ids 2 and 4 — as if produced by an earlier query.
    const idHandleResult: QueryResult = {
      columns: ['id'],
      types: ['BIGINT'],
      rows: [{ id: 2 }, { id: 4 }],
      finalQuery: '',
    };
    const idHandle = storeHandle(idHandleResult);

    const tool = new ExecuteQueryV2(
      undefined as never,
      {
        queries: [
          {
            connection: 'products_db',
            query: `SELECT p.id, p.name FROM products p JOIN ${idHandle} h ON p.id = h.id ORDER BY p.id`,
          },
        ],
      },
      ctx(),
      'test-handle-join',
    );

    const response = await tool.run();
    const content = JSON.parse((response.content[0] as TextContent).text);

    expect(content.results[0].error).toBeUndefined();
    // The returned handle's rows must reflect a REAL join: only products
    // whose id is in the handle (2 = Beta, 4 = Delta).
    const stored = fetchHandle(content.results[0].handle);
    expect(stored?.rows).toEqual([
      { id: 2, name: 'Beta' },
      { id: 4, name: 'Delta' },
    ]);
  });

  it('runs a pure-handle query (no live table) against a stored handle', async () => {
    const handleResult: QueryResult = {
      columns: ['id', 'amount'],
      types: ['BIGINT', 'DOUBLE'],
      rows: [{ id: 1, amount: 10 }, { id: 2, amount: 30 }, { id: 3, amount: 20 }],
      finalQuery: '',
    };
    const h = storeHandle(handleResult);

    const tool = new ExecuteQueryV2(
      undefined as never,
      {
        queries: [
          { connection: 'products_db', query: `SELECT id FROM ${h} WHERE amount > 15 ORDER BY id` },
        ],
      },
      ctx(),
      'test-pure-handle',
    );

    const response = await tool.run();
    const content = JSON.parse((response.content[0] as TextContent).text);

    expect(content.results[0].error).toBeUndefined();
    const stored = fetchHandle(content.results[0].handle);
    expect(stored?.rows).toEqual([{ id: 2 }, { id: 3 }]);
  });

  it('honors the timeout param — a slow query is cancelled, returned as per-query error', async () => {
    // `range(20_000_000_000)` would be a multi-second scan in DuckDB; a 1s
    // timeout must interrupt it well before completion and surface a clean
    // per-query error.
    const tool = new ExecuteQueryV2(
      undefined as never,
      {
        queries: [{ connection: 'products_db', query: 'SELECT count(*) AS c FROM range(20000000000)' }],
        timeout: 1,
      },
      ctx(),
      'test-timeout',
    );
    const start = Date.now();
    const response = await tool.run();
    const elapsedMs = Date.now() - start;

    const content = JSON.parse((response.content[0] as TextContent).text);
    expect(content.results[0].error).toBeDefined();
    // Must not hang anywhere near the time the full scan would take.
    expect(elapsedMs).toBeLessThan(15000);
  }, 20000);

  it('errors clearly when a handle is referenced on a non-SQL connection', async () => {
    const h = storeHandle({
      columns: ['id'], types: ['BIGINT'], rows: [{ id: 1 }], finalQuery: '',
    });

    const tool = new ExecuteQueryV2(
      undefined as never,
      {
        queries: [
          { connection: 'mongo_db', query: `SELECT * FROM ${h}` },
        ],
      },
      {
        connections: [
          { name: 'mongo_db', dialect: 'mongo', description: 'm', config: { host: 'localhost', port: 27017, database: 'd' } },
        ],
      },
      'test-handle-mongo',
    );

    const response = await tool.run();
    const content = JSON.parse((response.content[0] as TextContent).text);
    expect(content.results[0].error).toMatch(/handle table/i);
  });
});
