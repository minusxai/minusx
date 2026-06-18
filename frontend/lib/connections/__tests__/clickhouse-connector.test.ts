import type { Mock } from 'vitest';

vi.mock('@clickhouse/client', () => ({
  createClient: vi.fn(),
}));

import { createClient } from '@clickhouse/client';
import { ClickHouseConnector } from '../clickhouse-connector';
import { clearClickHouseRegistry, clickHouseUrl } from '../clickhouse-registry';
import { getNodeConnector } from '../index';

const MockCreate = createClient as unknown as Mock;

const BASE_CONFIG = {
  host: 'play.clickhouse.com',
  port: 443,
  protocol: 'https' as const,
  database: 'default',
  username: 'play',
  password: '',
};

/** Build a fake ClickHouseClient. `queryImpl` receives the query() args. */
function makeClient(opts: {
  queryImpl?: Mock;
} = {}) {
  // Default query resolves to an empty result set so SELECT 1 (testConnection) works.
  const query = opts.queryImpl ?? vi.fn().mockResolvedValue(resultSet({ meta: [], data: [] }));
  MockCreate.mockReturnValue({ query, ping: vi.fn(), close: vi.fn() });
  return { query };
}

/** A resultSet whose .json() resolves to the given payload. */
function resultSet(payload: unknown) {
  return { json: vi.fn().mockResolvedValue(payload) };
}

beforeEach(() => {
  vi.clearAllMocks();
  clearClickHouseRegistry();
});

describe('clickHouseUrl()', () => {
  it('builds an https URL with the given host/port', () => {
    expect(clickHouseUrl(BASE_CONFIG)).toBe('https://play.clickhouse.com:443');
  });

  it('defaults protocol to https and port to 8443', () => {
    expect(clickHouseUrl({ host: 'ch.internal' })).toBe('https://ch.internal:8443');
  });

  it('defaults http port to 8123', () => {
    expect(clickHouseUrl({ host: 'localhost', protocol: 'http' })).toBe('http://localhost:8123');
  });
});

describe('ClickHouseConnector.testConnection()', () => {
  it('returns success=true when SELECT 1 succeeds', async () => {
    const query = vi.fn().mockResolvedValue(resultSet({ meta: [{ name: '1', type: 'UInt8' }], data: [{ '1': 1 }] }));
    makeClient({ queryImpl: query });
    const result = await new ClickHouseConnector('test', BASE_CONFIG).testConnection();
    expect(result.success).toBe(true);
    expect(result.message).toBe('Connection successful');
    expect(query.mock.calls[0][0].query).toBe('SELECT 1');
  });

  it('returns success=false with the error message when the query fails (auth/etc.)', async () => {
    makeClient({ queryImpl: vi.fn().mockRejectedValue(new Error('Authentication failed')) });
    const result = await new ClickHouseConnector('test', BASE_CONFIG).testConnection();
    expect(result.success).toBe(false);
    expect(result.message).toBe('Authentication failed');
  });

  it('returns success=false when the client throws (network)', async () => {
    makeClient({ queryImpl: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) });
    const result = await new ClickHouseConnector('test', BASE_CONFIG).testConnection();
    expect(result.success).toBe(false);
    expect(result.message).toBe('ECONNREFUSED');
  });

  it('includes schema when includeSchema=true', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce(resultSet({ meta: [], data: [] }))  // SELECT 1
      .mockResolvedValueOnce(resultSet({                          // getSchema
        data: [{ database: 'github', table: 'commits', name: 'sha', type: 'String' }],
      }));
    makeClient({ queryImpl: query });
    const result = await new ClickHouseConnector('test', { ...BASE_CONFIG, database: 'github' }).testConnection(true);
    expect(result.success).toBe(true);
    expect(result.schema?.schemas[0].schema).toBe('github');
  });
});

describe('ClickHouseConnector.query()', () => {
  it('maps meta → columns/types and data → rows', async () => {
    const query = vi.fn().mockResolvedValue(resultSet({
      meta: [{ name: 'id', type: 'UInt64' }, { name: 'name', type: 'String' }],
      data: [{ id: 1, name: 'Alice' }],
    }));
    makeClient({ queryImpl: query });

    const result = await new ClickHouseConnector('test', BASE_CONFIG).query('SELECT id, name FROM users');

    expect(result.columns).toEqual(['id', 'name']);
    expect(result.types).toEqual(['UInt64', 'String']);
    expect(result.rows).toEqual([{ id: 1, name: 'Alice' }]);
    expect(query.mock.calls[0][0].format).toBe('JSON');
  });

  it('rewrites :name → {name:Type} and collects typed query_params', async () => {
    const query = vi.fn().mockResolvedValue(resultSet({ meta: [], data: [] }));
    makeClient({ queryImpl: query });

    await new ClickHouseConnector('test', BASE_CONFIG).query(
      'SELECT * FROM t WHERE id = :id AND role = :role AND score > :score',
      { id: 42, role: 'admin', score: 9.5 },
    );

    const arg = query.mock.calls[0][0];
    expect(arg.query).toBe('SELECT * FROM t WHERE id = {id:Int64} AND role = {role:String} AND score > {score:Float64}');
    expect(arg.query_params).toEqual({ id: 42, role: 'admin', score: 9.5 });
  });

  it('inlines NULL for params absent from the map (no placeholder emitted)', async () => {
    const query = vi.fn().mockResolvedValue(resultSet({ meta: [], data: [] }));
    makeClient({ queryImpl: query });

    await new ClickHouseConnector('test', BASE_CONFIG).query('SELECT * FROM t WHERE x = :missing');

    const arg = query.mock.calls[0][0];
    expect(arg.query).toBe('SELECT * FROM t WHERE x = NULL');
    expect(arg.query_params).toEqual({});
  });

  it('does not treat a ::Type cast as a placeholder', async () => {
    const query = vi.fn().mockResolvedValue(resultSet({ meta: [], data: [] }));
    makeClient({ queryImpl: query });

    await new ClickHouseConnector('test', BASE_CONFIG).query("SELECT '2021-01-01'::Date AS d");

    expect(query.mock.calls[0][0].query).toBe("SELECT '2021-01-01'::Date AS d");
  });

  it('returns finalQuery with params inlined as literals', async () => {
    const query = vi.fn().mockResolvedValue(resultSet({ meta: [], data: [] }));
    makeClient({ queryImpl: query });

    const result = await new ClickHouseConnector('test', BASE_CONFIG).query(
      'SELECT * FROM t WHERE role = :role',
      { role: 'admin' },
    );

    expect(result.finalQuery).toBe("SELECT * FROM t WHERE role = 'admin'");
  });

  it('passes timeoutMs as max_execution_time (seconds, rounded up)', async () => {
    const query = vi.fn().mockResolvedValue(resultSet({ meta: [], data: [] }));
    makeClient({ queryImpl: query });

    await new ClickHouseConnector('test', BASE_CONFIG).query('SELECT 1', undefined, 4200);

    expect(query.mock.calls[0][0].clickhouse_settings).toEqual({ max_execution_time: 5 });
  });

  it('omits clickhouse_settings when no timeout is given', async () => {
    const query = vi.fn().mockResolvedValue(resultSet({ meta: [], data: [] }));
    makeClient({ queryImpl: query });

    await new ClickHouseConnector('test', BASE_CONFIG).query('SELECT 1');

    expect(query.mock.calls[0][0].clickhouse_settings).toBeUndefined();
  });
});

describe('ClickHouseConnector.getSchema()', () => {
  // BASE_CONFIG has database='default'. A config without a database lists all DBs.
  const NO_DB_CONFIG = { ...BASE_CONFIG, database: '' };

  it('groups system.columns rows by database then table; no indexes', async () => {
    const query = vi.fn().mockResolvedValue(resultSet({
      data: [
        { database: 'default', table: 'users', name: 'id', type: 'UInt64' },
        { database: 'default', table: 'users', name: 'email', type: 'String' },
        { database: 'analytics', table: 'events', name: 'ts', type: 'DateTime' },
      ],
    }));
    makeClient({ queryImpl: query });

    const schema = await new ClickHouseConnector('test', NO_DB_CONFIG).getSchema();

    expect(schema).toHaveLength(2);
    const def = schema.find(s => s.schema === 'default')!;
    expect(def.tables[0].table).toBe('users');
    expect(def.tables[0].columns).toEqual([
      { name: 'id', type: 'UInt64' },
      { name: 'email', type: 'String' },
    ]);
    expect(def.tables[0].indexes).toBeUndefined();
    const analytics = schema.find(s => s.schema === 'analytics')!;
    expect(analytics.tables[0].columns[0].name).toBe('ts');
  });

  it('lists all non-system databases when no database is configured', async () => {
    const query = vi.fn().mockResolvedValue(resultSet({ data: [] }));
    makeClient({ queryImpl: query });

    await new ClickHouseConnector('test', NO_DB_CONFIG).getSchema();

    const arg = query.mock.calls[0][0];
    expect(arg.query).toContain('system.columns');
    expect(arg.query).toMatch(/NOT IN[\s\S]*'system'[\s\S]*'information_schema'/);
    expect(arg.query_params).toBeUndefined();
  });

  it('scopes to the configured database via a {db:String} param', async () => {
    const query = vi.fn().mockResolvedValue(resultSet({ data: [] }));
    makeClient({ queryImpl: query });

    await new ClickHouseConnector('test', BASE_CONFIG).getSchema();

    const arg = query.mock.calls[0][0];
    expect(arg.query).toContain('database = {db:String}');
    expect(arg.query).not.toMatch(/NOT IN/);
    expect(arg.query_params).toEqual({ db: 'default' });
  });

  it('returns empty array when no columns exist', async () => {
    makeClient({ queryImpl: vi.fn().mockResolvedValue(resultSet({ data: [] })) });
    const schema = await new ClickHouseConnector('test', NO_DB_CONFIG).getSchema();
    expect(schema).toEqual([]);
  });
});

describe('ClickHouse client construction & caching', () => {
  it('constructs the client with the playground url, username and password', async () => {
    makeClient();
    await new ClickHouseConnector('test', BASE_CONFIG).testConnection();
    expect(MockCreate).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://play.clickhouse.com:443',
      username: 'play',
      password: '',
      database: 'default',
    }));
  });

  it('reuses one client across calls for the same target', async () => {
    makeClient();
    const connector = new ClickHouseConnector('test', BASE_CONFIG);
    await connector.testConnection();
    await connector.testConnection();
    expect(MockCreate).toHaveBeenCalledTimes(1);
  });
});

describe('getNodeConnector() factory for clickhouse', () => {
  it('returns a ClickHouseConnector for type "clickhouse"', () => {
    const connector = getNodeConnector('mydb', 'clickhouse', BASE_CONFIG);
    expect(connector).toBeInstanceOf(ClickHouseConnector);
  });
});
