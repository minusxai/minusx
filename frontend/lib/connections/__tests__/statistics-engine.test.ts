/**
 * Tests for statistics-engine.ts
 *
 * Tests each profiling strategy with mock queryFn.
 * Output is now SchemaEntry[] with meta on columns (enriched schema).
 */

import { profileDatabase } from '../statistics-engine';
import type { SchemaEntry, SchemaColumn, QueryResult } from '../base';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PG_STATS_COLS = ['schema_name', 'table_name', 'column_name', 'null_frac', 'n_distinct', 'most_common_vals', 'most_common_freqs', 'histogram_bounds', 'description'];

function qr(columns: string[], rows: Record<string, unknown>[]): QueryResult {
  return { columns, types: columns.map(() => 'text'), rows };
}

function schema(entries: SchemaEntry[]): SchemaEntry[] { return entries; }

function pgRow(overrides: Record<string, unknown>) {
  return {
    schema_name: 'public', table_name: 'orders',
    null_frac: 0, n_distinct: 0,
    most_common_vals: null, most_common_freqs: null,
    histogram_bounds: null, description: null,
    ...overrides,
  };
}

/** Get a table's columns from the result by schema + table name */
function getTable(result: { schema: SchemaEntry[] }, schemaName: string, tableName: string): SchemaColumn[] {
  const s = result.schema.find(s => s.schema === schemaName);
  const t = s?.tables.find(t => t.table === tableName);
  return t?.columns ?? [];
}

function getCol(cols: SchemaColumn[], name: string) { return cols.find(c => c.name === name); }

// ─── PostgreSQL ──────────────────────────────────────────────────────────────

describe('profilePostgres', () => {
  function mockPg(queryFn: jest.Mock, rowCount: number, statsRows: Record<string, unknown>[]) {
    queryFn.mockResolvedValueOnce(qr(['schema_name', 'table_name', 'row_count'], [{ schema_name: 'public', table_name: 'orders', row_count: rowCount }]));
    queryFn.mockResolvedValueOnce(qr(PG_STATS_COLS, statsRows));
  }

  it('makes exactly 2 queries for the entire database', async () => {
    const queryFn = jest.fn<Promise<QueryResult>, [string]>();
    mockPg(queryFn, 1000, [pgRow({ column_name: 'id', n_distinct: -1.0 })]);
    const result = await profileDatabase('postgresql', schema([{ schema: 'public', tables: [{ table: 'orders', columns: [{ name: 'id', type: 'integer' }] }] }]), queryFn);
    expect(result.queryCount).toBe(2);
  });

  it('classifies columns — numeric stays numeric even with low cardinality', async () => {
    const queryFn = jest.fn<Promise<QueryResult>, [string]>();
    mockPg(queryFn, 1000, [
      pgRow({ column_name: 'id', n_distinct: -1.0 }),
      pgRow({ column_name: 'status', n_distinct: 4, most_common_vals: '{a,b,c,d}', most_common_freqs: '{0.4,0.3,0.2,0.1}' }),
      pgRow({ column_name: 'created_at', n_distinct: -0.95 }),
      pgRow({ column_name: 'total', n_distinct: 200 }),
      pgRow({ column_name: 'priority', n_distinct: 5 }),
    ]);

    const s = schema([{ schema: 'public', tables: [{ table: 'orders', columns: [
      { name: 'id', type: 'integer' }, { name: 'status', type: 'text' },
      { name: 'created_at', type: 'timestamp' }, { name: 'total', type: 'numeric' },
      { name: 'priority', type: 'integer' },
    ] }] }]);

    const result = await profileDatabase('postgresql', s, queryFn);
    const cols = getTable(result, 'public', 'orders');

    expect(getCol(cols, 'id')?.meta?.category).toBe('other');        // id_unique → other
    expect(getCol(cols, 'status')?.meta?.category).toBe('categorical');
    expect(getCol(cols, 'created_at')?.meta?.category).toBe('temporal');
    expect(getCol(cols, 'total')?.meta?.category).toBe('numeric');
    expect(getCol(cols, 'priority')?.meta?.category).toBe('numeric'); // integer stays numeric
  });

  it('parses topValues for text categoricals', async () => {
    const queryFn = jest.fn<Promise<QueryResult>, [string]>();
    mockPg(queryFn, 1000, [pgRow({ column_name: 'status', n_distinct: 3, most_common_vals: '{pending,shipped,delivered}', most_common_freqs: '{0.5,0.3,0.2}', description: 'Order status' })]);

    const s = schema([{ schema: 'public', tables: [{ table: 'orders', columns: [{ name: 'status', type: 'text' }] }] }]);
    const result = await profileDatabase('postgresql', s, queryFn);
    const col = getCol(getTable(result, 'public', 'orders'), 'status');

    expect(col?.meta?.topValues).toHaveLength(3);
    expect(col?.meta?.topValues![0]).toEqual({ value: 'pending', count: 500, fraction: 0.5 });
    expect(col?.meta?.description).toBe('Order status');
  });

  it('extracts min/max from histogram_bounds for numeric', async () => {
    const queryFn = jest.fn<Promise<QueryResult>, [string]>();
    mockPg(queryFn, 1000, [pgRow({ column_name: 'total', n_distinct: 200, histogram_bounds: '{1.50,50.00,999.99}' })]);

    const s = schema([{ schema: 'public', tables: [{ table: 'orders', columns: [{ name: 'total', type: 'numeric' }] }] }]);
    const result = await profileDatabase('postgresql', s, queryFn);
    const col = getCol(getTable(result, 'public', 'orders'), 'total');

    expect(col?.meta?.min).toBe(1.5);
    expect(col?.meta?.max).toBe(999.99);
  });

  it('extracts minDate/maxDate from histogram_bounds for temporal', async () => {
    const queryFn = jest.fn<Promise<QueryResult>, [string]>();
    mockPg(queryFn, 1000, [pgRow({ column_name: 'created_at', n_distinct: -0.95, histogram_bounds: '{2020-01-01,2021-06-15,2023-12-31}' })]);

    const s = schema([{ schema: 'public', tables: [{ table: 'orders', columns: [{ name: 'created_at', type: 'timestamp' }] }] }]);
    const result = await profileDatabase('postgresql', s, queryFn);
    const col = getCol(getTable(result, 'public', 'orders'), 'created_at');

    expect(col?.meta?.minDate).toBe('2020-01-01');
    expect(col?.meta?.maxDate).toBe('2023-12-31');
  });

  it('no topValues for low-cardinality numeric', async () => {
    const queryFn = jest.fn<Promise<QueryResult>, [string]>();
    mockPg(queryFn, 1000, [pgRow({ column_name: 'priority', n_distinct: 5, most_common_vals: '{1,2,3,4,5}', most_common_freqs: '{0.3,0.25,0.2,0.15,0.1}', histogram_bounds: '{1,2,3,4,5}' })]);

    const s = schema([{ schema: 'public', tables: [{ table: 'orders', columns: [{ name: 'priority', type: 'integer' }] }] }]);
    const result = await profileDatabase('postgresql', s, queryFn);
    const col = getCol(getTable(result, 'public', 'orders'), 'priority');

    expect(col?.meta?.category).toBe('numeric');
    expect(col?.meta?.topValues).toBeUndefined();
    expect(col?.meta?.min).toBe(1);
    expect(col?.meta?.max).toBe(5);
  });

  it('skips tables when pg_stats is empty', async () => {
    const queryFn = jest.fn<Promise<QueryResult>, [string]>();
    mockPg(queryFn, 1000, []);
    const s = schema([{ schema: 'public', tables: [{ table: 'orders', columns: [{ name: 'id', type: 'integer' }] }] }]);
    const result = await profileDatabase('postgresql', s, queryFn);
    expect(result.schema).toHaveLength(0);
  });

  it('batches across schemas and tables — still 2 queries', async () => {
    const queryFn = jest.fn<Promise<QueryResult>, [string]>();
    queryFn.mockResolvedValueOnce(qr(['schema_name', 'table_name', 'row_count'], [
      { schema_name: 'public', table_name: 'users', row_count: 100 },
      { schema_name: 'public', table_name: 'orders', row_count: 500 },
    ]));
    queryFn.mockResolvedValueOnce(qr(PG_STATS_COLS, [
      pgRow({ table_name: 'users', column_name: 'id', n_distinct: -1.0 }),
      pgRow({ table_name: 'orders', column_name: 'id', n_distinct: -1.0 }),
    ]));

    const s = schema([{ schema: 'public', tables: [
      { table: 'users', columns: [{ name: 'id', type: 'integer' }] },
      { table: 'orders', columns: [{ name: 'id', type: 'integer' }] },
    ] }]);

    const result = await profileDatabase('postgresql', s, queryFn);
    expect(result.queryCount).toBe(2);
    expect(result.schema[0].tables).toHaveLength(2);
  });
});

// ─── DuckDB ──────────────────────────────────────────────────────────────────

describe('profileDuckDb', () => {
  it('enriches columns with meta from SUMMARIZE + comments', async () => {
    const queryFn = jest.fn<Promise<QueryResult>, [string]>();

    // comments
    queryFn.mockResolvedValueOnce(qr(['schema_name', 'table_name', 'column_name', 'comment'], [
      { schema_name: 'main', table_name: 'products', column_name: 'category', comment: 'Product category' },
    ]));
    // SUMMARIZE
    queryFn.mockResolvedValueOnce(qr(
      ['column_name', 'column_type', 'min', 'max', 'approx_unique', 'avg', 'std', 'q25', 'q50', 'q75', 'count', 'null_percentage'],
      [
        { column_name: 'id', column_type: 'INTEGER', min: '1', max: '1000', approx_unique: 1000, avg: 500, std: null, q25: null, q50: null, q75: null, count: 1000, null_percentage: 0 },
        { column_name: 'category', column_type: 'VARCHAR', min: 'A', max: 'Z', approx_unique: 5, avg: null, std: null, q25: null, q50: null, q75: null, count: 1000, null_percentage: 2 },
        { column_name: 'price', column_type: 'DOUBLE', min: '1.99', max: '999.99', approx_unique: 200, avg: 49.99, std: null, q25: null, q50: null, q75: null, count: 1000, null_percentage: 0 },
      ],
    ));
    // top values for category
    queryFn.mockResolvedValueOnce(qr(['val', 'cnt'], [
      { val: 'Electronics', cnt: 400 }, { val: 'Clothing', cnt: 300 },
    ]));

    const s = schema([{ schema: 'main', tables: [{ table: 'products', columns: [
      { name: 'id', type: 'INTEGER' }, { name: 'category', type: 'VARCHAR' }, { name: 'price', type: 'DOUBLE' },
    ] }] }]);

    const result = await profileDatabase('duckdb', s, queryFn);
    expect(result.queryCount).toBe(3);

    const cols = getTable(result, 'main', 'products');
    expect(getCol(cols, 'id')?.meta?.category).toBe('other');
    expect(getCol(cols, 'category')?.meta?.category).toBe('categorical');
    expect(getCol(cols, 'category')?.meta?.description).toBe('Product category');
    expect(getCol(cols, 'category')?.meta?.topValues).toHaveLength(2);
    expect(getCol(cols, 'price')?.meta?.category).toBe('numeric');
    expect(getCol(cols, 'price')?.meta?.min).toBe(1.99);
    expect(getCol(cols, 'price')?.meta?.max).toBe(999.99);
  });

  it('clamps nDistinct to rowCount', async () => {
    const queryFn = jest.fn<Promise<QueryResult>, [string]>();
    queryFn.mockResolvedValueOnce(qr(['schema_name', 'table_name', 'column_name', 'comment'], []));
    queryFn.mockResolvedValueOnce(qr(
      ['column_name', 'column_type', 'min', 'max', 'approx_unique', 'avg', 'std', 'q25', 'q50', 'q75', 'count', 'null_percentage'],
      [{ column_name: 'ts', column_type: 'TIMESTAMP', min: '2020-01-01', max: '2024-12-31', approx_unique: 3231, avg: null, std: null, q25: null, q50: null, q75: null, count: 2652, null_percentage: 0 }],
    ));

    const s = schema([{ schema: 'main', tables: [{ table: 't', columns: [{ name: 'ts', type: 'TIMESTAMP' }] }] }]);
    const result = await profileDatabase('duckdb', s, queryFn);
    const col = getCol(getTable(result, 'main', 't'), 'ts');

    // Temporal → nDistinct not exposed, but internally clamped (no crash)
    expect(col?.meta?.category).toBe('temporal');
  });

  it('routes csv and google-sheets to DuckDB strategy', async () => {
    for (const connType of ['csv', 'google-sheets']) {
      const queryFn = jest.fn<Promise<QueryResult>, [string]>();
      queryFn.mockResolvedValueOnce(qr(['schema_name', 'table_name', 'column_name', 'comment'], []));
      queryFn.mockResolvedValueOnce(qr(
        ['column_name', 'column_type', 'min', 'max', 'approx_unique', 'avg', 'std', 'q25', 'q50', 'q75', 'count', 'null_percentage'],
        [{ column_name: 'id', column_type: 'INTEGER', min: '1', max: '10', approx_unique: 10, avg: 5, std: null, q25: null, q50: null, q75: null, count: 10, null_percentage: 0 }],
      ));

      const s = schema([{ schema: 'main', tables: [{ table: 't', columns: [{ name: 'id', type: 'INTEGER' }] }] }]);
      const result = await profileDatabase(connType, s, queryFn);
      expect(result.connectorType).toBe(connType);
      expect(queryFn.mock.calls.some(([sql]: [string]) => sql.includes('SUMMARIZE'))).toBe(true);
    }
  });
});

// ─── BigQuery ────────────────────────────────────────────────────────────────

describe('profileBigQuery', () => {
  it('only adds descriptions to columns that have them — no scans', async () => {
    const queryFn = jest.fn<Promise<QueryResult>, [string]>();
    queryFn.mockResolvedValueOnce(qr(['table_name', 'column_name', 'description'], [
      { table_name: 'events', column_name: 'event_type', description: 'Type of user event' },
    ]));

    const s = schema([{ schema: 'ds', tables: [{ table: 'events', columns: [
      { name: 'event_id', type: 'STRING' }, { name: 'event_type', type: 'STRING' },
    ] }] }]);

    const result = await profileDatabase('bigquery', s, queryFn);
    expect(result.queryCount).toBe(1);

    const cols = getTable(result, 'ds', 'events');
    expect(getCol(cols, 'event_id')?.meta).toBeUndefined();       // no description → no meta
    expect(getCol(cols, 'event_type')?.meta?.description).toBe('Type of user event');
  });

  it('batches descriptions across tables in same dataset', async () => {
    const queryFn = jest.fn<Promise<QueryResult>, [string]>();
    queryFn.mockResolvedValueOnce(qr(['table_name', 'column_name', 'description'], []));

    const s = schema([{ schema: 'ds', tables: [
      { table: 'a', columns: [{ name: 'x', type: 'INT64' }] },
      { table: 'b', columns: [{ name: 'y', type: 'STRING' }] },
    ] }]);

    const result = await profileDatabase('bigquery', s, queryFn);
    expect(result.queryCount).toBe(1); // 1 per dataset
    expect(result.schema[0].tables).toHaveLength(2);
  });

  it('uses backtick quoting', async () => {
    const queryFn = jest.fn<Promise<QueryResult>, [string]>();
    queryFn.mockResolvedValueOnce(qr(['table_name', 'column_name', 'description'], []));

    const s = schema([{ schema: 'ds', tables: [{ table: 't', columns: [{ name: 'x', type: 'INT64' }] }] }]);
    await profileDatabase('bigquery', s, queryFn);

    for (const [sql] of queryFn.mock.calls) {
      expect(sql).toContain('`');
    }
  });
});

// ─── Edge Cases ──────────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('returns empty schema for empty input', async () => {
    const queryFn = jest.fn<Promise<QueryResult>, [string]>();
    const result = await profileDatabase('postgresql', [], queryFn);
    expect(result.schema).toHaveLength(0);
  });

  it('handles query errors gracefully', async () => {
    const queryFn = jest.fn<Promise<QueryResult>, [string]>().mockRejectedValue(new Error('fail'));
    const s = schema([{ schema: 'main', tables: [{ table: 't', columns: [{ name: 'x', type: 'INTEGER' }] }] }]);
    const result = await profileDatabase('duckdb', s, queryFn);
    expect(result.schema).toHaveLength(0);
  });

  it('meta only contains relevant fields per category', async () => {
    const queryFn = jest.fn<Promise<QueryResult>, [string]>();
    queryFn.mockResolvedValueOnce(qr(['schema_name', 'table_name', 'row_count'], [{ schema_name: 'public', table_name: 't', row_count: 100 }]));
    queryFn.mockResolvedValueOnce(qr(PG_STATS_COLS, [
      pgRow({ table_name: 't', column_name: 'x', n_distinct: 4 }),
    ]));

    const s = schema([{ schema: 'public', tables: [{ table: 't', columns: [{ name: 'x', type: 'text' }] }] }]);
    const result = await profileDatabase('postgresql', s, queryFn);
    const col = getCol(getTable(result, 'public', 't'), 'x');

    // Categorical text column should have nDistinct but not min/max
    expect(col?.meta?.category).toBe('categorical');
    expect(col?.meta?.nDistinct).toBe(4);
    expect(col?.meta?.min).toBeUndefined();
    expect(col?.meta?.max).toBeUndefined();
  });
});
