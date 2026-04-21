jest.mock('@aws-sdk/client-athena', () => ({
  AthenaClient: jest.fn(),
  StartQueryExecutionCommand: jest.fn(args => ({ input: args })),
  GetQueryExecutionCommand: jest.fn(args => ({ input: args })),
  GetQueryResultsCommand: jest.fn(args => ({ input: args })),
}));

jest.mock('@aws-sdk/client-glue', () => ({
  GlueClient: jest.fn(),
  GetDatabasesCommand: jest.fn(args => ({ input: args })),
  GetTablesCommand: jest.fn(args => ({ input: args })),
}));

jest.mock('@google-cloud/bigquery', () => {
  const MockBigQuery = jest.fn();
  return { BigQuery: MockBigQuery };
});

jest.mock('pg', () => ({
  Pool: jest.fn(),
}));

jest.mock('@duckdb/node-api', () => ({
  DuckDBInstance: {
    create: jest.fn(),
  },
  DuckDBConnection: jest.fn(),
}));

jest.mock('@/lib/config', () => ({
  OBJECT_STORE_BUCKET: 'test-bucket',
  OBJECT_STORE_REGION: 'us-east-1',
  OBJECT_STORE_ACCESS_KEY_ID: 'test-key',
  OBJECT_STORE_SECRET_ACCESS_KEY: 'test-secret',
  OBJECT_STORE_ENDPOINT: undefined,
  BASE_DUCKDB_DATA_PATH: '/tmp',
}));

import { AthenaClient } from '@aws-sdk/client-athena';
import { GlueClient } from '@aws-sdk/client-glue';
import { AthenaConnector } from '../athena-connector';
import { BigQuery } from '@google-cloud/bigquery';
import { BigQueryConnector } from '../bigquery-connector';
import { Pool } from 'pg';
import { PostgresConnector } from '../postgres-connector';
import { CsvConnector } from '../csv-connector';
import { getNodeConnector } from '../index';

const MockAthenaClient = AthenaClient as jest.MockedClass<typeof AthenaClient>;
const MockGlueClient = GlueClient as jest.MockedClass<typeof GlueClient>;
const MockBigQuery = BigQuery as jest.MockedClass<typeof BigQuery>;
const MockPool = Pool as jest.MockedClass<typeof Pool>;

beforeEach(() => {
  jest.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// athena-connector.test.ts
// ─────────────────────────────────────────────────────────────────────────────

const ATHENA_BASE_CONFIG = {
  region_name: 'us-east-1',
  s3_staging_dir: 's3://my-bucket/results/',
  schema_name: 'default',
  work_group: 'primary',
  aws_access_key_id: 'AKIAIOSFODNN7EXAMPLE',
  aws_secret_access_key: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
};

function makeAthenaSend(impl: jest.Mock) {
  MockAthenaClient.mockImplementation(() => ({ send: impl }) as any);
}

function makeGlueSend(impl: jest.Mock) {
  MockGlueClient.mockImplementation(() => ({ send: impl }) as any);
}

describe('AthenaConnector.testConnection()', () => {
  it('returns success=true when query completes SUCCEEDED', async () => {
    const send = jest.fn()
      .mockResolvedValueOnce({ QueryExecutionId: 'qid-1' })
      .mockResolvedValueOnce({
        QueryExecution: { Status: { State: 'SUCCEEDED' } },
      });
    makeAthenaSend(send);
    makeGlueSend(jest.fn());

    const result = await new AthenaConnector('test', ATHENA_BASE_CONFIG).testConnection();

    expect(result.success).toBe(true);
    expect(result.message).toBe('Connection successful');
  });

  it('returns success=false when query completes FAILED', async () => {
    const send = jest.fn()
      .mockResolvedValueOnce({ QueryExecutionId: 'qid-2' })
      .mockResolvedValueOnce({
        QueryExecution: { Status: { State: 'FAILED', StateChangeReason: 'Syntax error' } },
      });
    makeAthenaSend(send);
    makeGlueSend(jest.fn());

    const result = await new AthenaConnector('test', ATHENA_BASE_CONFIG).testConnection();

    expect(result.success).toBe(false);
    expect(result.message).toContain('Syntax error');
  });

  it('returns success=false on send() exception', async () => {
    const send = jest.fn().mockRejectedValue(new Error('Network error'));
    makeAthenaSend(send);
    makeGlueSend(jest.fn());

    const result = await new AthenaConnector('test', ATHENA_BASE_CONFIG).testConnection();

    expect(result.success).toBe(false);
    expect(result.message).toBe('Network error');
  });

  it('includes schema when includeSchema=true', async () => {
    const athenaSend = jest.fn()
      .mockResolvedValueOnce({ QueryExecutionId: 'qid-3' })
      .mockResolvedValueOnce({ QueryExecution: { Status: { State: 'SUCCEEDED' } } });
    makeAthenaSend(athenaSend);

    const glueSend = jest.fn()
      .mockResolvedValueOnce({ DatabaseList: [] })
      .mockResolvedValueOnce(undefined);
    makeGlueSend(glueSend);

    const result = await new AthenaConnector('test', ATHENA_BASE_CONFIG).testConnection(true);

    expect(result.success).toBe(true);
    expect(result.schema?.schemas).toBeDefined();
  });
});

describe('AthenaConnector.query()', () => {
  it('polls until SUCCEEDED then returns columns, types, and rows', async () => {
    const send = jest.fn()
      .mockResolvedValueOnce({ QueryExecutionId: 'qid-4' })
      .mockResolvedValueOnce({ QueryExecution: { Status: { State: 'RUNNING' } } })
      .mockResolvedValueOnce({ QueryExecution: { Status: { State: 'SUCCEEDED' } } })
      .mockResolvedValueOnce({
        ResultSet: {
          Rows: [
            { Data: [{ VarCharValue: 'id' }, { VarCharValue: 'name' }] },
            { Data: [{ VarCharValue: '1' }, { VarCharValue: 'Alice' }] },
          ],
          ResultSetMetadata: {
            ColumnInfo: [
              { Name: 'id', Type: 'integer' },
              { Name: 'name', Type: 'varchar' },
            ],
          },
        },
      });
    makeAthenaSend(send);
    makeGlueSend(jest.fn());

    const result = await new AthenaConnector('test', ATHENA_BASE_CONFIG).query('SELECT id, name FROM users');

    expect(result.columns).toEqual(['id', 'name']);
    expect(result.types).toEqual(['integer', 'varchar']);
    expect(result.rows).toEqual([{ id: '1', name: 'Alice' }]);
  });

  it('submits query with correct WorkGroup and OutputLocation', async () => {
    const send = jest.fn()
      .mockResolvedValueOnce({ QueryExecutionId: 'qid-5' })
      .mockResolvedValueOnce({ QueryExecution: { Status: { State: 'SUCCEEDED' } } })
      .mockResolvedValueOnce({ ResultSet: { Rows: [{ Data: [] }], ResultSetMetadata: { ColumnInfo: [] } } });
    makeAthenaSend(send);
    makeGlueSend(jest.fn());

    await new AthenaConnector('test', ATHENA_BASE_CONFIG).query('SELECT 1');

    const startCall = send.mock.calls[0][0];
    expect(startCall.input.WorkGroup).toBe('primary');
    expect(startCall.input.ResultConfiguration.OutputLocation).toBe('s3://my-bucket/results/');
  });

  it('substitutes :paramName → ? (positional) in order of appearance', async () => {
    const send = jest.fn()
      .mockResolvedValueOnce({ QueryExecutionId: 'qid-6' })
      .mockResolvedValueOnce({ QueryExecution: { Status: { State: 'SUCCEEDED' } } })
      .mockResolvedValueOnce({ ResultSet: { Rows: [{ Data: [] }], ResultSetMetadata: { ColumnInfo: [] } } });
    makeAthenaSend(send);
    makeGlueSend(jest.fn());

    await new AthenaConnector('test', ATHENA_BASE_CONFIG).query(
      'SELECT * FROM t WHERE id = :id AND role = :role',
      { id: 42, role: 'admin' }
    );

    const startCall = send.mock.calls[0][0];
    expect(startCall.input.QueryString).toBe('SELECT * FROM t WHERE id = ? AND role = ?');
    expect(startCall.input.ExecutionParameters).toEqual(['42', 'admin']);
  });

  it('substitutes NULL string for params absent from the params map', async () => {
    const send = jest.fn()
      .mockResolvedValueOnce({ QueryExecutionId: 'qid-7' })
      .mockResolvedValueOnce({ QueryExecution: { Status: { State: 'SUCCEEDED' } } })
      .mockResolvedValueOnce({ ResultSet: { Rows: [{ Data: [] }], ResultSetMetadata: { ColumnInfo: [] } } });
    makeAthenaSend(send);
    makeGlueSend(jest.fn());

    await new AthenaConnector('test', ATHENA_BASE_CONFIG).query('SELECT * FROM t WHERE x = :missing');

    const startCall = send.mock.calls[0][0];
    expect(startCall.input.ExecutionParameters).toEqual(['NULL']);
  });

  it('throws when query ends in FAILED state', async () => {
    const send = jest.fn()
      .mockResolvedValueOnce({ QueryExecutionId: 'qid-8' })
      .mockResolvedValueOnce({
        QueryExecution: { Status: { State: 'FAILED', StateChangeReason: 'Table not found' } },
      });
    makeAthenaSend(send);
    makeGlueSend(jest.fn());

    await expect(
      new AthenaConnector('test', ATHENA_BASE_CONFIG).query('SELECT * FROM missing_table')
    ).rejects.toThrow('Table not found');
  });
});

describe('AthenaConnector.getSchema()', () => {
  it('returns SchemaEntry[] from Glue catalog grouped by database then table', async () => {
    makeAthenaSend(jest.fn());
    const glueSend = jest.fn()
      .mockResolvedValueOnce({
        DatabaseList: [{ Name: 'default' }, { Name: 'analytics' }],
        NextToken: undefined,
      })
      .mockResolvedValueOnce({
        TableList: [
          {
            Name: 'users',
            StorageDescriptor: { Columns: [{ Name: 'id', Type: 'int' }, { Name: 'email', Type: 'string' }] },
            PartitionKeys: [],
          },
        ],
        NextToken: undefined,
      })
      .mockResolvedValueOnce({
        TableList: [
          {
            Name: 'events',
            StorageDescriptor: { Columns: [{ Name: 'ts', Type: 'timestamp' }] },
            PartitionKeys: [{ Name: 'dt', Type: 'string' }],
          },
        ],
        NextToken: undefined,
      });
    makeGlueSend(glueSend);

    const schema = await new AthenaConnector('test', ATHENA_BASE_CONFIG).getSchema();

    expect(schema).toHaveLength(2);
    const def = schema.find(s => s.schema === 'default')!;
    expect(def.tables[0].table).toBe('users');
    expect(def.tables[0].columns).toEqual([
      { name: 'id', type: 'int' },
      { name: 'email', type: 'string' },
    ]);
    const analytics = schema.find(s => s.schema === 'analytics')!;
    expect(analytics.tables[0].columns).toEqual([
      { name: 'ts', type: 'timestamp' },
      { name: 'dt', type: 'string' },
    ]);
  });

  it('skips information_schema database', async () => {
    makeAthenaSend(jest.fn());
    const glueSend = jest.fn()
      .mockResolvedValueOnce({
        DatabaseList: [{ Name: 'information_schema' }, { Name: 'default' }],
        NextToken: undefined,
      })
      .mockResolvedValueOnce({ TableList: [], NextToken: undefined });
    makeGlueSend(glueSend);

    const schema = await new AthenaConnector('test', ATHENA_BASE_CONFIG).getSchema();

    expect(schema).toHaveLength(1);
    expect(schema[0].schema).toBe('default');
  });

  it('returns empty array when Glue has no databases', async () => {
    makeAthenaSend(jest.fn());
    makeGlueSend(jest.fn().mockResolvedValueOnce({ DatabaseList: [], NextToken: undefined }));

    const schema = await new AthenaConnector('test', ATHENA_BASE_CONFIG).getSchema();

    expect(schema).toEqual([]);
  });
});

describe('AthenaConnector client construction', () => {
  it('constructs AthenaClient and GlueClient with region and credentials', async () => {
    const send = jest.fn()
      .mockResolvedValueOnce({ QueryExecutionId: 'q' })
      .mockResolvedValueOnce({ QueryExecution: { Status: { State: 'SUCCEEDED' } } })
      .mockResolvedValueOnce({ ResultSet: { Rows: [{ Data: [] }], ResultSetMetadata: { ColumnInfo: [] } } });
    makeAthenaSend(send);
    makeGlueSend(jest.fn());

    await new AthenaConnector('test', ATHENA_BASE_CONFIG).query('SELECT 1');

    expect(MockAthenaClient).toHaveBeenCalledWith(
      expect.objectContaining({
        region: 'us-east-1',
        credentials: expect.objectContaining({
          accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
          secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        }),
      })
    );
  });

  it('omits credentials when aws_access_key_id is absent (IAM role fallback)', async () => {
    const send = jest.fn()
      .mockResolvedValueOnce({ QueryExecutionId: 'q' })
      .mockResolvedValueOnce({ QueryExecution: { Status: { State: 'SUCCEEDED' } } })
      .mockResolvedValueOnce({ ResultSet: { Rows: [{ Data: [] }], ResultSetMetadata: { ColumnInfo: [] } } });
    makeAthenaSend(send);
    makeGlueSend(jest.fn());

    await new AthenaConnector('test', { region_name: 'eu-west-1', s3_staging_dir: 's3://x/' }).query('SELECT 1');

    const callArg = MockAthenaClient.mock.calls[0][0] as any;
    expect(callArg.credentials).toBeUndefined();
    expect(callArg.region).toBe('eu-west-1');
  });

  it('reuses the same AthenaClient across multiple calls', async () => {
    const succeededResponse = { QueryExecution: { Status: { State: 'SUCCEEDED' } } };
    const send = jest.fn()
      .mockResolvedValueOnce({ QueryExecutionId: 'q1' })
      .mockResolvedValueOnce(succeededResponse)
      .mockResolvedValueOnce({ QueryExecutionId: 'q2' })
      .mockResolvedValueOnce(succeededResponse);
    makeAthenaSend(send);
    makeGlueSend(jest.fn());

    const connector = new AthenaConnector('test', ATHENA_BASE_CONFIG);
    await connector.testConnection();
    await connector.testConnection();

    expect(MockAthenaClient).toHaveBeenCalledTimes(1);
  });
});

describe('getNodeConnector() factory for athena', () => {
  it('returns an AthenaConnector for type "athena"', () => {
    const connector = getNodeConnector('mydb', 'athena', ATHENA_BASE_CONFIG);
    expect(connector).toBeInstanceOf(AthenaConnector);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// bigquery-connector.test.ts
// ─────────────────────────────────────────────────────────────────────────────

const BIGQUERY_BASE_CONFIG = {
  project_id: 'my-project',
  service_account_json: JSON.stringify({
    type: 'service_account',
    project_id: 'my-project',
    client_email: 'sa@my-project.iam.gserviceaccount.com',
  }),
};

function makeJob(state: 'DONE' | 'RUNNING', errorResult?: { message: string }, queryResultRows: any[] = [], fields: any[] = []) {
  const getMetadata = jest.fn()
    .mockResolvedValueOnce([{ status: { state: 'RUNNING' } }])
    .mockResolvedValue([{
      status: {
        state,
        ...(errorResult ? { errorResult } : {}),
      },
    }]);
  const getQueryResults = jest.fn().mockResolvedValue([
    queryResultRows,
    null,
    { schema: { fields } },
  ]);
  return { getMetadata, getQueryResults };
}

function makeBigQueryClient(overrides: {
  createQueryJob?: jest.Mock;
  getDatasets?: jest.Mock;
} = {}) {
  const createQueryJob = overrides.createQueryJob ?? jest.fn();
  const getDatasets = overrides.getDatasets ?? jest.fn().mockResolvedValue([[]]);
  MockBigQuery.mockImplementation(() => ({ createQueryJob, getDatasets }) as any);
  return { createQueryJob, getDatasets };
}

describe('BigQueryConnector.testConnection()', () => {
  it('returns success=true when query completes DONE with no error', async () => {
    const job = makeJob('DONE');
    makeBigQueryClient({ createQueryJob: jest.fn().mockResolvedValue([job]) });

    const result = await new BigQueryConnector('test', BIGQUERY_BASE_CONFIG).testConnection();

    expect(result.success).toBe(true);
    expect(result.message).toBe('Connection successful');
  });

  it('returns success=false when job has errorResult', async () => {
    const job = makeJob('DONE', { message: 'Permission denied' });
    makeBigQueryClient({ createQueryJob: jest.fn().mockResolvedValue([job]) });

    const result = await new BigQueryConnector('test', BIGQUERY_BASE_CONFIG).testConnection();

    expect(result.success).toBe(false);
    expect(result.message).toBe('Permission denied');
  });

  it('returns success=false on createQueryJob() exception', async () => {
    makeBigQueryClient({ createQueryJob: jest.fn().mockRejectedValue(new Error('Auth error')) });

    const result = await new BigQueryConnector('test', BIGQUERY_BASE_CONFIG).testConnection();

    expect(result.success).toBe(false);
    expect(result.message).toBe('Auth error');
  });

  it('includes schema when includeSchema=true', async () => {
    const job = makeJob('DONE');
    const schemaJob = makeJob('DONE', undefined, [], [
      { name: 'id', type: 'INTEGER' },
    ]);
    const createQueryJob = jest.fn()
      .mockResolvedValueOnce([job])
      .mockResolvedValueOnce([schemaJob]);
    const getDatasets = jest.fn().mockResolvedValue([[{ id: 'public' }]]);
    makeBigQueryClient({ createQueryJob, getDatasets });

    const result = await new BigQueryConnector('test', BIGQUERY_BASE_CONFIG).testConnection(true);

    expect(result.success).toBe(true);
    expect(result.schema?.schemas).toBeDefined();
  });
});

describe('BigQueryConnector.query()', () => {
  it('returns columns, types, and rows', async () => {
    const job = makeJob('DONE', undefined, [
      { id: 1, name: 'Alice' },
    ], [
      { name: 'id', type: 'INTEGER' },
      { name: 'name', type: 'STRING' },
    ]);
    makeBigQueryClient({ createQueryJob: jest.fn().mockResolvedValue([job]) });

    const result = await new BigQueryConnector('test', BIGQUERY_BASE_CONFIG).query('SELECT id, name FROM users');

    expect(result.columns).toEqual(['id', 'name']);
    expect(result.types).toEqual(['INTEGER', 'STRING']);
    expect(result.rows).toEqual([{ id: 1, name: 'Alice' }]);
  });

  it('substitutes :paramName → @paramName (BigQuery named params)', async () => {
    const job = makeJob('DONE');
    const createQueryJob = jest.fn().mockResolvedValue([job]);
    makeBigQueryClient({ createQueryJob });

    await new BigQueryConnector('test', BIGQUERY_BASE_CONFIG).query(
      'SELECT * FROM t WHERE id = :id AND role = :role',
      { id: 42, role: 'admin' }
    );

    expect(createQueryJob).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'SELECT * FROM t WHERE id = @id AND role = @role',
        params: { id: 42, role: 'admin' },
      })
    );
  });

  it('substitutes null for params absent from the params map', async () => {
    const job = makeJob('DONE');
    const createQueryJob = jest.fn().mockResolvedValue([job]);
    makeBigQueryClient({ createQueryJob });

    await new BigQueryConnector('test', BIGQUERY_BASE_CONFIG).query('SELECT * FROM t WHERE x = :missing');

    expect(createQueryJob).toHaveBeenCalledWith(
      expect.objectContaining({ params: { missing: null } })
    );
  });
});

describe('BigQueryConnector.getSchema()', () => {
  it('returns SchemaEntry[] grouped by dataset then table', async () => {
    const publicJob = makeJob('DONE', undefined, [
      { table_name: 'users', column_name: 'id', data_type: 'INT64' },
      { table_name: 'users', column_name: 'email', data_type: 'STRING' },
    ]);
    const analyticsJob = makeJob('DONE', undefined, [
      { table_name: 'events', column_name: 'ts', data_type: 'TIMESTAMP' },
    ]);
    const createQueryJob = jest.fn()
      .mockResolvedValueOnce([publicJob])
      .mockResolvedValueOnce([analyticsJob]);
    const getDatasets = jest.fn().mockResolvedValue([
      [{ id: 'public' }, { id: 'analytics' }],
    ]);
    makeBigQueryClient({ createQueryJob, getDatasets });

    const schema = await new BigQueryConnector('test', BIGQUERY_BASE_CONFIG).getSchema();

    expect(schema).toHaveLength(2);
    const pub = schema.find(s => s.schema === 'public')!;
    expect(pub.tables[0].table).toBe('users');
    expect(pub.tables[0].columns).toEqual([
      { name: 'id', type: 'INT64' },
      { name: 'email', type: 'STRING' },
    ]);
    const analytics = schema.find(s => s.schema === 'analytics')!;
    expect(analytics.tables[0].columns[0].name).toBe('ts');
  });

  it('returns empty array when no datasets exist', async () => {
    makeBigQueryClient({ getDatasets: jest.fn().mockResolvedValue([[]]) });

    const schema = await new BigQueryConnector('test', BIGQUERY_BASE_CONFIG).getSchema();

    expect(schema).toEqual([]);
  });

  it('skips datasets that fail to query (graceful degradation)', async () => {
    const createQueryJob = jest.fn()
      .mockRejectedValueOnce(new Error('Access denied'))
      .mockResolvedValueOnce([makeJob('DONE', undefined, [
        { table_name: 'events', column_name: 'ts', data_type: 'TIMESTAMP' },
      ])]);
    const getDatasets = jest.fn().mockResolvedValue([
      [{ id: 'restricted' }, { id: 'public' }],
    ]);
    makeBigQueryClient({ createQueryJob, getDatasets });

    const schema = await new BigQueryConnector('test', BIGQUERY_BASE_CONFIG).getSchema();

    expect(schema).toHaveLength(1);
    expect(schema[0].schema).toBe('public');
  });
});

describe('BigQueryConnector client construction', () => {
  it('passes project_id and parsed credentials to BigQuery client', async () => {
    const job = makeJob('DONE');
    makeBigQueryClient({ createQueryJob: jest.fn().mockResolvedValue([job]) });

    await new BigQueryConnector('test', BIGQUERY_BASE_CONFIG).testConnection();

    expect(MockBigQuery).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'my-project' })
    );
  });

  it('supports wrapped credential format: {"projectId": ..., "credentials": {...}}', async () => {
    const job = makeJob('DONE');
    makeBigQueryClient({ createQueryJob: jest.fn().mockResolvedValue([job]) });

    const wrappedConfig = {
      project_id: 'wrapped-project',
      service_account_json: JSON.stringify({
        projectId: 'wrapped-project',
        credentials: {
          type: 'service_account',
          client_email: 'sa@wrapped-project.iam.gserviceaccount.com',
        },
      }),
    };

    await new BigQueryConnector('test', wrappedConfig).testConnection();

    const callArgs = MockBigQuery.mock.calls[0][0] as any;
    expect(callArgs.credentials).toBeDefined();
    expect(callArgs.credentials.client_email).toBe('sa@wrapped-project.iam.gserviceaccount.com');
  });

  it('reuses the same BigQuery client instance across multiple calls', async () => {
    const job1 = makeJob('DONE');
    const job2 = makeJob('DONE');
    const createQueryJob = jest.fn()
      .mockResolvedValueOnce([job1])
      .mockResolvedValueOnce([job2]);
    makeBigQueryClient({ createQueryJob });

    const connector = new BigQueryConnector('test', BIGQUERY_BASE_CONFIG);
    await connector.testConnection();
    await connector.testConnection();

    expect(MockBigQuery).toHaveBeenCalledTimes(1);
  });
});

describe('getNodeConnector() factory for bigquery', () => {
  it('returns a BigQueryConnector for type "bigquery"', () => {
    const connector = getNodeConnector('mydb', 'bigquery', BIGQUERY_BASE_CONFIG);
    expect(connector).toBeInstanceOf(BigQueryConnector);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// csv-connector.test.ts
// ─────────────────────────────────────────────────────────────────────────────

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

describe('CsvConnector.query()', () => {
  it('executes SQL against DuckDB views via mocked instance', async () => {
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

    const { DuckDBInstance } = jest.requireMock('@duckdb/node-api');
    (DuckDBInstance.create as jest.Mock).mockResolvedValue(mockInstance);

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

// ─────────────────────────────────────────────────────────────────────────────
// postgres-connector.test.ts
// ─────────────────────────────────────────────────────────────────────────────

const POSTGRES_BASE_CONFIG = {
  host: 'localhost',
  port: 5432,
  database: 'testdb',
  username: 'testuser',
  password: 'testpass',
};

function makeMockPool(queryImpl: jest.Mock) {
  MockPool.mockImplementation(() => ({ query: queryImpl, end: jest.fn() } as any));
}

describe('PostgresConnector.testConnection()', () => {
  it('returns success=true when SELECT 1 succeeds', async () => {
    const mockQuery = jest.fn().mockResolvedValue({ rows: [], fields: [] });
    makeMockPool(mockQuery);

    const result = await new PostgresConnector('test', POSTGRES_BASE_CONFIG).testConnection();

    expect(result.success).toBe(true);
    expect(result.message).toBe('Connection successful');
    expect(mockQuery).toHaveBeenCalledWith('SELECT 1', []);
  });

  it('returns success=false with the error message on failure', async () => {
    const mockQuery = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    makeMockPool(mockQuery);

    const result = await new PostgresConnector('test', POSTGRES_BASE_CONFIG).testConnection();

    expect(result.success).toBe(false);
    expect(result.message).toBe('ECONNREFUSED');
  });

  it('includes schema when includeSchema=true', async () => {
    const mockQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [], fields: [] })
      .mockResolvedValueOnce({
        rows: [
          { table_schema: 'public', table_name: 'users', column_name: 'id', data_type: 'integer' },
        ],
        fields: [],
      });
    makeMockPool(mockQuery);

    const result = await new PostgresConnector('test', POSTGRES_BASE_CONFIG).testConnection(true);

    expect(result.success).toBe(true);
    expect(result.schema?.schemas).toHaveLength(1);
    expect(result.schema?.schemas[0].schema).toBe('public');
  });
});

describe('PostgresConnector.query()', () => {
  it('returns columns, types, and rows from query result', async () => {
    const mockQuery = jest.fn().mockResolvedValue({
      rows: [{ id: 1, name: 'Alice' }],
      fields: [
        { name: 'id', dataTypeID: 23 },
        { name: 'name', dataTypeID: 25 },
      ],
    });
    makeMockPool(mockQuery);

    const result = await new PostgresConnector('test', POSTGRES_BASE_CONFIG).query('SELECT id, name FROM users');

    expect(result.columns).toEqual(['id', 'name']);
    expect(result.types).toEqual(['integer', 'text']);
    expect(result.rows).toEqual([{ id: 1, name: 'Alice' }]);
  });

  it('substitutes :name params as $N positional params in order of appearance', async () => {
    const mockQuery = jest.fn().mockResolvedValue({ rows: [], fields: [] });
    makeMockPool(mockQuery);

    await new PostgresConnector('test', POSTGRES_BASE_CONFIG).query(
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

    await new PostgresConnector('test', POSTGRES_BASE_CONFIG).query(
      'SELECT :val + :val AS doubled',
      { val: 5 }
    );

    expect(mockQuery).toHaveBeenCalledWith('SELECT $1 + $1 AS doubled', [5]);
  });

  it('substitutes null for params absent from the params map', async () => {
    const mockQuery = jest.fn().mockResolvedValue({ rows: [], fields: [] });
    makeMockPool(mockQuery);

    await new PostgresConnector('test', POSTGRES_BASE_CONFIG).query(
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

    const result = await new PostgresConnector('test', POSTGRES_BASE_CONFIG).query('SELECT col');

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
      const result = await new PostgresConnector('test', POSTGRES_BASE_CONFIG).query('SELECT col');
      expect(result.types[0]).toBe(expectedType);
      jest.clearAllMocks();
    }
  });
});

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

    const schema = await new PostgresConnector('test', POSTGRES_BASE_CONFIG).getSchema();

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

    await new PostgresConnector('test', POSTGRES_BASE_CONFIG).getSchema();

    const sql: string = mockQuery.mock.calls[0][0];
    expect(sql).toContain('information_schema.columns');
    expect(sql).toMatch(/NOT IN[\s\S]*'pg_catalog'[\s\S]*'information_schema'/);
  });

  it('returns empty array when no user tables exist', async () => {
    const mockQuery = jest.fn().mockResolvedValue({ rows: [], fields: [] });
    makeMockPool(mockQuery);

    const schema = await new PostgresConnector('test', POSTGRES_BASE_CONFIG).getSchema();

    expect(schema).toEqual([]);
  });
});

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
      ssl: { rejectUnauthorized: false },
    });
  });

  it('reuses the same Pool instance across multiple calls', async () => {
    const mockQuery = jest.fn().mockResolvedValue({ rows: [], fields: [] });
    makeMockPool(mockQuery);

    const connector = new PostgresConnector('test', POSTGRES_BASE_CONFIG);
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

describe('getNodeConnector() factory', () => {
  it('returns a PostgresConnector for type "postgresql"', () => {
    const connector = getNodeConnector('mydb', 'postgresql', POSTGRES_BASE_CONFIG);
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
