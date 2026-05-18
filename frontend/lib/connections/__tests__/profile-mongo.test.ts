/**
 * Tests for profile-mongo.ts — the Mongo dialect handler for profileDatabase.
 *
 * Each test stubs the `queryFn` (which the mongo connector implements as
 * a JSON `{collection, pipeline}` string) and verifies the enriched
 * SchemaColumn metas come out in ColumnMeta shape.
 */

import { profileDatabase } from '../statistics-engine';
import type { SchemaEntry, QueryResult } from '../base';
import type { Mock } from 'vitest';

function qr(columns: string[], rows: Record<string, unknown>[]): QueryResult {
  return { columns, types: columns.map(() => 'text'), rows, finalQuery: '<test-mongo>' };
}

function findCol(result: SchemaEntry[], tableName: string, colName: string) {
  const table = result.flatMap(s => s.tables).find(t => t.table === tableName);
  return table?.columns.find(c => c.name === colName);
}

describe('profileMongo', () => {
  it('populates nullCount, nDistinct, topValues, and category for a categorical text field', async () => {
    const queryFn = vi.fn<(arg: string) => Promise<QueryResult>>();
    // One $sample pipeline call per collection.
    queryFn.mockResolvedValueOnce(qr(['name', 'tier'], [
      { name: 'a', tier: 'gold' },
      { name: 'b', tier: 'silver' },
      { name: 'c', tier: 'gold' },
      { name: 'd', tier: null },
    ]));

    const input: SchemaEntry[] = [{
      schema: 'mydb',
      tables: [{ table: 'users', columns: [
        { name: 'name', type: 'TEXT' },
        { name: 'tier', type: 'TEXT' },
      ] }],
    }];

    const result = await profileDatabase('mongo', input, queryFn);

    const tier = findCol(result.schema, 'users', 'tier');
    expect(tier?.meta?.nullCount).toBe(1);
    expect(tier?.meta?.nDistinct).toBe(2); // 'gold', 'silver'
    expect(tier?.meta?.category).toBe('categorical');
    expect(tier?.meta?.topValues).toEqual([
      { value: 'gold', count: 2, fraction: 0.5 },
      { value: 'silver', count: 1, fraction: 0.25 },
    ]);
  });

  it('counts missing fields as nulls (Mongo is schemaless)', async () => {
    const queryFn = vi.fn<(arg: string) => Promise<QueryResult>>();
    queryFn.mockResolvedValueOnce(qr(['name', 'optional_field'], [
      { name: 'a', optional_field: 'x' },
      { name: 'b' }, // optional_field missing entirely
      { name: 'c', optional_field: null },
    ]));

    const input: SchemaEntry[] = [{
      schema: 'mydb',
      tables: [{ table: 'users', columns: [
        { name: 'name', type: 'TEXT' },
        { name: 'optional_field', type: 'TEXT' },
      ] }],
    }];

    const result = await profileDatabase('mongo', input, queryFn);
    const opt = findCol(result.schema, 'users', 'optional_field');
    expect(opt?.meta?.nullCount).toBe(2); // 1 missing + 1 explicit null
  });

  it('classifies numeric fields with min/max/avg', async () => {
    const queryFn = vi.fn<(arg: string) => Promise<QueryResult>>();
    queryFn.mockResolvedValueOnce(qr(['name', 'review_count'], [
      { name: 'a', review_count: 10 },
      { name: 'b', review_count: 5 },
      { name: 'c', review_count: 100 },
    ]));

    const input: SchemaEntry[] = [{
      schema: 'mydb',
      tables: [{ table: 'items', columns: [
        { name: 'name', type: 'TEXT' },
        { name: 'review_count', type: 'INTEGER' },
      ] }],
    }];

    const result = await profileDatabase('mongo', input, queryFn);
    const rc = findCol(result.schema, 'items', 'review_count');
    expect(rc?.meta?.category).toBe('numeric');
    expect(rc?.meta?.min).toBe(5);
    expect(rc?.meta?.max).toBe(100);
    expect(rc?.meta?.avg).toBeCloseTo((10 + 5 + 100) / 3, 4);
  });

  it('treats OBJECT and ARRAY fields as category=other (samples carry the shape)', async () => {
    const queryFn = vi.fn<(arg: string) => Promise<QueryResult>>();
    queryFn.mockResolvedValueOnce(qr(['attrs', 'tags'], [
      { attrs: { a: 1 }, tags: ['x', 'y'] },
      { attrs: { b: 2 }, tags: ['x'] },
    ]));

    const input: SchemaEntry[] = [{
      schema: 'mydb',
      tables: [{ table: 'docs', columns: [
        { name: 'attrs', type: 'OBJECT' },
        { name: 'tags', type: 'ARRAY' },
      ] }],
    }];

    const result = await profileDatabase('mongo', input, queryFn);
    expect(findCol(result.schema, 'docs', 'attrs')?.meta?.category).toBe('other');
    expect(findCol(result.schema, 'docs', 'tags')?.meta?.category).toBe('other');
  });

  it('returns plain columns (no meta) for empty collections', async () => {
    const queryFn = vi.fn<(arg: string) => Promise<QueryResult>>();
    queryFn.mockResolvedValueOnce(qr(['name'], []));

    const input: SchemaEntry[] = [{
      schema: 'mydb',
      tables: [{ table: 'empty', columns: [{ name: 'name', type: 'TEXT' }] }],
    }];

    const result = await profileDatabase('mongo', input, queryFn);
    const col = findCol(result.schema, 'empty', 'name');
    expect(col).toBeDefined();
    expect(col?.meta).toBeUndefined();
  });

  it('issues one $sample pipeline per collection', async () => {
    const queryFn = vi.fn<(arg: string) => Promise<QueryResult>>();
    queryFn
      .mockResolvedValueOnce(qr(['a'], [{ a: 1 }]))
      .mockResolvedValueOnce(qr(['b'], [{ b: 2 }]));

    const input: SchemaEntry[] = [{
      schema: 'mydb',
      tables: [
        { table: 'first', columns: [{ name: 'a', type: 'INTEGER' }] },
        { table: 'second', columns: [{ name: 'b', type: 'INTEGER' }] },
      ],
    }];

    await profileDatabase('mongo', input, queryFn);
    expect(queryFn).toHaveBeenCalledTimes(2);

    // Pipeline shape: each call should be a $sample of size N against the right collection.
    const firstCall = JSON.parse((queryFn as Mock).mock.calls[0][0] as string);
    expect(firstCall.collection).toBe('first');
    expect(firstCall.pipeline[0].$sample).toBeDefined();
  });

  it('survives per-collection query errors without crashing the run', async () => {
    const queryFn = vi.fn<(arg: string) => Promise<QueryResult>>();
    queryFn
      .mockRejectedValueOnce(new Error('mongo connection blip'))
      .mockResolvedValueOnce(qr(['b'], [{ b: 2 }, { b: 3 }]));

    const input: SchemaEntry[] = [{
      schema: 'mydb',
      tables: [
        { table: 'broken', columns: [{ name: 'a', type: 'INTEGER' }] },
        { table: 'ok', columns: [{ name: 'b', type: 'INTEGER' }] },
      ],
    }];

    const result = await profileDatabase('mongo', input, queryFn);

    // broken table comes back unenriched (plain columns)
    const broken = findCol(result.schema, 'broken', 'a');
    expect(broken).toBeDefined();
    expect(broken?.meta).toBeUndefined();

    // ok table is still enriched
    const ok = findCol(result.schema, 'ok', 'b');
    expect(ok?.meta?.category).toBe('numeric');
  });
});
