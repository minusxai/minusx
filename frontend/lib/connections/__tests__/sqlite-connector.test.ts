// SqliteConnector goes through DuckDB's sqlite_scanner. These tests
// exercise real @duckdb/node-api against a real temp SQLite file, so
// they live in their own file (the broader connections.test.ts mocks
// @duckdb/node-api globally for the Athena/BigQuery/Postgres tests).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import RealDatabase from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { SqliteConnector } from '../sqlite-connector';

let sqliteTmpDir: string;
let sqliteDbPath: string;

beforeAll(() => {
  sqliteTmpDir = mkdtempSync(path.join(tmpdir(), 'sqlite-test-'));
  sqliteDbPath = path.join(sqliteTmpDir, 'test.sqlite');
  const db = new RealDatabase(sqliteDbPath);
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT);
    INSERT INTO users VALUES (1, 'Alice', 'alice@example.com');
    INSERT INTO users VALUES (2, 'Bob', 'bob@example.com');
    CREATE TABLE orders (order_id INTEGER PRIMARY KEY, amount REAL, status TEXT);
    INSERT INTO orders VALUES (1, 99.5, 'active');
    INSERT INTO orders VALUES (2, 50.0, 'inactive');
    CREATE INDEX idx_users_email ON users(email);
    CREATE INDEX idx_orders_status_amount ON orders(status, amount);
  `);
  db.close();
});

afterAll(() => {
  rmSync(sqliteTmpDir, { recursive: true, force: true });
});

describe('SqliteConnector.testConnection()', () => {
  it('returns success=false when file does not exist', async () => {
    const result = await new SqliteConnector('test', { file_path: '/nonexistent/test.sqlite' }).testConnection();
    expect(result.success).toBe(false);
    expect(result.message).toContain('File not found');
  });

  it('returns success=true for a valid SQLite file', async () => {
    const result = await new SqliteConnector('test', { file_path: sqliteDbPath }).testConnection();
    expect(result.success).toBe(true);
    expect(result.message).toBe('Connection successful');
  });

  it('includes schema when includeSchema=true', async () => {
    const result = await new SqliteConnector('test', { file_path: sqliteDbPath }).testConnection(true);
    expect(result.success).toBe(true);
    expect(result.schema?.schemas).toHaveLength(1);
    expect(result.schema?.schemas[0].schema).toBe('main');
    expect(result.schema?.schemas[0].tables.length).toBeGreaterThanOrEqual(2);
  });
});

describe('SqliteConnector.query()', () => {
  it('returns columns, types, and rows', async () => {
    const result = await new SqliteConnector('test', { file_path: sqliteDbPath }).query('SELECT id, name FROM users ORDER BY id');
    expect(result.columns).toEqual(['id', 'name']);
    // DuckDB sqlite_scanner returns DuckDB-flavoured types:
    // SQLite INTEGER → BIGINT, TEXT → VARCHAR.
    expect(result.types).toEqual(['BIGINT', 'VARCHAR']);
    expect(result.rows).toEqual([
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ]);
  });

  it('substitutes :paramName → positional params', async () => {
    const result = await new SqliteConnector('test', { file_path: sqliteDbPath }).query(
      'SELECT name FROM users WHERE id = :id',
      { id: 2 },
    );
    expect(result.rows).toEqual([{ name: 'Bob' }]);
  });

  it('substitutes null for params absent from the params map', async () => {
    const result = await new SqliteConnector('test', { file_path: sqliteDbPath }).query(
      'SELECT * FROM users WHERE name = :missing',
    );
    expect(result.rows).toEqual([]);
  });

  it('interrupts a slow query past the timeout and rejects with a timeout error', async () => {
    const connector = new SqliteConnector('test', { file_path: sqliteDbPath });
    const start = Date.now();
    await expect(
      connector.query('SELECT count(*) AS c FROM range(20000000000)', undefined, 1000),
    ).rejects.toThrow(/timeout/i);
    expect(Date.now() - start).toBeLessThan(15000);
  }, 20000);

  it('completes a fast query normally when within the timeout', async () => {
    const result = await new SqliteConnector('test', { file_path: sqliteDbPath }).query(
      'SELECT id FROM users ORDER BY id', undefined, 60000,
    );
    expect(result.rows).toEqual([{ id: 1 }, { id: 2 }]);
  });
});

describe('SqliteConnector.getSchema()', () => {
  it('returns SchemaEntry[] with schema "main"', async () => {
    const schema = await new SqliteConnector('test', { file_path: sqliteDbPath }).getSchema();

    expect(schema).toHaveLength(1);
    expect(schema[0].schema).toBe('main');

    const tableNames = schema[0].tables.map(t => t.table).sort();
    expect(tableNames).toContain('users');
    expect(tableNames).toContain('orders');

    const usersTable = schema[0].tables.find(t => t.table === 'users')!;
    expect(usersTable.columns.map(c => c.name)).toEqual(['id', 'name', 'email']);
  });

  it('populates tables[].indexes from the attached SQLite db', async () => {
    const schema = await new SqliteConnector('test', { file_path: sqliteDbPath }).getSchema();

    const usersTable = schema[0].tables.find(t => t.table === 'users')!;
    expect(usersTable.indexes).toEqual([
      { name: 'idx_users_email', columns: ['email'], unique: false },
    ]);

    const ordersTable = schema[0].tables.find(t => t.table === 'orders')!;
    expect(ordersTable.indexes).toEqual([
      { name: 'idx_orders_status_amount', columns: ['status', 'amount'], unique: false },
    ]);
  });
});
