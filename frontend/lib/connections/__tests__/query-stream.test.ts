import { describe, it, expect } from 'vitest';
import { NodeConnector, drainQueryStream, queryResultToStream, type QueryResult, type QueryStream, type SchemaEntry, type TestConnectionResult } from '../base';

const RESULT: QueryResult = {
  columns: ['id', 'name'], types: ['INTEGER', 'VARCHAR'],
  rows: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }], finalQuery: 'SELECT * FROM t',
};

async function collect(stream: QueryStream): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for await (const r of stream.rows) out.push(r);
  return out;
}

describe('QueryStream contract', () => {
  it('queryResultToStream → drainQueryStream round-trips', async () => {
    expect(await drainQueryStream(queryResultToStream(RESULT))).toEqual(RESULT);
  });

  it('base connector: default queryStream() wraps query() (materialized fallback)', async () => {
    // A connector that ONLY implements query() — inherits the default streaming wrapper.
    class MaterializedConnector extends NodeConnector {
      async testConnection(): Promise<TestConnectionResult> { return { success: true, message: 'ok' }; }
      async query(): Promise<QueryResult> { return RESULT; }
      async getSchema(): Promise<SchemaEntry[]> { return []; }
    }
    const c = new MaterializedConnector('m', {});
    const stream = await c.queryStream('SELECT 1');
    expect(stream.columns).toEqual(RESULT.columns);
    expect(await collect(stream)).toEqual(RESULT.rows);
  });

  it('streaming connector: queryStream() yields lazily; query() drains it (no double impl)', async () => {
    let rowsPulled = 0;
    class StreamingConnector extends NodeConnector {
      async testConnection(): Promise<TestConnectionResult> { return { success: true, message: 'ok' }; }
      async getSchema(): Promise<SchemaEntry[]> { return []; }
      override async queryStream(): Promise<QueryStream> {
        async function* gen(): AsyncGenerator<Record<string, unknown>> {
          for (const r of RESULT.rows) { rowsPulled++; yield r; }
        }
        return { columns: RESULT.columns, types: RESULT.types, finalQuery: RESULT.finalQuery, rows: gen() };
      }
      override async query(): Promise<QueryResult> { return drainQueryStream(await this.queryStream()); }
    }
    const c = new StreamingConnector('s', {});

    // Lazy: pulling the stream pulls rows one at a time.
    const stream = await c.queryStream();
    expect(rowsPulled).toBe(0); // nothing pulled until iterated
    const collected = await collect(stream);
    expect(collected).toEqual(RESULT.rows);
    expect(rowsPulled).toBe(2);

    // query() drains the same streaming source into a materialized result.
    expect(await c.query()).toEqual(RESULT);
  });
});
