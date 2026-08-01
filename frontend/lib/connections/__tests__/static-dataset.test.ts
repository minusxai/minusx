/**
 * Static-dataset entries in the CSV connector.
 *
 * A `dataset` entry points at a published, read-only dataset
 * (`${STATIC_DATASETS_BASE_URL}/${dataset}/${table_name}.parquet`) instead of an
 * uploaded object. Two properties are load-bearing and pinned here:
 *
 * 1. The URL is built ONLY from validated identifiers — `dataset` and `table_name`
 *    become URL path segments, so anything but [A-Za-z0-9_-] must throw. The base
 *    comes from server config, never from the connection document.
 *
 * 2. Static entries are MATERIALIZED (`CREATE TABLE AS`), not views. A view
 *    re-fetches the file on every query — the exact bug that made the sample-data
 *    dashboard time out: 11 concurrent queries each re-reading parquet over the
 *    network. The materialization test proves it by deleting the source file after
 *    init: queries must still answer, because the rows live in the instance.
 */
import { mkdirSync, rmSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { DuckDBInstance } from '@duckdb/node-api';

const BASE_DIR = join(tmpdir(), `mx-static-datasets-test-${process.pid}`);

vi.mock('@/lib/config', () => ({
  OBJECT_STORE_BUCKET: undefined,
  OBJECT_STORE_REGION: 'us-east-1',
  OBJECT_STORE_ACCESS_KEY_ID: undefined,
  OBJECT_STORE_SECRET_ACCESS_KEY: undefined,
  OBJECT_STORE_ENDPOINT: undefined,
  LOCAL_UPLOAD_PATH: join(tmpdir(), 'mx-static-datasets-test-uploads'),
  STATIC_DATASETS_BASE_URL: join(tmpdir(), `mx-static-datasets-test-${process.pid}`),
}));

vi.mock('@/lib/object-store', () => ({
  resolveObjectKey: async (key: string) => key,
}));

import { CsvConnector, staticFileUrl, createRelationSql } from '../csv-connector';

function entry(overrides: Record<string, unknown> = {}) {
  return {
    table_name: 'orders',
    schema_name: 'demo',
    dataset: 'mxfood',
    file_format: 'parquet' as const,
    row_count: 3,
    columns: [
      { name: 'id', type: 'BIGINT' },
      { name: 'item', type: 'VARCHAR' },
    ],
    ...overrides,
  };
}

describe('staticFileUrl', () => {
  it('builds ${base}/${dataset}/${table}.parquet', () => {
    expect(staticFileUrl(entry() as never, 'https://example.com/datasets'))
      .toBe('https://example.com/datasets/mxfood/orders.parquet');
  });

  it('trims trailing slashes on the base', () => {
    expect(staticFileUrl(entry() as never, 'https://example.com/datasets/'))
      .toBe('https://example.com/datasets/mxfood/orders.parquet');
  });

  it.each([
    ['dataset with a slash', { dataset: 'a/b' }],
    ['dataset with dots', { dataset: '..' }],
    ['dataset with a quote', { dataset: "x'y" }],
    ['empty dataset', { dataset: '' }],
    ['table with a slash', { table_name: 'a/b' }],
    ['table with dots', { table_name: '../../etc' }],
  ])('rejects %s', (_label, bad) => {
    expect(() => staticFileUrl(entry(bad) as never, 'https://example.com')).toThrow();
  });

  it('rejects non-parquet formats — published datasets are parquet-only', () => {
    expect(() => staticFileUrl(entry({ file_format: 'csv' }) as never, 'https://example.com')).toThrow();
  });
});

describe('createRelationSql', () => {
  it('materializes a static entry as a TABLE', () => {
    const sql = createRelationSql(entry() as never, 'https://example.com/mxfood/orders.parquet');
    expect(sql).toMatch(/^CREATE OR REPLACE TABLE "demo"\."orders" AS SELECT \* FROM read_parquet/);
  });

  it('keeps an uploaded-object entry as a VIEW', () => {
    const sql = createRelationSql(
      entry({ dataset: undefined, s3_key: 'csvs/org/static/abc.parquet' }) as never,
      '/uploads/csvs/org/static/abc.parquet',
    );
    expect(sql).toMatch(/^CREATE OR REPLACE VIEW "demo"\."orders" AS SELECT \* FROM read_parquet/);
  });
});

describe('CsvConnector with static entries (integration)', () => {
  beforeAll(async () => {
    mkdirSync(join(BASE_DIR, 'mxfood'), { recursive: true });
    const instance = await DuckDBInstance.create(':memory:');
    const conn = await instance.connect();
    await conn.run(
      `COPY (SELECT * FROM (VALUES (1, 'burger'), (2, 'fries'), (3, 'shake')) t(id, item))
       TO '${join(BASE_DIR, 'mxfood', 'orders.parquet')}' (FORMAT PARQUET)`,
    );
    conn.closeSync();
    instance.closeSync();
  });

  afterAll(() => {
    rmSync(BASE_DIR, { recursive: true, force: true });
  });

  it('queries a static entry, and still answers after the source file is gone', async () => {
    const connector = new CsvConnector('static-test', { files: [entry()] });

    const first = await connector.query('SELECT count(*) AS n FROM demo.orders');
    expect(first.rows[0].n).toBe(3);

    // The proof of materialization: remove the source. A view would now fail with
    // an IO error on every query; a table keeps answering from instance memory.
    unlinkSync(join(BASE_DIR, 'mxfood', 'orders.parquet'));

    const second = await connector.query("SELECT item FROM demo.orders WHERE id = 2");
    expect(second.rows).toEqual([{ item: 'fries' }]);
  });

  it('reports schema from config without touching the source', async () => {
    const connector = new CsvConnector('static-test-schema', { files: [entry()] });
    const schema = await connector.getSchema();
    expect(schema).toEqual([
      {
        schema: 'demo',
        tables: [{ table: 'orders', columns: entry().columns }],
      },
    ]);
  });
});
