jest.mock('pg', () => ({
  Pool: jest.fn(),
}));

import { Pool } from 'pg';
import { PostgresConnector } from '../postgres-connector';
import { getNodeConnector } from '../index';

const MockPool = Pool as jest.MockedClass<typeof Pool>;

const BASE_CONFIG = {
  host: 'localhost',
  port: 5432,
  database: 'testdb',
  username: 'testuser',
  password: 'testpass',
};

function makeMockPool(queryImpl: jest.Mock) {
  MockPool.mockImplementation(() => ({ query: queryImpl, end: jest.fn() } as any));
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── testConnection() ────────────────────────────────────────────────────────

describe('PostgresConnector.testConnection()', () => {
  it('returns success=true when SELECT 1 succeeds', async () => {
    const mockQuery = jest.fn().mockResolvedValue({ rows: [], fields: [] });
    makeMockPool(mockQuery);

    const result = await new PostgresConnector('test', BASE_CONFIG).testConnection();

    expect(result.success).toBe(true);
    expect(result.message).toBe('Connection successful');
    expect(mockQuery).toHaveBeenCalledWith('SELECT 1', []);
  });

  it('returns success=false with the error message on failure', async () => {
    const mockQuery = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    makeMockPool(mockQuery);

    const result = await new PostgresConnector('test', BASE_CONFIG).testConnection();

    expect(result.success).toBe(false);
    expect(result.message).toBe('ECONNREFUSED');
  });

  it('includes schema when includeSchema=true', async () => {
    const mockQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [], fields: [] }) // SELECT 1
      .mockResolvedValueOnce({                          // information_schema query
        rows: [
          { table_schema: 'public', table_name: 'users', column_name: 'id', data_type: 'integer' },
        ],
        fields: [],
      });
    makeMockPool(mockQuery);

    const result = await new PostgresConnector('test', BASE_CONFIG).testConnection(true);

    expect(result.success).toBe(true);
    expect(result.schema?.schemas).toHaveLength(1);
    expect(result.schema?.schemas[0].schema).toBe('public');
  });
});

// ─── query() ─────────────────────────────────────────────────────────────────

describe('PostgresConnector.query()', () => {
  it('returns columns, types, and rows from query result', async () => {
    const mockQuery = jest.fn().mockResolvedValue({
      rows: [{ id: 1, name: 'Alice' }],
      fields: [
        { name: 'id', dataTypeID: 23 },   // integer
        { name: 'name', dataTypeID: 25 },  // text
      ],
    });
    makeMockPool(mockQuery);

    const result = await new PostgresConnector('test', BASE_CONFIG).query('SELECT id, name FROM users');

    expect(result.columns).toEqual(['id', 'name']);
    expect(result.types).toEqual(['integer', 'text']);
    expect(result.rows).toEqual([{ id: 1, name: 'Alice' }]);
  });

  it('substitutes :name params as $N positional params in order of appearance', async () => {
    const mockQuery = jest.fn().mockResolvedValue({ rows: [], fields: [] });
    makeMockPool(mockQuery);

    await new PostgresConnector('test', BASE_CONFIG).query(
      'SELECT * FROM users WHERE id = :id AND role = :role',
      { id: 42, role: 'admin' }
    );

    expect(mockQuery).toHaveBeenCalledWith(
      'SELECT * FROM users WHERE id = $1 AND role = $2',
      [42, 'admin']
    );
  });

  it('reuses the same $N index for repeated param names', async () => {
    const mockQuery = jest.fn().mockResolvedValue({ rows: [], fields: [] });
    makeMockPool(mockQuery);

    await new PostgresConnector('test', BASE_CONFIG).query(
      'SELECT :val + :val AS doubled',
      { val: 5 }
    );

    expect(mockQuery).toHaveBeenCalledWith('SELECT $1 + $1 AS doubled', [5]);
  });

  it('substitutes null for params absent from the params map', async () => {
    const mockQuery = jest.fn().mockResolvedValue({ rows: [], fields: [] });
    makeMockPool(mockQuery);

    await new PostgresConnector('test', BASE_CONFIG).query(
      'SELECT * FROM t WHERE x = :missing'
    );

    expect(mockQuery).toHaveBeenCalledWith('SELECT * FROM t WHERE x = $1', [null]);
  });

  it('maps unknown OIDs to "text"', async () => {
    const mockQuery = jest.fn().mockResolvedValue({
      rows: [],
      fields: [{ name: 'col', dataTypeID: 99999 }],
    });
    makeMockPool(mockQuery);

    const result = await new PostgresConnector('test', BASE_CONFIG).query('SELECT col');

    expect(result.types).toEqual(['text']);
  });

  it('maps common OIDs to human-readable type names', async () => {
    const cases: Array<[number, string]> = [
      [16, 'boolean'],
      [20, 'bigint'],
      [21, 'smallint'],
      [23, 'integer'],
      [700, 'real'],
      [701, 'double precision'],
      [1043, 'character varying'],
      [1082, 'date'],
      [1114, 'timestamp without time zone'],
      [1184, 'timestamp with time zone'],
      [1700, 'numeric'],
      [2950, 'uuid'],
      [3802, 'jsonb'],
    ];
    for (const [oid, expectedType] of cases) {
      const mockQuery = jest.fn().mockResolvedValue({
        rows: [],
        fields: [{ name: 'col', dataTypeID: oid }],
      });
      makeMockPool(mockQuery);
      const result = await new PostgresConnector('test', BASE_CONFIG).query('SELECT col');
      expect(result.types[0]).toBe(expectedType);
      jest.clearAllMocks();
    }
  });
});

// ─── getSchema() ─────────────────────────────────────────────────────────────

describe('PostgresConnector.getSchema()', () => {
  it('returns SchemaEntry[] grouped by schema then table', async () => {
    const mockQuery = jest.fn().mockResolvedValue({
      rows: [
        { table_schema: 'public', table_name: 'users', column_name: 'id', data_type: 'integer' },
        { table_schema: 'public', table_name: 'users', column_name: 'email', data_type: 'text' },
        { table_schema: 'analytics', table_name: 'events', column_name: 'ts', data_type: 'timestamp without time zone' },
      ],
      fields: [],
    });
    makeMockPool(mockQuery);

    const schema = await new PostgresConnector('test', BASE_CONFIG).getSchema();

    expect(schema).toHaveLength(2);
    const pub = schema.find(s => s.schema === 'public')!;
    expect(pub.tables).toHaveLength(1);
    expect(pub.tables[0].table).toBe('users');
    expect(pub.tables[0].columns).toEqual([
      { name: 'id', type: 'integer' },
      { name: 'email', type: 'text' },
    ]);
    const analytics = schema.find(s => s.schema === 'analytics')!;
    expect(analytics.tables[0].columns[0].name).toBe('ts');
  });

  it('queries information_schema.columns excluding pg_catalog and information_schema', async () => {
    const mockQuery = jest.fn().mockResolvedValue({ rows: [], fields: [] });
    makeMockPool(mockQuery);

    await new PostgresConnector('test', BASE_CONFIG).getSchema();

    const sql: string = mockQuery.mock.calls[0][0];
    expect(sql).toContain('information_schema.columns');
    expect(sql).toMatch(/NOT IN[\s\S]*'pg_catalog'[\s\S]*'information_schema'/);
  });

  it('returns empty array when no user tables exist', async () => {
    const mockQuery = jest.fn().mockResolvedValue({ rows: [], fields: [] });
    makeMockPool(mockQuery);

    const schema = await new PostgresConnector('test', BASE_CONFIG).getSchema();

    expect(schema).toEqual([]);
  });
});

// ─── Pool construction & reuse ────────────────────────────────────────────────

describe('PostgresConnector pool lifecycle', () => {
  it('constructs Pool with correct pg options mapping username → user', async () => {
    const mockQuery = jest.fn().mockResolvedValue({ rows: [], fields: [] });
    makeMockPool(mockQuery);

    await new PostgresConnector('myconn', {
      host: 'db.example.com',
      port: 5433,
      database: 'mydb',
      username: 'admin',
      password: 'secret',
    }).testConnection();

    expect(MockPool).toHaveBeenCalledWith({
      host: 'db.example.com',
      port: 5433,
      database: 'mydb',
      user: 'admin',
      password: 'secret',
      ssl: undefined,
    });
  });

  it('reuses the same Pool instance across multiple calls', async () => {
    const mockQuery = jest.fn().mockResolvedValue({ rows: [], fields: [] });
    makeMockPool(mockQuery);

    const connector = new PostgresConnector('test', BASE_CONFIG);
    await connector.query('SELECT 1');
    await connector.query('SELECT 2');

    expect(MockPool).toHaveBeenCalledTimes(1);
  });

  it('defaults port to 5432 and host to localhost when omitted', async () => {
    const mockQuery = jest.fn().mockResolvedValue({ rows: [], fields: [] });
    makeMockPool(mockQuery);

    await new PostgresConnector('test', {
      database: 'mydb',
      username: 'user',
    }).testConnection();

    expect(MockPool).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'localhost', port: 5432 })
    );
  });
});

// ─── getNodeConnector() factory ───────────────────────────────────────────────

describe('getNodeConnector() factory', () => {
  it('returns a PostgresConnector for type "postgresql"', () => {
    const connector = getNodeConnector('mydb', 'postgresql', BASE_CONFIG);
    expect(connector).toBeInstanceOf(PostgresConnector);
  });

  it('still returns DuckDbConnector for type "duckdb"', () => {
    const { DuckDbConnector } = require('../duckdb-connector');
    const connector = getNodeConnector('mydb', 'duckdb', { file_path: 'test.duckdb' });
    expect(connector).toBeInstanceOf(DuckDbConnector);
  });

  it('returns null for unknown types', () => {
    expect(getNodeConnector('x', 'mysql', {})).toBeNull();
    expect(getNodeConnector('x', 'redshift', {})).toBeNull();
  });
});
