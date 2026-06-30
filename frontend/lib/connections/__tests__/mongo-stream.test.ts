/**
 * MongoConnector.queryStream: iterates the aggregation cursor, sampling the first
 * documents for columns (schemaless), then streaming the rest; cursor closed in
 * finally. MongoClient mocked (no real Mongo).
 */
const { cursorState, fakeMongo } = vi.hoisted(() => {
  const docs = [{ id: 1, name: 'a' }, { id: 2, name: 'b' }, { id: 3, name: 'c' }];
  const cursorState = { idx: 0, closed: false };
  const cursor = {
    async hasNext() { return cursorState.idx < docs.length; },
    async next() { const d = docs[cursorState.idx]; cursorState.idx += 1; return d; },
    async *[Symbol.asyncIterator]() { while (cursorState.idx < docs.length) { const d = docs[cursorState.idx]; cursorState.idx += 1; yield d; } },
    async close() { cursorState.closed = true; },
  };
  const fakeMongo = {
    db: () => ({ collection: () => ({ aggregate: () => cursor }) }),
  };
  return { cursorState, fakeMongo };
});

vi.mock('mongodb', () => ({ MongoClient: class { async connect() { return fakeMongo; } db() { return fakeMongo.db(); } } }));

import { describe, it, expect } from 'vitest';
import { MongoConnector } from '../mongo-connector';
import { drainQueryStream } from '../base';

describe('MongoConnector.queryStream', () => {
  it('streams aggregation docs, derives columns from the sample, closes the cursor', async () => {
    const conn = new MongoConnector('m', { host: 'h', port: 27017, database: 'd' });
    // Patch the private client getter to our fake (connector caches a MongoClient).
    (conn as unknown as { getClient: () => Promise<unknown> }).getClient = async () => fakeMongo;

    const stream = await conn.queryStream(JSON.stringify({ collection: 'c', pipeline: [{ $match: {} }] }));
    expect(stream.columns).toEqual(['id', 'name']);
    const result = await drainQueryStream(stream);
    expect(result.rows).toEqual([{ id: 1, name: 'a' }, { id: 2, name: 'b' }, { id: 3, name: 'c' }]);
    expect(cursorState.closed).toBe(true);
  });
});
