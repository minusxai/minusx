// DuckDbConnector exercises real @duckdb/node-api against a real temp
// .duckdb file — same rationale as sqlite-connector.test.ts (the broader
// connections.test.ts mocks @duckdb/node-api globally).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DuckDBInstance } from '@duckdb/node-api';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { DuckDbConnector } from '../duckdb-connector';

let duckTmpDir: string;
let duckDbPath: string;

beforeAll(async () => {
  duckTmpDir = mkdtempSync(path.join(tmpdir(), 'duckdb-test-'));
  duckDbPath = path.join(duckTmpDir, 'test.duckdb');
  const inst = await DuckDBInstance.create(duckDbPath);
  const conn = await inst.connect();
  await conn.run(`CREATE TABLE users (id INTEGER, name VARCHAR, email VARCHAR)`);
  await conn.run(`CREATE TABLE orders (order_id INTEGER, status VARCHAR, amount DOUBLE)`);
  await conn.run(`CREATE INDEX idx_users_email ON users(email)`);
  await conn.run(`CREATE INDEX idx_orders_status_amount ON orders(status, amount)`);
  conn.closeSync();
});

afterAll(() => {
  rmSync(duckTmpDir, { recursive: true, force: true });
});

describe('DuckDbConnector.getSchema()', () => {
  it('returns SchemaEntry[] with tables and columns', async () => {
    const schema = await new DuckDbConnector('test', { file_path: duckDbPath }).getSchema();
    const main = schema.find(s => s.schema === 'main')!;
    expect(main).toBeDefined();
    const tableNames = main.tables.map(t => t.table).sort();
    expect(tableNames).toEqual(['orders', 'users']);
  });

  it('populates tables[].indexes from duckdb_indexes()', async () => {
    const schema = await new DuckDbConnector('test', { file_path: duckDbPath }).getSchema();
    const main = schema.find(s => s.schema === 'main')!;

    const users = main.tables.find(t => t.table === 'users')!;
    expect(users.indexes).toEqual([
      { name: 'idx_users_email', columns: ['email'], unique: false },
    ]);

    const orders = main.tables.find(t => t.table === 'orders')!;
    expect(orders.indexes).toEqual([
      { name: 'idx_orders_status_amount', columns: ['status', 'amount'], unique: false },
    ]);
  });
});
