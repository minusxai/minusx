import type { Mock, MockedClass } from 'vitest';
vi.mock('@aws-sdk/client-athena', () => ({
  AthenaClient: vi.fn(),
  StartQueryExecutionCommand: vi.fn(function (this: any, args: any) { this.input = args; }),
  GetQueryExecutionCommand: vi.fn(function (this: any, args: any) { this.input = args; }),
  GetQueryResultsCommand: vi.fn(function (this: any, args: any) { this.input = args; }),
}));

vi.mock('@aws-sdk/client-glue', () => ({
  GlueClient: vi.fn(),
  GetDatabasesCommand: vi.fn(function (this: any, args: any) { this.input = args; }),
  GetTablesCommand: vi.fn(function (this: any, args: any) { this.input = args; }),
}));

vi.mock('@google-cloud/bigquery', () => {
  const MockBigQuery = vi.fn();
  return { BigQuery: MockBigQuery };
});

vi.mock('pg', () => ({
  Pool: vi.fn(),
}));

vi.mock('@duckdb/node-api', () => ({
  DuckDBInstance: {
    create: vi.fn(),
  },
  DuckDBConnection: vi.fn(),
}));

// Mutable mongodb-mock state. `mock`-prefixed so vitest's vi.mock hoisting
// permits the factory closure to reference them. Tests set these per-case;
// `mockMongoAggregate(collection, pipeline)` lets a test return different
// docs per collection (needed for the multi-collection getSchema tests).
let mockMongoCollections: Array<{ name: string }> = [];
let mockMongoAggregate: (collection: string, pipeline: unknown) => Record<string, unknown>[] = () => [];
const mockMongoAggregateCalls: Array<{ collection: string; pipeline: unknown; options: unknown }> = [];

vi.mock('mongodb', () => ({
  MongoClient: vi.fn().mockImplementation(function (this: any) {
    // `connect` resolves to the client itself — matches the real driver
    // and keeps `getSharedMongoClient`'s `client.connect()` chain intact.
    this.connect = vi.fn().mockImplementation(async () => this);
    this.close  = vi.fn().mockResolvedValue(undefined);
    this.db     = vi.fn().mockReturnValue({
      command: vi.fn().mockResolvedValue({ ok: 1 }),
      listCollections: vi.fn().mockReturnValue({
        toArray: vi.fn().mockImplementation(async () => mockMongoCollections),
      }),
      collection: vi.fn().mockImplementation((name: string) => ({
        aggregate: vi.fn().mockImplementation((pipeline: unknown, options: unknown) => {
          mockMongoAggregateCalls.push({ collection: name, pipeline, options });
          return { toArray: vi.fn().mockImplementation(async () => mockMongoAggregate(name, pipeline)) };
        }),
      })),
    });
  }),
}));

vi.mock('@/lib/config', () => ({
  OBJECT_STORE_PUBLIC_URL: undefined,
  MX_NETWORK_LOG_EXCLUDE: '',
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
import { clearPgPoolRegistry } from '../pg-registry';
import { CsvConnector } from '../csv-connector';
import { SqliteConnector } from '../sqlite-connector';
import { MongoConnector } from '../mongo-connector';
import { MongoClient } from 'mongodb';
import { getNodeConnector } from '../index';

const MockMongoClient = MongoClient as MockedClass<typeof MongoClient>;

const MockAthenaClient = AthenaClient as MockedClass<typeof AthenaClient>;
const MockGlueClient = GlueClient as MockedClass<typeof GlueClient>;
const MockBigQuery = BigQuery as MockedClass<typeof BigQuery>;
const MockPool = Pool as MockedClass<typeof Pool>;

beforeEach(() => {
  vi.clearAllMocks();
  clearPgPoolRegistry();
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

function makeAthenaSend(impl: Mock) {
  MockAthenaClient.mockImplementation(function (this: any) { this.send = impl; } as any);
}

function makeGlueSend(impl: Mock) {
  MockGlueClient.mockImplementation(function (this: any) { this.send = impl; } as any);
}

describe('AthenaConnector.testConnection()', () => {
  it('returns success=true when query completes SUCCEEDED', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce({ QueryExecutionId: 'qid-1' })
      .mockResolvedValueOnce({
        QueryExecution: { Status: { State: 'SUCCEEDED' } },
      });
    makeAthenaSend(send);
    makeGlueSend(vi.fn());

    const result = await new AthenaConnector('test', ATHENA_BASE_CONFIG).testConnection();

    expect(result.success).toBe(true);
    expect(result.message).toBe('Connection successful');
  });

  it('returns success=false when query completes FAILED', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce({ QueryExecutionId: 'qid-2' })
      .mockResolvedValueOnce({
        QueryExecution: { Status: { State: 'FAILED', StateChangeReason: 'Syntax error' } },
      });
    makeAthenaSend(send);
    makeGlueSend(vi.fn());

    const result = await new AthenaConnector('test', ATHENA_BASE_CONFIG).testConnection();

    expect(result.success).toBe(false);
    expect(result.message).toContain('Syntax error');
  });

  it('returns success=false on send() exception', async () => {
    const send = vi.fn().mockRejectedValue(new Error('Network error'));
    makeAthenaSend(send);
    makeGlueSend(vi.fn());

    const result = await new AthenaConnector('test', ATHENA_BASE_CONFIG).testConnection();

    expect(result.success).toBe(false);
    expect(result.message).toBe('Network error');
  });

  it('includes schema when includeSchema=true', async () => {
    const athenaSend = vi.fn()
      .mockResolvedValueOnce({ QueryExecutionId: 'qid-3' })
      .mockResolvedValueOnce({ QueryExecution: { Status: { State: 'SUCCEEDED' } } });
    makeAthenaSend(athenaSend);

    const glueSend = vi.fn()
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
    const send = vi.fn()
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
    makeGlueSend(vi.fn());

    const result = await new AthenaConnector('test', ATHENA_BASE_CONFIG).query('SELECT id, name FROM users');

    expect(result.columns).toEqual(['id', 'name']);
    expect(result.types).toEqual(['integer', 'varchar']);
    expect(result.rows).toEqual([{ id: '1', name: 'Alice' }]);
  });

  it('submits query with correct WorkGroup and OutputLocation', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce({ QueryExecutionId: 'qid-5' })
      .mockResolvedValueOnce({ QueryExecution: { Status: { State: 'SUCCEEDED' } } })
      .mockResolvedValueOnce({ ResultSet: { Rows: [{ Data: [] }], ResultSetMetadata: { ColumnInfo: [] } } });
    makeAthenaSend(send);
    makeGlueSend(vi.fn());

    await new AthenaConnector('test', ATHENA_BASE_CONFIG).query('SELECT 1');

    const startCall = send.mock.calls[0][0];
    expect(startCall.input.WorkGroup).toBe('primary');
    expect(startCall.input.ResultConfiguration.OutputLocation).toBe('s3://my-bucket/results/');
  });

  it('substitutes :paramName → ? (positional) in order of appearance', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce({ QueryExecutionId: 'qid-6' })
      .mockResolvedValueOnce({ QueryExecution: { Status: { State: 'SUCCEEDED' } } })
      .mockResolvedValueOnce({ ResultSet: { Rows: [{ Data: [] }], ResultSetMetadata: { ColumnInfo: [] } } });
    makeAthenaSend(send);
    makeGlueSend(vi.fn());

    await new AthenaConnector('test', ATHENA_BASE_CONFIG).query(
      'SELECT * FROM t WHERE id = :id AND role = :role',
      { id: 42, role: 'admin' }
    );

    const startCall = send.mock.calls[0][0];
    expect(startCall.input.QueryString).toBe('SELECT * FROM t WHERE id = ? AND role = ?');
    expect(startCall.input.ExecutionParameters).toEqual(['42', 'admin']);
  });

  it('substitutes NULL string for params absent from the params map', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce({ QueryExecutionId: 'qid-7' })
      .mockResolvedValueOnce({ QueryExecution: { Status: { State: 'SUCCEEDED' } } })
      .mockResolvedValueOnce({ ResultSet: { Rows: [{ Data: [] }], ResultSetMetadata: { ColumnInfo: [] } } });
    makeAthenaSend(send);
    makeGlueSend(vi.fn());

    await new AthenaConnector('test', ATHENA_BASE_CONFIG).query('SELECT * FROM t WHERE x = :missing');

    const startCall = send.mock.calls[0][0];
    expect(startCall.input.ExecutionParameters).toEqual(['NULL']);
  });

  it('throws when query ends in FAILED state', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce({ QueryExecutionId: 'qid-8' })
      .mockResolvedValueOnce({
        QueryExecution: { Status: { State: 'FAILED', StateChangeReason: 'Table not found' } },
      });
    makeAthenaSend(send);
    makeGlueSend(vi.fn());

    await expect(
      new AthenaConnector('test', ATHENA_BASE_CONFIG).query('SELECT * FROM missing_table')
    ).rejects.toThrow('Table not found');
  });
});

describe('AthenaConnector.getSchema()', () => {
  it('returns SchemaEntry[] from Glue catalog grouped by database then table', async () => {
    makeAthenaSend(vi.fn());
    const glueSend = vi.fn()
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
    makeAthenaSend(vi.fn());
    const glueSend = vi.fn()
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
    makeAthenaSend(vi.fn());
    makeGlueSend(vi.fn().mockResolvedValueOnce({ DatabaseList: [], NextToken: undefined }));

    const schema = await new AthenaConnector('test', ATHENA_BASE_CONFIG).getSchema();

    expect(schema).toEqual([]);
  });
});

describe('AthenaConnector client construction', () => {
  it('constructs AthenaClient and GlueClient with region and credentials', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce({ QueryExecutionId: 'q' })
      .mockResolvedValueOnce({ QueryExecution: { Status: { State: 'SUCCEEDED' } } })
      .mockResolvedValueOnce({ ResultSet: { Rows: [{ Data: [] }], ResultSetMetadata: { ColumnInfo: [] } } });
    makeAthenaSend(send);
    makeGlueSend(vi.fn());

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
    const send = vi.fn()
      .mockResolvedValueOnce({ QueryExecutionId: 'q' })
      .mockResolvedValueOnce({ QueryExecution: { Status: { State: 'SUCCEEDED' } } })
      .mockResolvedValueOnce({ ResultSet: { Rows: [{ Data: [] }], ResultSetMetadata: { ColumnInfo: [] } } });
    makeAthenaSend(send);
    makeGlueSend(vi.fn());

    await new AthenaConnector('test', { region_name: 'eu-west-1', s3_staging_dir: 's3://x/' }).query('SELECT 1');

    const callArg = MockAthenaClient.mock.calls[0][0] as any;
    expect(callArg.credentials).toBeUndefined();
    expect(callArg.region).toBe('eu-west-1');
  });

  it('reuses the same AthenaClient across multiple calls', async () => {
    const succeededResponse = { QueryExecution: { Status: { State: 'SUCCEEDED' } } };
    const send = vi.fn()
      .mockResolvedValueOnce({ QueryExecutionId: 'q1' })
      .mockResolvedValueOnce(succeededResponse)
      .mockResolvedValueOnce({ QueryExecutionId: 'q2' })
      .mockResolvedValueOnce(succeededResponse);
    makeAthenaSend(send);
    makeGlueSend(vi.fn());

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
  const getMetadata = vi.fn()
    .mockResolvedValueOnce([{ status: { state: 'RUNNING' } }])
    .mockResolvedValue([{
      status: {
        state,
        ...(errorResult ? { errorResult } : {}),
      },
    }]);
  const getQueryResults = vi.fn().mockResolvedValue([
    queryResultRows,
    null,
    { schema: { fields } },
  ]);
  return { getMetadata, getQueryResults };
}

function makeBigQueryClient(overrides: {
  createQueryJob?: Mock;
  getDatasets?: Mock;
} = {}) {
  const createQueryJob = overrides.createQueryJob ?? vi.fn();
  const getDatasets = overrides.getDatasets ?? vi.fn().mockResolvedValue([[]]);
  MockBigQuery.mockImplementation(function (this: any) { this.createQueryJob = createQueryJob; this.getDatasets = getDatasets; } as any);
  return { createQueryJob, getDatasets };
}

describe('BigQueryConnector.testConnection()', () => {
  it('returns success=true when query completes DONE with no error', async () => {
    const job = makeJob('DONE');
    makeBigQueryClient({ createQueryJob: vi.fn().mockResolvedValue([job]) });

    const result = await new BigQueryConnector('test', BIGQUERY_BASE_CONFIG).testConnection();

    expect(result.success).toBe(true);
    expect(result.message).toBe('Connection successful');
  });

  it('returns success=false when job has errorResult', async () => {
    const job = makeJob('DONE', { message: 'Permission denied' });
    makeBigQueryClient({ createQueryJob: vi.fn().mockResolvedValue([job]) });

    const result = await new BigQueryConnector('test', BIGQUERY_BASE_CONFIG).testConnection();

    expect(result.success).toBe(false);
    expect(result.message).toBe('Permission denied');
  });

  it('returns success=false on createQueryJob() exception', async () => {
    makeBigQueryClient({ createQueryJob: vi.fn().mockRejectedValue(new Error('Auth error')) });

    const result = await new BigQueryConnector('test', BIGQUERY_BASE_CONFIG).testConnection();

    expect(result.success).toBe(false);
    expect(result.message).toBe('Auth error');
  });

  it('includes schema when includeSchema=true', async () => {
    const job = makeJob('DONE');
    const schemaJob = makeJob('DONE', undefined, [], [
      { name: 'id', type: 'INTEGER' },
    ]);
    const createQueryJob = vi.fn()
      .mockResolvedValueOnce([job])
      .mockResolvedValueOnce([schemaJob]);
    const getDatasets = vi.fn().mockResolvedValue([[{ id: 'public' }]]);
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
    makeBigQueryClient({ createQueryJob: vi.fn().mockResolvedValue([job]) });

    const result = await new BigQueryConnector('test', BIGQUERY_BASE_CONFIG).query('SELECT id, name FROM users');

    expect(result.columns).toEqual(['id', 'name']);
    expect(result.types).toEqual(['INTEGER', 'STRING']);
    expect(result.rows).toEqual([{ id: 1, name: 'Alice' }]);
  });

  it('substitutes :paramName → @paramName (BigQuery named params)', async () => {
    const job = makeJob('DONE');
    const createQueryJob = vi.fn().mockResolvedValue([job]);
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
    const createQueryJob = vi.fn().mockResolvedValue([job]);
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
    const createQueryJob = vi.fn()
      .mockResolvedValueOnce([publicJob])
      .mockResolvedValueOnce([analyticsJob]);
    const getDatasets = vi.fn().mockResolvedValue([
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
    makeBigQueryClient({ getDatasets: vi.fn().mockResolvedValue([[]]) });

    const schema = await new BigQueryConnector('test', BIGQUERY_BASE_CONFIG).getSchema();

    expect(schema).toEqual([]);
  });

  it('skips datasets that fail to query (graceful degradation)', async () => {
    const createQueryJob = vi.fn()
      .mockRejectedValueOnce(new Error('Access denied'))
      .mockResolvedValueOnce([makeJob('DONE', undefined, [
        { table_name: 'events', column_name: 'ts', data_type: 'TIMESTAMP' },
      ])]);
    const getDatasets = vi.fn().mockResolvedValue([
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
    makeBigQueryClient({ createQueryJob: vi.fn().mockResolvedValue([job]) });

    await new BigQueryConnector('test', BIGQUERY_BASE_CONFIG).testConnection();

    expect(MockBigQuery).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'my-project' })
    );
  });

  it('supports wrapped credential format: {"projectId": ..., "credentials": {...}}', async () => {
    const job = makeJob('DONE');
    makeBigQueryClient({ createQueryJob: vi.fn().mockResolvedValue([job]) });

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
    const createQueryJob = vi.fn()
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
      run: vi.fn().mockResolvedValue(mockRunResult),
      closeSync: vi.fn(),
    };

    const mockInstance = {
      connect: vi.fn().mockResolvedValue(mockConn),
    };

    const { DuckDBInstance } = await vi.importMock<any>('@duckdb/node-api');
    (DuckDBInstance.create as Mock).mockResolvedValue(mockInstance);

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

function makeMockPool(queryImpl: Mock) {
  MockPool.mockImplementation(function (this: any) { this.query = queryImpl; this.end = vi.fn(); } as any);
}

describe('PostgresConnector.testConnection()', () => {
  it('returns success=true when SELECT 1 succeeds', async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rows: [], fields: [] });
    makeMockPool(mockQuery);

    const result = await new PostgresConnector('test', POSTGRES_BASE_CONFIG).testConnection();

    expect(result.success).toBe(true);
    expect(result.message).toBe('Connection successful');
    expect(mockQuery).toHaveBeenCalledWith('SELECT 1', []);
  });

  it('returns success=false with the error message on failure', async () => {
    const mockQuery = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    makeMockPool(mockQuery);

    const result = await new PostgresConnector('test', POSTGRES_BASE_CONFIG).testConnection();

    expect(result.success).toBe(false);
    expect(result.message).toBe('ECONNREFUSED');
  });

  it('includes schema when includeSchema=true', async () => {
    const mockQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [], fields: [] })          // SELECT 1
      .mockResolvedValueOnce({                                  // getSchema: columns
        rows: [
          { table_schema: 'public', table_name: 'users', column_name: 'id', data_type: 'integer' },
        ],
        fields: [],
      })
      .mockResolvedValueOnce({ rows: [], fields: [] });         // getSchema: indexes
    makeMockPool(mockQuery);

    const result = await new PostgresConnector('test', POSTGRES_BASE_CONFIG).testConnection(true);

    expect(result.success).toBe(true);
    expect(result.schema?.schemas).toHaveLength(1);
    expect(result.schema?.schemas[0].schema).toBe('public');
  });
});

describe('PostgresConnector.query()', () => {
  it('returns columns, types, and rows from query result', async () => {
    const mockQuery = vi.fn().mockResolvedValue({
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
    const mockQuery = vi.fn().mockResolvedValue({ rows: [], fields: [] });
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
    const mockQuery = vi.fn().mockResolvedValue({ rows: [], fields: [] });
    makeMockPool(mockQuery);

    await new PostgresConnector('test', POSTGRES_BASE_CONFIG).query(
      'SELECT :val + :val AS doubled',
      { val: 5 }
    );

    expect(mockQuery).toHaveBeenCalledWith('SELECT $1 + $1 AS doubled', [5]);
  });

  it('substitutes null for params absent from the params map', async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rows: [], fields: [] });
    makeMockPool(mockQuery);

    await new PostgresConnector('test', POSTGRES_BASE_CONFIG).query(
      'SELECT * FROM t WHERE x = :missing'
    );

    expect(mockQuery).toHaveBeenCalledWith('SELECT * FROM t WHERE x = $1', [null]);
  });

  it('maps unknown OIDs to "text"', async () => {
    const mockQuery = vi.fn().mockResolvedValue({
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
      const mockQuery = vi.fn().mockResolvedValue({
        rows: [],
        fields: [{ name: 'col', dataTypeID: oid }],
      });
      makeMockPool(mockQuery);
      const result = await new PostgresConnector('test', POSTGRES_BASE_CONFIG).query('SELECT col');
      expect(result.types[0]).toBe(expectedType);
      vi.clearAllMocks();
      clearPgPoolRegistry();
    }
  });
});

describe('PostgresConnector.getSchema()', () => {
  it('returns SchemaEntry[] grouped by schema then table', async () => {
    const mockQuery = vi.fn().mockResolvedValue({
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
    const mockQuery = vi.fn().mockResolvedValue({ rows: [], fields: [] });
    makeMockPool(mockQuery);

    await new PostgresConnector('test', POSTGRES_BASE_CONFIG).getSchema();

    const sql: string = mockQuery.mock.calls[0][0];
    expect(sql).toContain('information_schema.columns');
    expect(sql).toMatch(/NOT IN[\s\S]*'pg_catalog'[\s\S]*'information_schema'/);
  });

  it('returns empty array when no user tables exist', async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rows: [], fields: [] });
    makeMockPool(mockQuery);

    const schema = await new PostgresConnector('test', POSTGRES_BASE_CONFIG).getSchema();

    expect(schema).toEqual([]);
  });

  it('populates tables[].indexes from the index catalog query', async () => {
    // getSchema now runs two queries: columns, then indexes.
    const mockQuery = vi.fn()
      .mockResolvedValueOnce({
        rows: [
          { table_schema: 'public', table_name: 'users', column_name: 'id', data_type: 'integer' },
          { table_schema: 'public', table_name: 'users', column_name: 'email', data_type: 'text' },
        ],
        fields: [],
      })
      .mockResolvedValueOnce({
        rows: [
          { table_schema: 'public', table_name: 'users', index_name: 'users_pkey', is_unique: true, column_name: 'id', col_pos: 1 },
          { table_schema: 'public', table_name: 'users', index_name: 'idx_email', is_unique: false, column_name: 'email', col_pos: 1 },
        ],
        fields: [],
      });
    makeMockPool(mockQuery);

    const schema = await new PostgresConnector('test', POSTGRES_BASE_CONFIG).getSchema();
    const users = schema.find(s => s.schema === 'public')!.tables[0];
    expect(users.indexes).toEqual([
      { name: 'users_pkey', columns: ['id'], unique: true },
      { name: 'idx_email', columns: ['email'], unique: false },
    ]);
  });

  it('groups multi-column index columns in indkey order', async () => {
    const mockQuery = vi.fn()
      .mockResolvedValueOnce({
        rows: [
          { table_schema: 'public', table_name: 'events', column_name: 'country', data_type: 'text' },
          { table_schema: 'public', table_name: 'events', column_name: 'ts', data_type: 'timestamp' },
        ],
        fields: [],
      })
      .mockResolvedValueOnce({
        rows: [
          // Deliberately out of order — implementation must sort by col_pos.
          { table_schema: 'public', table_name: 'events', index_name: 'idx_multi', is_unique: false, column_name: 'ts', col_pos: 2 },
          { table_schema: 'public', table_name: 'events', index_name: 'idx_multi', is_unique: false, column_name: 'country', col_pos: 1 },
        ],
        fields: [],
      });
    makeMockPool(mockQuery);

    const schema = await new PostgresConnector('test', POSTGRES_BASE_CONFIG).getSchema();
    expect(schema[0].tables[0].indexes).toEqual([
      { name: 'idx_multi', columns: ['country', 'ts'], unique: false },
    ]);
  });

  it('sets indexes to [] for tables with no indexes', async () => {
    const mockQuery = vi.fn()
      .mockResolvedValueOnce({
        rows: [{ table_schema: 'public', table_name: 'logs', column_name: 'msg', data_type: 'text' }],
        fields: [],
      })
      .mockResolvedValueOnce({ rows: [], fields: [] });
    makeMockPool(mockQuery);

    const schema = await new PostgresConnector('test', POSTGRES_BASE_CONFIG).getSchema();
    expect(schema[0].tables[0].indexes).toEqual([]);
  });
});

describe('PostgresConnector pool lifecycle', () => {
  it('constructs Pool with correct pg options mapping username → user', async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rows: [], fields: [] });
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
    const mockQuery = vi.fn().mockResolvedValue({ rows: [], fields: [] });
    makeMockPool(mockQuery);

    const connector = new PostgresConnector('test', POSTGRES_BASE_CONFIG);
    await connector.query('SELECT 1');
    await connector.query('SELECT 2');

    expect(MockPool).toHaveBeenCalledTimes(1);
  });

  it('defaults port to 5432 and host to localhost when omitted', async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rows: [], fields: [] });
    makeMockPool(mockQuery);

    await new PostgresConnector('test', {
      database: 'mydb',
      username: 'user',
    }).testConnection();

    expect(MockPool).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'localhost', port: 5432 })
    );
  });

  it('uses connectionString when connection_string is provided', async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rows: [], fields: [] });
    makeMockPool(mockQuery);

    const connStr = 'postgresql://admin:secret@db.example.com:5433/mydb?sslmode=disable';
    await new PostgresConnector('test', {
      connection_string: connStr,
    }).testConnection();

    expect(MockPool).toHaveBeenCalledWith({
      connectionString: connStr,
    });
  });
});

describe('getNodeConnector() factory', () => {
  it('returns a PostgresConnector for type "postgresql"', () => {
    const connector = getNodeConnector('mydb', 'postgresql', POSTGRES_BASE_CONFIG);
    expect(connector).toBeInstanceOf(PostgresConnector);
  });

  it('still returns DuckDbConnector for type "duckdb"', async () => {
    const { DuckDbConnector } = await import('../duckdb-connector');
    const connector = getNodeConnector('mydb', 'duckdb', { file_path: 'test.duckdb' });
    expect(connector).toBeInstanceOf(DuckDbConnector);
  });

  it('returns a SqliteConnector for type "sqlite"', () => {
    const connector = getNodeConnector('mydb', 'sqlite', { file_path: 'test.sqlite' });
    expect(connector).toBeInstanceOf(SqliteConnector);
  });

  it('returns null for unknown types', () => {
    expect(getNodeConnector('x', 'mysql', {})).toBeNull();
    expect(getNodeConnector('x', 'redshift', {})).toBeNull();
  });
});

// SqliteConnector tests moved to sqlite-connector.test.ts — they now
// require real DuckDB (via sqlite_scanner) which is mocked in this file
// for the Athena/BigQuery/Postgres suites.

const MONGO_BASE_CONFIG = { host: 'localhost', port: 27017, database: 'testdb' };

describe('MongoConnector.query() — native aggregation pipeline', () => {
  // The `query` string is JSON `{collection, pipeline}`. The connector
  // parses it, applies `enforceMongoLimit`, and runs the pipeline natively
  // via `collection.aggregate()`.

  beforeEach(() => {
    mockMongoAggregate = () => [];
    mockMongoAggregateCalls.length = 0;
  });

  it('runs the parsed pipeline via collection.aggregate and projects rows to {columns,types}', async () => {
    mockMongoAggregate = () => [{ name: 'Acme', stars: 5 }, { name: 'Globex', stars: 3 }];
    const conn = new MongoConnector('test', MONGO_BASE_CONFIG);
    const q = JSON.stringify({ collection: 'business', pipeline: [{ $match: { open: true } }] });
    const result = await conn.query(q);

    expect(mockMongoAggregateCalls).toHaveLength(1);
    expect(mockMongoAggregateCalls[0].collection).toBe('business');
    // enforceMongoLimit appends {$limit:1000} since the pipeline has none
    expect(mockMongoAggregateCalls[0].pipeline).toEqual([{ $match: { open: true } }, { $limit: 1000 }]);
    expect(result.columns.sort()).toEqual(['name', 'stars']);
    expect(result.rows).toEqual([{ name: 'Acme', stars: 5 }, { name: 'Globex', stars: 3 }]);
  });

  it('passes timeoutMs through as maxTimeMS', async () => {
    const conn = new MongoConnector('test', MONGO_BASE_CONFIG);
    await conn.query(JSON.stringify({ collection: 'c', pipeline: [] }), undefined, 5000);
    expect(mockMongoAggregateCalls[0].options).toEqual({ maxTimeMS: 5000 });
  });

  it('omits maxTimeMS when no timeout is given', async () => {
    const conn = new MongoConnector('test', MONGO_BASE_CONFIG);
    await conn.query(JSON.stringify({ collection: 'c', pipeline: [] }));
    expect(mockMongoAggregateCalls[0].options).toEqual({});
  });

  it('finalQuery reflects the collection + limit-enforced pipeline', async () => {
    const conn = new MongoConnector('test', MONGO_BASE_CONFIG);
    const result = await conn.query(JSON.stringify({ collection: 'c', pipeline: [{ $count: 'n' }] }));
    expect(JSON.parse(result.finalQuery!)).toEqual({
      collection: 'c',
      pipeline: [{ $count: 'n' }, { $limit: 1000 }],
    });
  });

  it('throws a helpful error on invalid JSON', async () => {
    const conn = new MongoConnector('test', MONGO_BASE_CONFIG);
    await expect(conn.query('not json')).rejects.toThrow(/JSON parse failed/i);
  });

  it('throws when "collection" is missing', async () => {
    const conn = new MongoConnector('test', MONGO_BASE_CONFIG);
    await expect(conn.query(JSON.stringify({ pipeline: [] }))).rejects.toThrow(/"collection"/);
  });

  it('throws when "pipeline" is not an array', async () => {
    const conn = new MongoConnector('test', MONGO_BASE_CONFIG);
    await expect(
      conn.query(JSON.stringify({ collection: 'c', pipeline: 'nope' })),
    ).rejects.toThrow(/"pipeline"/);
  });
});

describe('MongoConnector.getSchema() — N-doc sampling, union of fields', () => {
  beforeEach(() => {
    mockMongoCollections = [];
    mockMongoAggregate = () => [];
    mockMongoAggregateCalls.length = 0;
  });

  it('samples up to 100 docs per collection and unions their field sets (excluding _id)', async () => {
    mockMongoCollections = [{ name: 'users' }];
    // Disjoint key sets across sampled docs — the union must surface them all,
    // which one-doc sampling would miss.
    mockMongoAggregate = () => [
      { _id: 1, name: 'a' },
      { _id: 2, email: 'b@x' },
      { _id: 3, age: 30 },
    ];
    const conn = new MongoConnector('test', MONGO_BASE_CONFIG);
    const schema = await conn.getSchema();
    const users = schema[0].tables.find((t) => t.table === 'users')!;
    expect(users.columns.map((c) => c.name).sort()).toEqual(['age', 'email', 'name']);
  });

  it('samples via a $sample stage of size 100', async () => {
    mockMongoCollections = [{ name: 'c' }];
    const conn = new MongoConnector('test', MONGO_BASE_CONFIG);
    await conn.getSchema();
    expect(mockMongoAggregateCalls[0].pipeline).toEqual([{ $sample: { size: 100 } }]);
  });
});

describe('MongoConnector client lifecycle — process-wide pooling', () => {
  // Regression guard for a leak where every fresh `MongoConnector`
  // opened a brand-new `MongoClient` (and therefore a fresh socket
  // pool, default `maxPoolSize=100`). Under benchmark load this
  // climbed into the thousands and the Mongo container OOM'd. Fix:
  // process-wide cache keyed by URI — all connectors pointing at the
  // same Mongo share one MongoClient.
  //
  // The cache is module-level and persists across tests in this file,
  // so assertions are framed as "delta vs. before this test" rather
  // than "absolute call count" — robust to other tests priming the
  // cache for known URIs.

  const PING_QUERY = JSON.stringify({ collection: 't', pipeline: [] });

  it('reuses one MongoClient across many MongoConnectors for the same URI', async () => {
    // Prime the cache once so the next 10 calls definitely hit it
    // regardless of what tests ran before this one.
    await new MongoConnector('prime', MONGO_BASE_CONFIG).query(PING_QUERY);
    const callsBefore = MockMongoClient.mock.calls.length;

    // 10 fresh connectors with identical config — mimics 10 sequential
    // ExecuteQuery calls in the benchmark path.
    for (let i = 0; i < 10; i++) {
      const conn = new MongoConnector('test', MONGO_BASE_CONFIG);
      await conn.query(PING_QUERY);
    }

    // Zero NEW MongoClient constructions — every one reuses the cached
    // promise.
    expect(MockMongoClient.mock.calls.length - callsBefore).toBe(0);
  });

  it('opens distinct MongoClients for distinct URIs', async () => {
    const callsBefore = MockMongoClient.mock.calls.length;

    // Hostnames not yet seen by any earlier test, so each one is a
    // fresh cache miss.
    await new MongoConnector('a', { host: 'lifecycle-host-aaa', port: 27017, database: 'db' }).query(PING_QUERY);
    await new MongoConnector('b', { host: 'lifecycle-host-bbb', port: 27017, database: 'db' }).query(PING_QUERY);

    expect(MockMongoClient.mock.calls.length - callsBefore).toBe(2);
  });
});
