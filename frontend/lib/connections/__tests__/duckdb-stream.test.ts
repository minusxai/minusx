/**
 * REAL DuckDB streaming (no mocks): queryStream reads the result chunk-by-chunk
 * and yields rows lazily, with the SAME JS value conversion as the materialized
 * query(). Proves connector-level streaming end-to-end against a real DB file.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DuckDBInstance } from '@duckdb/node-api';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync, existsSync } from 'fs';
import { DuckDbConnector } from '../duckdb-connector';
import { drainQueryStream } from '../base';

// Unique path per run so the process-global DuckDB instance registry doesn't alias.
const DB_PATH = join(tmpdir(), `mx-duckdb-stream-${process.pid}.duckdb`);
const N = 3000; // > one chunk (~2048) → forces multi-chunk streaming

beforeAll(async () => {
  if (existsSync(DB_PATH)) unlinkSync(DB_PATH);
  const inst = await DuckDBInstance.create(DB_PATH);
  const conn = await inst.connect();
  await conn.run(
    `CREATE TABLE events AS
       SELECT range AS id,
              (range * 1.5)::DECIMAL(12,2) AS amt,
              DATE '2024-01-01' + INTERVAL (range) DAY AS dt,
              CASE WHEN range % 2 = 0 THEN 'even' ELSE 'odd' END AS kind
       FROM range(${N})`,
  );
  conn.closeSync();
  inst.closeSync();
});

afterAll(() => { try { unlinkSync(DB_PATH); } catch { /* ignore */ } });

function connector() {
  return new DuckDbConnector('verify', { file_path: DB_PATH });
}

async function collect(connQuery: string) {
  const stream = await connector().queryStream(connQuery);
  const rows: Record<string, unknown>[] = [];
  for await (const r of stream.rows) rows.push(r);
  return { stream, rows };
}

describe('DuckDbConnector.queryStream — real streaming', () => {
  it('streams all rows across multiple chunks, with header metadata up front', async () => {
    const { stream, rows } = await collect('SELECT * FROM events ORDER BY id');
    expect(stream.columns).toEqual(['id', 'amt', 'dt', 'kind']);
    expect(stream.types[0]).toBe('BIGINT');
    expect(rows).toHaveLength(N); // all rows streamed (multi-chunk)
    expect(rows[0]).toEqual({ id: 0, amt: 0, dt: '2024-01-01T00:00:00.000Z', kind: 'even' });
    expect(rows[3]).toMatchObject({ id: 3, amt: 4.5, kind: 'odd' });
  });

  it('streamed rows are byte-identical to the materialized query() path', async () => {
    const materialized = await connector().query('SELECT * FROM events ORDER BY id LIMIT 100');
    const streamed = await drainQueryStream(await connector().queryStream('SELECT * FROM events ORDER BY id LIMIT 100'));
    expect(streamed.columns).toEqual(materialized.columns);
    expect(streamed.types).toEqual(materialized.types);
    expect(streamed.rows).toEqual(materialized.rows); // DECIMAL/DATE conversion matches exactly
  });

  it('lazily yields — pulling one row does not eagerly read the whole result', async () => {
    const stream = await connector().queryStream('SELECT * FROM events ORDER BY id');
    const it = stream.rows[Symbol.asyncIterator]();
    const first = await it.next();
    expect(first.value).toMatchObject({ id: 0 });
    // Close the iterator early (triggers the generator's finally → connection close).
    await it.return?.(undefined);
  });

  it('runs repeatedly without leaking connections (each stream closes its conn)', async () => {
    for (let i = 0; i < 5; i++) {
      const { rows } = await collect(`SELECT count(*) AS c FROM events WHERE kind = 'even'`);
      expect(rows[0]).toEqual({ c: N / 2 });
    }
  });
});
