jest.mock('@google-cloud/bigquery', () => {
  const MockBigQuery = jest.fn();
  return { BigQuery: MockBigQuery };
});

import { BigQuery } from '@google-cloud/bigquery';
import { BigQueryConnector } from '../bigquery-connector';
import { getNodeConnector } from '../index';

const MockBigQuery = BigQuery as jest.MockedClass<typeof BigQuery>;

const BASE_CONFIG = {
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

function makeClient(overrides: {
  createQueryJob?: jest.Mock;
  getDatasets?: jest.Mock;
} = {}) {
  const createQueryJob = overrides.createQueryJob ?? jest.fn();
  const getDatasets = overrides.getDatasets ?? jest.fn().mockResolvedValue([[]]);
  MockBigQuery.mockImplementation(() => ({ createQueryJob, getDatasets }) as any);
  return { createQueryJob, getDatasets };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── testConnection() ─────────────────────────────────────────────────────────

describe('BigQueryConnector.testConnection()', () => {
  it('returns success=true when query completes DONE with no error', async () => {
    const job = makeJob('DONE');
    makeClient({ createQueryJob: jest.fn().mockResolvedValue([job]) });

    const result = await new BigQueryConnector('test', BASE_CONFIG).testConnection();

    expect(result.success).toBe(true);
    expect(result.message).toBe('Connection successful');
  });

  it('returns success=false when job has errorResult', async () => {
    const job = makeJob('DONE', { message: 'Permission denied' });
    makeClient({ createQueryJob: jest.fn().mockResolvedValue([job]) });

    const result = await new BigQueryConnector('test', BASE_CONFIG).testConnection();

    expect(result.success).toBe(false);
    expect(result.message).toBe('Permission denied');
  });

  it('returns success=false on createQueryJob() exception', async () => {
    makeClient({ createQueryJob: jest.fn().mockRejectedValue(new Error('Auth error')) });

    const result = await new BigQueryConnector('test', BASE_CONFIG).testConnection();

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
    makeClient({ createQueryJob, getDatasets });

    const result = await new BigQueryConnector('test', BASE_CONFIG).testConnection(true);

    expect(result.success).toBe(true);
    expect(result.schema?.schemas).toBeDefined();
  });
});

// ─── query() ─────────────────────────────────────────────────────────────────

describe('BigQueryConnector.query()', () => {
  it('returns columns, types, and rows', async () => {
    const job = makeJob('DONE', undefined, [
      { id: 1, name: 'Alice' },
    ], [
      { name: 'id', type: 'INTEGER' },
      { name: 'name', type: 'STRING' },
    ]);
    makeClient({ createQueryJob: jest.fn().mockResolvedValue([job]) });

    const result = await new BigQueryConnector('test', BASE_CONFIG).query('SELECT id, name FROM users');

    expect(result.columns).toEqual(['id', 'name']);
    expect(result.types).toEqual(['INTEGER', 'STRING']);
    expect(result.rows).toEqual([{ id: 1, name: 'Alice' }]);
  });

  it('substitutes :paramName → @paramName (BigQuery named params)', async () => {
    const job = makeJob('DONE');
    const createQueryJob = jest.fn().mockResolvedValue([job]);
    makeClient({ createQueryJob });

    await new BigQueryConnector('test', BASE_CONFIG).query(
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
    makeClient({ createQueryJob });

    await new BigQueryConnector('test', BASE_CONFIG).query('SELECT * FROM t WHERE x = :missing');

    expect(createQueryJob).toHaveBeenCalledWith(
      expect.objectContaining({ params: { missing: null } })
    );
  });
});

// ─── getSchema() ─────────────────────────────────────────────────────────────

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
    makeClient({ createQueryJob, getDatasets });

    const schema = await new BigQueryConnector('test', BASE_CONFIG).getSchema();

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
    makeClient({ getDatasets: jest.fn().mockResolvedValue([[]]) });

    const schema = await new BigQueryConnector('test', BASE_CONFIG).getSchema();

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
    makeClient({ createQueryJob, getDatasets });

    const schema = await new BigQueryConnector('test', BASE_CONFIG).getSchema();

    expect(schema).toHaveLength(1);
    expect(schema[0].schema).toBe('public');
  });
});

// ─── BigQuery client construction ─────────────────────────────────────────────

describe('BigQueryConnector client construction', () => {
  it('passes project_id and parsed credentials to BigQuery client', async () => {
    const job = makeJob('DONE');
    makeClient({ createQueryJob: jest.fn().mockResolvedValue([job]) });

    await new BigQueryConnector('test', BASE_CONFIG).testConnection();

    expect(MockBigQuery).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'my-project' })
    );
  });

  it('supports wrapped credential format: {"projectId": ..., "credentials": {...}}', async () => {
    const job = makeJob('DONE');
    makeClient({ createQueryJob: jest.fn().mockResolvedValue([job]) });

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
    makeClient({ createQueryJob });

    const connector = new BigQueryConnector('test', BASE_CONFIG);
    await connector.testConnection();
    await connector.testConnection();

    expect(MockBigQuery).toHaveBeenCalledTimes(1);
  });
});

// ─── getNodeConnector() factory ───────────────────────────────────────────────

describe('getNodeConnector() factory for bigquery', () => {
  it('returns a BigQueryConnector for type "bigquery"', () => {
    const connector = getNodeConnector('mydb', 'bigquery', BASE_CONFIG);
    expect(connector).toBeInstanceOf(BigQueryConnector);
  });
});
