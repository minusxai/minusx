/**
 * PostgresConnector.queryStream: reads via a server-side cursor in batches,
 * derives columns/types from the cursor's first read, yields rows lazily, and
 * releases the client when iteration finishes. Cursor/pool are mocked (no real
 * PG), so this asserts the streaming control flow precisely.
 */
const { released, fakeCursor, fakePool } = vi.hoisted(() => {
  const released = { count: 0 };
  // Two batches then empty; fields available from the first read.
  const fields = [{ name: 'id', dataTypeID: 23 }, { name: 'amt', dataTypeID: 701 }];
  const batches = [
    [{ id: 1, amt: 1.5 }, { id: 2, amt: 2.5 }],
    [{ id: 3, amt: 3.5 }],
    [],
  ];
  let readIdx = 0;
  let closed = false;
  const fakeCursor = {
    read(_n: number, cb: (e: Error | null, rows: unknown[], result: unknown) => void) {
      const rows = batches[readIdx] ?? [];
      readIdx += 1;
      cb(null, rows, { fields });
    },
    close(cb: () => void) { closed = true; cb(); },
    get closed() { return closed; },
  };
  const client = {
    query: () => fakeCursor,
    release: () => { released.count += 1; },
  };
  const fakePool = { connect: async () => client };
  return { released, fakeCursor, fakePool };
});

vi.mock('../pg-registry', () => ({ getOrCreatePgPool: () => fakePool }));
vi.mock('pg-cursor', () => ({ default: class { constructor() { /* noop */ } } }));

import { describe, it, expect, beforeEach } from 'vitest';
import { PostgresConnector } from '../postgres-connector';
import { drainQueryStream } from '../base';

describe('PostgresConnector.queryStream (cursor-based streaming)', () => {
  beforeEach(() => { released.count = 0; });

  it('streams batched rows, derives columns/types, releases the client', async () => {
    const conn = new PostgresConnector('pg', { host: 'h', database: 'd', username: 'u' });
    const stream = await conn.queryStream('SELECT id, amt FROM t');
    expect(stream.columns).toEqual(['id', 'amt']);
    expect(stream.types).toEqual(['integer', 'double precision']); // OID 23, 701 (per PG_OID_TO_TYPE)

    const result = await drainQueryStream(stream);
    expect(result.rows).toEqual([
      { id: 1, amt: 1.5 }, { id: 2, amt: 2.5 }, { id: 3, amt: 3.5 },
    ]);
    // Iterating to completion closes the cursor + releases the client.
    expect(fakeCursor.closed).toBe(true);
    expect(released.count).toBe(1);
  });
});
