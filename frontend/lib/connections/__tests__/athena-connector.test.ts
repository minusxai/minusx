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

import { AthenaClient } from '@aws-sdk/client-athena';
import { GlueClient } from '@aws-sdk/client-glue';
import { AthenaConnector } from '../athena-connector';
import { getNodeConnector } from '../index';

const MockAthenaClient = AthenaClient as jest.MockedClass<typeof AthenaClient>;
const MockGlueClient = GlueClient as jest.MockedClass<typeof GlueClient>;

const BASE_CONFIG = {
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

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── testConnection() ─────────────────────────────────────────────────────────

describe('AthenaConnector.testConnection()', () => {
  it('returns success=true when query completes SUCCEEDED', async () => {
    const send = jest.fn()
      .mockResolvedValueOnce({ QueryExecutionId: 'qid-1' })           // StartQueryExecution
      .mockResolvedValueOnce({                                          // GetQueryExecution
        QueryExecution: { Status: { State: 'SUCCEEDED' } },
      });
    makeAthenaSend(send);
    makeGlueSend(jest.fn());

    const result = await new AthenaConnector('test', BASE_CONFIG).testConnection();

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

    const result = await new AthenaConnector('test', BASE_CONFIG).testConnection();

    expect(result.success).toBe(false);
    expect(result.message).toContain('Syntax error');
  });

  it('returns success=false on send() exception', async () => {
    const send = jest.fn().mockRejectedValue(new Error('Network error'));
    makeAthenaSend(send);
    makeGlueSend(jest.fn());

    const result = await new AthenaConnector('test', BASE_CONFIG).testConnection();

    expect(result.success).toBe(false);
    expect(result.message).toBe('Network error');
  });

  it('includes schema when includeSchema=true', async () => {
    const athenaSend = jest.fn()
      .mockResolvedValueOnce({ QueryExecutionId: 'qid-3' })
      .mockResolvedValueOnce({ QueryExecution: { Status: { State: 'SUCCEEDED' } } });
    makeAthenaSend(athenaSend);

    const glueSend = jest.fn()
      .mockResolvedValueOnce({ DatabaseList: [] })  // GetDatabases
      .mockResolvedValueOnce(undefined);             // paginator end
    makeGlueSend(glueSend);

    const result = await new AthenaConnector('test', BASE_CONFIG).testConnection(true);

    expect(result.success).toBe(true);
    expect(result.schema?.schemas).toBeDefined();
  });
});

// ─── query() ─────────────────────────────────────────────────────────────────

describe('AthenaConnector.query()', () => {
  it('polls until SUCCEEDED then returns columns, types, and rows', async () => {
    const send = jest.fn()
      .mockResolvedValueOnce({ QueryExecutionId: 'qid-4' })           // start
      .mockResolvedValueOnce({ QueryExecution: { Status: { State: 'RUNNING' } } })  // poll 1
      .mockResolvedValueOnce({ QueryExecution: { Status: { State: 'SUCCEEDED' } } }) // poll 2
      .mockResolvedValueOnce({                                          // GetQueryResults
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

    const result = await new AthenaConnector('test', BASE_CONFIG).query('SELECT id, name FROM users');

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

    await new AthenaConnector('test', BASE_CONFIG).query('SELECT 1');

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

    await new AthenaConnector('test', BASE_CONFIG).query(
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

    await new AthenaConnector('test', BASE_CONFIG).query('SELECT * FROM t WHERE x = :missing');

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
      new AthenaConnector('test', BASE_CONFIG).query('SELECT * FROM missing_table')
    ).rejects.toThrow('Table not found');
  });
});

// ─── getSchema() ─────────────────────────────────────────────────────────────

describe('AthenaConnector.getSchema()', () => {
  it('returns SchemaEntry[] from Glue catalog grouped by database then table', async () => {
    makeAthenaSend(jest.fn());
    const glueSend = jest.fn()
      .mockResolvedValueOnce({
        DatabaseList: [{ Name: 'default' }, { Name: 'analytics' }],
        NextToken: undefined,
      })
      .mockResolvedValueOnce({  // GetTables for 'default'
        TableList: [
          {
            Name: 'users',
            StorageDescriptor: { Columns: [{ Name: 'id', Type: 'int' }, { Name: 'email', Type: 'string' }] },
            PartitionKeys: [],
          },
        ],
        NextToken: undefined,
      })
      .mockResolvedValueOnce({  // GetTables for 'analytics'
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

    const schema = await new AthenaConnector('test', BASE_CONFIG).getSchema();

    expect(schema).toHaveLength(2);
    const def = schema.find(s => s.schema === 'default')!;
    expect(def.tables[0].table).toBe('users');
    expect(def.tables[0].columns).toEqual([
      { name: 'id', type: 'int' },
      { name: 'email', type: 'string' },
    ]);
    const analytics = schema.find(s => s.schema === 'analytics')!;
    // partition keys appended after storage columns
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

    const schema = await new AthenaConnector('test', BASE_CONFIG).getSchema();

    expect(schema).toHaveLength(1);
    expect(schema[0].schema).toBe('default');
  });

  it('returns empty array when Glue has no databases', async () => {
    makeAthenaSend(jest.fn());
    makeGlueSend(jest.fn().mockResolvedValueOnce({ DatabaseList: [], NextToken: undefined }));

    const schema = await new AthenaConnector('test', BASE_CONFIG).getSchema();

    expect(schema).toEqual([]);
  });
});

// ─── Client construction ──────────────────────────────────────────────────────

describe('AthenaConnector client construction', () => {
  it('constructs AthenaClient and GlueClient with region and credentials', async () => {
    const send = jest.fn()
      .mockResolvedValueOnce({ QueryExecutionId: 'q' })
      .mockResolvedValueOnce({ QueryExecution: { Status: { State: 'SUCCEEDED' } } })
      .mockResolvedValueOnce({ ResultSet: { Rows: [{ Data: [] }], ResultSetMetadata: { ColumnInfo: [] } } });
    makeAthenaSend(send);
    makeGlueSend(jest.fn());

    await new AthenaConnector('test', BASE_CONFIG).query('SELECT 1');

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

    const connector = new AthenaConnector('test', BASE_CONFIG);
    await connector.testConnection();
    await connector.testConnection();

    expect(MockAthenaClient).toHaveBeenCalledTimes(1);
  });
});

// ─── getNodeConnector() factory ───────────────────────────────────────────────

describe('getNodeConnector() factory for athena', () => {
  it('returns an AthenaConnector for type "athena"', () => {
    const connector = getNodeConnector('mydb', 'athena', BASE_CONFIG);
    expect(connector).toBeInstanceOf(AthenaConnector);
  });
});
