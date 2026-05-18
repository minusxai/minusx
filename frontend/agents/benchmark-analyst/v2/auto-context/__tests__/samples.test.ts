/**
 * Tests for samples.ts — pulling representative rows from a table and
 * narrowing them down to a length-diverse subset that surfaces format
 * variants in narrative text columns.
 *
 * `pickDiverseRows` is pure (sort + index pick); `fetchTableSample` is
 * exercised against a mocked NodeConnector.
 */

import { describe, it, expect, vi } from 'vitest';
import type { NodeConnector, QueryResult } from '@/lib/connections/base';
import { pickDiverseRows, fetchTableSample } from '../samples';

const row = (
  id: number,
  description: string,
  status: string = 'active',
): Record<string, unknown> => ({ id, description, status });

const qr = (rows: Record<string, unknown>[]): QueryResult => ({
  columns: Object.keys(rows[0] ?? {}),
  types: Object.keys(rows[0] ?? {}).map(() => 'TEXT'),
  rows,
  finalQuery: '<test>',
});

describe('pickDiverseRows', () => {
  it('returns the whole pool when pool size is <= n', () => {
    const pool = [row(1, 'a'), row(2, 'b')];
    expect(pickDiverseRows(pool, 5, ['description'])).toEqual(pool);
  });

  it('returns n random-ordered rows when no text columns are flagged', () => {
    const pool = [row(1, 'a'), row(2, 'bb'), row(3, 'ccc'), row(4, 'dddd'), row(5, 'eeeee')];
    expect(pickDiverseRows(pool, 3, [])).toHaveLength(3);
  });

  it('picks rows that span the length range of the flagged column', () => {
    // Description lengths: 1, 5, 50, 200, 400. Asking for 3 → should cover the extremes.
    const pool = [
      row(1, 'x'),
      row(2, 'small'),
      row(3, 'a'.repeat(50)),
      row(4, 'a'.repeat(200)),
      row(5, 'a'.repeat(400)),
    ];
    const out = pickDiverseRows(pool, 3, ['description']);
    expect(out).toHaveLength(3);

    const lengths = out
      .map((r) => (typeof r.description === 'string' ? r.description.length : 0))
      .sort((a, b) => a - b);
    // The shortest and longest must both be represented in a length-stratified pick.
    expect(lengths[0]).toBe(1);
    expect(lengths[lengths.length - 1]).toBe(400);
  });

  it('handles missing values in the flagged column gracefully', () => {
    const pool = [{ id: 1 }, row(2, 'b'), row(3, 'ccc')];
    expect(pickDiverseRows(pool, 2, ['description'])).toHaveLength(2);
  });

  it('returns empty array when pool is empty', () => {
    expect(pickDiverseRows([], 5, ['description'])).toEqual([]);
  });
});

describe('fetchTableSample', () => {
  const fakeConn = (rows: Record<string, unknown>[]): NodeConnector =>
    ({
      query: vi.fn(async () => qr(rows)),
    }) as unknown as NodeConnector;

  it('returns rows from the connector via dialect-correct sampling SQL', async () => {
    const rows = [row(1, 'short'), row(2, 'longer description here')];
    const conn = fakeConn(rows);
    const out = await fetchTableSample(conn, 'public', 'orders', 'duckdb', [], { sampleSize: 2 });
    expect(out).toEqual(rows);
  });

  it('issues a $sample pipeline for mongo connections', async () => {
    const conn = fakeConn([row(1, 'x')]);
    await fetchTableSample(conn, 'mydb', 'users', 'mongo', [], { sampleSize: 1 });
    const queryArg = (conn.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    const parsed = JSON.parse(queryArg);
    expect(parsed.collection).toBe('users');
    expect(parsed.pipeline?.[0]?.$sample).toBeDefined();
  });

  it('narrows down the supersample to the requested size when text columns are flagged', async () => {
    // Connector returns 20 rows; we ask for 5 with one text column flagged.
    const big = Array.from({ length: 20 }, (_, i) => row(i, 'x'.repeat((i + 1) * 3)));
    const conn = fakeConn(big);
    const out = await fetchTableSample(conn, 'public', 'docs', 'duckdb', ['description'], {
      sampleSize: 5,
      superSampleSize: 20,
    });
    expect(out).toHaveLength(5);
  });

  it('returns empty array on connector errors', async () => {
    const conn = {
      query: vi.fn(async () => {
        throw new Error('boom');
      }),
    } as unknown as NodeConnector;
    expect(await fetchTableSample(conn, 'public', 't', 'duckdb', [])).toEqual([]);
  });
});
