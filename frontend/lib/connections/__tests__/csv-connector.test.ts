/**
 * Unit tests for CsvConnector
 *
 * getSchema() reads directly from config — no DuckDB needed.
 * query() is tested by mocking the DuckDB instance creation.
 */

// Mock @duckdb/node-api before any imports to prevent native module loading
jest.mock('@duckdb/node-api', () => ({
  DuckDBInstance: {
    create: jest.fn(),
  },
  DuckDBConnection: jest.fn(),
}));

// Mock lib/config to avoid server-only env var reads
jest.mock('@/lib/config', () => ({
  OBJECT_STORE_BUCKET: 'test-bucket',
  OBJECT_STORE_REGION: 'us-east-1',
  OBJECT_STORE_ACCESS_KEY_ID: 'test-key',
  OBJECT_STORE_SECRET_ACCESS_KEY: 'test-secret',
  OBJECT_STORE_ENDPOINT: undefined,
}));

import { CsvConnector } from '../csv-connector';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FILE_A = {
  table_name: 'orders',
  schema_name: 'sales',
  s3_key: '1/csvs/org/myconn/orders.csv',
  file_format: 'csv' as const,
  row_count: 10,
  columns: [
    { name: 'id', type: 'INTEGER' },
    { name: 'amount', type: 'DOUBLE' },
  ],
};

const FILE_B = {
  table_name: 'products',
  schema_name: 'inventory',
  s3_key: '1/csvs/org/myconn/products.csv',
  file_format: 'csv' as const,
  row_count: 5,
  columns: [
    { name: 'sku', type: 'VARCHAR' },
    { name: 'price', type: 'DOUBLE' },
  ],
};

// ---------------------------------------------------------------------------
// getSchema() — pure unit test (no DuckDB)
// ---------------------------------------------------------------------------

describe('CsvConnector.getSchema()', () => {
  it('returns correct schema structure from config', async () => {
    const connector = new CsvConnector('test', { files: [FILE_A, FILE_B] });
    const schema = await connector.getSchema();

    expect(schema).toHaveLength(2);

    const salesSchema = schema.find((s) => s.schema === 'sales');
    expect(salesSchema).toBeDefined();
    expect(salesSchema!.tables).toHaveLength(1);
    expect(salesSchema!.tables[0].table).toBe('orders');
    expect(salesSchema!.tables[0].columns).toEqual(FILE_A.columns);

    const inventorySchema = schema.find((s) => s.schema === 'inventory');
    expect(inventorySchema).toBeDefined();
    expect(inventorySchema!.tables).toHaveLength(1);
    expect(inventorySchema!.tables[0].table).toBe('products');
    expect(inventorySchema!.tables[0].columns).toEqual(FILE_B.columns);
  });

  it('returns empty array when no files configured', async () => {
    const connector = new CsvConnector('test', { files: [] });
    const schema = await connector.getSchema();
    expect(schema).toEqual([]);
  });

  it('groups multiple tables in same schema correctly', async () => {
    const file1 = { ...FILE_A, table_name: 'orders', schema_name: 'public' };
    const file2 = { ...FILE_B, table_name: 'products', schema_name: 'public' };
    const connector = new CsvConnector('test', { files: [file1, file2] });
    const schema = await connector.getSchema();

    expect(schema).toHaveLength(1);
    expect(schema[0].schema).toBe('public');
    expect(schema[0].tables).toHaveLength(2);
    const tableNames = schema[0].tables.map((t) => t.table);
    expect(tableNames).toContain('orders');
    expect(tableNames).toContain('products');
  });
});

// ---------------------------------------------------------------------------
// query() — mock the DuckDB instance
// ---------------------------------------------------------------------------

describe('CsvConnector.query()', () => {
  it('executes SQL against DuckDB views via mocked instance', async () => {
    // Build a mock DuckDB connection that returns a simple result set
    const mockRunResult = {
      columnCount: 2,
      columnName: (i: number) => ['id', 'amount'][i],
      columnType: (i: number) => ({ toString: () => ['INTEGER', 'DOUBLE'][i] }),
      getRowObjectsJS: async () => [{ id: 1, amount: 99.5 }],
    };

    const mockConn = {
      run: jest.fn().mockResolvedValue(mockRunResult),
      closeSync: jest.fn(),
    };

    const mockInstance = {
      connect: jest.fn().mockResolvedValue(mockConn),
    };

    // Patch DuckDBInstance.create to return our mock instance
    const { DuckDBInstance } = jest.requireMock('@duckdb/node-api');
    (DuckDBInstance.create as jest.Mock).mockResolvedValue(mockInstance);

    // Use a unique config so it misses the cache
    const uniqueFile = {
      ...FILE_A,
      s3_key: `query-test/${Date.now()}/orders.csv`,
    };
    const connector = new CsvConnector('query-test', { files: [uniqueFile] });

    const result = await connector.query('SELECT * FROM sales.orders');

    expect(result.columns).toEqual(['id', 'amount']);
    expect(result.rows).toEqual([{ id: 1, amount: 99.5 }]);
  });
});
