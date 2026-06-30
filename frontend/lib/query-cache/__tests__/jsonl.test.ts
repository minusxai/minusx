import { describe, it, expect } from 'vitest';
import { Readable } from 'stream';
import {
  encodeResultToJsonl,
  decodeJsonl,
  decodeJsonlBounded,
} from '../jsonl';
import {
  resultToJsonlStream,
  jsonlStreamToResult,
  gzipString,
  gunzipToString,
} from '../jsonl-stream.server';
import type { QueryResult } from '@/lib/connections/base';

const RESULT: QueryResult = {
  columns: ['id', 'name', 'amount'],
  types: ['number', 'text', 'number'],
  rows: [
    { id: 1, name: 'alice', amount: 10.5 },
    { id: 2, name: 'bob', amount: 20 },
    { id: 3, name: 'carol "the great"', amount: null },
  ],
  finalQuery: 'SELECT * FROM t LIMIT 3',
};

async function streamToString(s: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of s) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
}

describe('jsonl codec', () => {
  it('encodes a header line followed by one line per row', () => {
    const text = encodeResultToJsonl(RESULT);
    const lines = text.split('\n').filter(Boolean);
    expect(lines).toHaveLength(4); // 1 header + 3 rows
    const header = JSON.parse(lines[0]);
    expect(header).toEqual({
      columns: RESULT.columns,
      types: RESULT.types,
      finalQuery: RESULT.finalQuery,
      rowCount: 3,
    });
    expect(JSON.parse(lines[1])).toEqual(RESULT.rows[0]);
    expect(JSON.parse(lines[3])).toEqual(RESULT.rows[2]); // null + embedded quotes survive
  });

  it('round-trips exactly through decode', () => {
    expect(decodeJsonl(encodeResultToJsonl(RESULT))).toEqual(RESULT);
  });

  it('round-trips through a Readable stream', async () => {
    const text = await streamToString(resultToJsonlStream(RESULT));
    const back = await jsonlStreamToResult(Readable.from([text]));
    expect(back).toEqual(RESULT);
  });

  it('decodeJsonlBounded stops after N rows and reports truncation', () => {
    const text = encodeResultToJsonl(RESULT);
    const bounded = decodeJsonlBounded(text, 2);
    expect(bounded.rows).toHaveLength(2);
    expect(bounded.truncated).toBe(true);
    expect(bounded.totalRows).toBe(3);
    expect(bounded.columns).toEqual(RESULT.columns);
  });

  it('decodeJsonlBounded returns all rows when the cap exceeds the row count', () => {
    const bounded = decodeJsonlBounded(encodeResultToJsonl(RESULT), 100);
    expect(bounded.rows).toHaveLength(3);
    expect(bounded.truncated).toBe(false);
  });

  it('gzip round-trips the JSONL string', async () => {
    const gz = await gzipString(encodeResultToJsonl(RESULT));
    expect(gz).toBeInstanceOf(Buffer);
    const back = decodeJsonl(await gunzipToString(gz));
    expect(back).toEqual(RESULT);
  });

  it('handles an empty result set', () => {
    const empty: QueryResult = { columns: ['x'], types: ['number'], rows: [], finalQuery: 'SELECT 1 WHERE 0' };
    const back = decodeJsonl(encodeResultToJsonl(empty));
    expect(back).toEqual(empty);
    expect(decodeJsonlBounded(encodeResultToJsonl(empty), 5).truncated).toBe(false);
  });
});
