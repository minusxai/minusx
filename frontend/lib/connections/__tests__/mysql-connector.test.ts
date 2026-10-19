import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createPool } from 'mysql2';
import { MySqlConnector } from '../mysql-connector';
import { closeMySqlPools } from '../mysql-registry';
import { getNodeConnector } from '../index';
import { connectionTypeToDialect } from '@/lib/types/connections';
import { getSafeConfig } from '@/lib/data/helpers/connections';
import { enforceQueryLimit } from '@/lib/sql/limit-enforcer';

vi.mock('mysql2', () => ({ createPool: vi.fn() }));

const config = { host: 'doris.local', port: 9030, database: 'analytics', username: 'reader', password: 'secret' };

function driver(options: { rows?: Record<string, unknown>[]; fields?: { name: string; columnType: number }[]; error?: Error; stall?: boolean; noResultSet?: boolean } = {}) {
  const run = vi.fn(() => {
    const stream = new PassThrough({ objectMode: true });
    const command = Object.assign(new EventEmitter(), { stream: () => stream });
    queueMicrotask(() => {
      if (options.error) { command.emit('error', options.error); stream.destroy(options.error); return; }
      command.emit('fields', options.noResultSet ? undefined : options.fields ?? [{ name: 'id', columnType: 8 }]);
      for (const row of options.rows ?? []) stream.write(row);
      if (!options.stall) { command.emit('end'); stream.end(); }
    });
    return command;
  });
  const connection = { query: run, execute: run, release: vi.fn(), destroy: vi.fn() };
  const pool = { getConnection: vi.fn((cb) => cb(null, connection)), end: vi.fn(cb => cb()) };
  vi.mocked(createPool).mockReturnValue(pool as never);
  return { run, connection, pool };
}

afterEach(async () => { await closeMySqlPools(); vi.clearAllMocks(); });

describe('MySQL connector', () => {
  it('registers the connector and uses the MySQL parser dialect', async () => {
    expect(getNodeConnector('doris', 'mysql', config)).toBeInstanceOf(MySqlConnector);
    expect(connectionTypeToDialect('mysql')).toBe('mysql');
    const limited = await enforceQueryLimit('SELECT `order` FROM `analytics`.`events` WHERE id = :id', { dialect: 'mysql' });
    expect(limited).toContain(':id');
    expect(limited).toMatch(/LIMIT 1000/i);
  });

  it('pings and reports authentication errors through the common test contract', async () => {
    driver({ error: new Error('Access denied') });
    expect(await new MySqlConnector('db', config).testConnection()).toMatchObject({ success: false, message: 'Access denied' });
  });

  it('streams rows, including precise numbers and dates, with metadata on empty results', async () => {
    const rows = [{ id: '9007199254740993', total: '123.4567890123456789', date: '2026-10-18' }];
    const mock = driver({ rows, fields: [{ name: 'id', columnType: 8 }, { name: 'total', columnType: 246 }, { name: 'date', columnType: 10 }] });
    const result = await new MySqlConnector('db', config).query('SELECT id, total, date FROM events');
    expect(result).toMatchObject({ columns: ['id', 'total', 'date'], types: ['BIGINT', 'DECIMAL', 'DATE'], rows });
    expect(mock.connection.release).toHaveBeenCalledTimes(1);
    expect(mock.connection.destroy).not.toHaveBeenCalled();
    expect(createPool).toHaveBeenCalledWith(expect.objectContaining({ port: 9030, supportBigNumbers: true, bigNumberStrings: true, dateStrings: true, multipleStatements: false }));
  });

  it('handles MySQL OK packets without result-set metadata', async () => {
    driver({ noResultSet: true, rows: [{ affectedRows: 1, fieldCount: 0 }] });
    expect(await new MySqlConnector('db', config).query('CREATE TABLE example (id INT)')).toMatchObject({ columns: [], types: [], rows: [] });
  });

  it('keeps column metadata for zero rows', async () => {
    driver({ fields: [{ name: 'label', columnType: 253 }] });
    expect(await new MySqlConnector('db', config).query('SELECT label FROM events WHERE 0')).toMatchObject({ columns: ['label'], types: ['VARCHAR'], rows: [] });
  });

  it('binds repeated parameters in occurrence order without rewriting quoted text or comments', async () => {
    const { run } = driver();
    await new MySqlConnector('db', config).query("SELECT :id, ':literal', `:column`, :id, :missing -- :comment\n/* :block */", { id: "x\\' OR 1=1 --" });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ sql: "SELECT ?, ':literal', `:column`, ?, ? -- :comment\n/* :block */", values: ["x\\' OR 1=1 --", "x\\' OR 1=1 --", null] }));
  });

  it('destroys an unfinished connection when a bounded consumer stops reading', async () => {
    const { connection } = driver({ rows: [{ id: 1 }, { id: 2 }], stall: true });
    const result = await new MySqlConnector('db', config).queryStream('SELECT * FROM huge_table');
    for await (const row of result.rows) { expect(row.id).toBe(1); break; }
    await new Promise(resolve => setImmediate(resolve));
    expect(connection.destroy).toHaveBeenCalledTimes(1);
    expect(connection.release).not.toHaveBeenCalled();
  });

  it('times out a stalled stream and destroys its connection', async () => {
    const { connection } = driver({ stall: true });
    await expect(new MySqlConnector('db', config).query('SELECT SLEEP(10)', undefined, 20)).rejects.toThrow(/timed out/i);
    expect(connection.destroy).toHaveBeenCalledTimes(1);
  });

  it('discovers columns in the configured database without engine-specific index catalogs', async () => {
    const { run } = driver({ rows: [
      { table_schema: 'analytics', table_name: 'events', column_name: 'id', data_type: 'bigint' },
      { table_schema: 'analytics', table_name: 'events', column_name: 'name', data_type: 'varchar' },
    ] });
    expect(await new MySqlConnector('db', config).getSchema()).toEqual([{ schema: 'analytics', tables: [{ table: 'events', columns: [{ name: 'id', type: 'bigint' }, { name: 'name', type: 'varchar' }] }] }]);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ sql: expect.stringContaining('table_schema = ?'), values: ['analytics'] }));
  });

  it('excludes system databases when no database is selected', async () => {
    const { run } = driver();
    await new MySqlConnector('db', { ...config, database: '' }).getSchema();
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ sql: expect.stringMatching(/NOT IN[\s\S]*'information_schema'[\s\S]*'mysql'[\s\S]*'performance_schema'[\s\S]*'sys'/) }));
  });

  it('reuses pools but isolates changed credentials and TLS settings', async () => {
    driver();
    await new MySqlConnector('a', config).query('SELECT 1');
    await new MySqlConnector('b', config).query('SELECT 1');
    expect(createPool).toHaveBeenCalledTimes(1);
    // New mocks avoid reusing ended mock streams between identities.
    driver();
    await new MySqlConnector('a', { ...config, password: 'rotated' }).query('SELECT 1');
    driver();
    await new MySqlConnector('a', { ...config, ssl_mode: 'required' }).query('SELECT 1');
    expect(createPool).toHaveBeenCalledTimes(3);
    expect(createPool).toHaveBeenLastCalledWith(expect.objectContaining({ ssl: { rejectUnauthorized: true } }));
  });

  it('exposes editable connection fields without exposing the password', () => {
    expect(getSafeConfig('mysql', { ...config, ssl_mode: 'required' })).toEqual({ host: 'doris.local', port: 9030, database: 'analytics', username: 'reader', ssl_mode: 'required' });
  });
});
