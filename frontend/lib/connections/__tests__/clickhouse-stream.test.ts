/**
 * ClickHouseConnector.queryStream: JSONCompactEachRowWithNamesAndTypes — the
 * first two streamed rows are column names then types, the rest are value arrays
 * zipped into row objects. Client mocked (no real ClickHouse).
 */
const { fakeClient } = vi.hoisted(() => {
  // Stream yields batches of "row" objects (each has .json()): names, types, then data.
  const batches = [
    [{ json: () => ['id', 'name'] }, { json: () => ['UInt32', 'String'] }],
    [{ json: () => [1, 'a'] }, { json: () => [2, 'b'] }],
    [{ json: () => [3, 'c'] }],
  ];
  const fakeClient = {
    query: async () => ({
      async *stream() { for (const b of batches) yield b; },
    }),
  };
  return { fakeClient };
});

vi.mock('../clickhouse-registry', () => ({ getOrCreateClickHouseClient: () => fakeClient }));

import { describe, it, expect } from 'vitest';
import { ClickHouseConnector } from '../clickhouse-connector';
import { drainQueryStream } from '../base';

describe('ClickHouseConnector.queryStream', () => {
  it('streams rows with typed metadata from the first two stream rows', async () => {
    const conn = new ClickHouseConnector('ch', { host: 'h', username: 'u' });
    const stream = await conn.queryStream('SELECT id, name FROM t');
    expect(stream.columns).toEqual(['id', 'name']);
    expect(stream.types).toEqual(['UInt32', 'String']);
    const result = await drainQueryStream(stream);
    expect(result.rows).toEqual([
      { id: 1, name: 'a' }, { id: 2, name: 'b' }, { id: 3, name: 'c' },
    ]);
  });
});
