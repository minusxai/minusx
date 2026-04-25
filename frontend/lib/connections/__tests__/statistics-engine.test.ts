/**
 * Tests for statistics-engine.ts
 *
 * Tests each profiling strategy with mock queryFn returning canned SQL results.
 * Verifies: column classification, query count (batching), description extraction,
 * top-value parsing, min/max from histogram_bounds, nDistinct clamping, and type preservation.
 */

import { profileDatabase } from '../statistics-engine';
import type { SchemaEntry, QueryResult } from '../base';

// ─── Test Helpers ────────────────────────────────────────────────────────────

const PG_STATS_COLS = ['schema_name', 'table_name', 'column_name', 'null_frac', 'n_distinct', 'most_common_vals', 'most_common_freqs', 'histogram_bounds', 'description'];

function makeQueryResult(columns: string[], rows: Record<string, unknown>[]): QueryResult {
  return { columns, types: columns.map(() => 'text'), rows };
}

function makeSchema(entries: Array<{ schema: string; tables: Array<{ table: string; columns: Array<{ name: string; type: string }> }> }>): SchemaEntry[] {
  return entries;
}

function pgStatsRow(overrides: Record<string, unknown>) {
  return {
    schema_name: 'public', table_name: 'orders',
    null_frac: 0, n_distinct: 0,
    most_common_vals: null, most_common_freqs: null,
    histogram_bounds: null, description: null,
    ...overrides,
  };
}

// ─── PostgreSQL Strategy ─────────────────────────────────────────────────────

describe('profilePostgres', () => {
  const schema = makeSchema([{
    schema: 'public',
    tables: [{
      table: 'orders',
      columns: [
        { name: 'id', type: 'integer' },
        { name: 'status', type: 'text' },
        { name: 'created_at', type: 'timestamp' },
        { name: 'total', type: 'numeric' },
        { name: 'is_active', type: 'boolean' },
        { name: 'user_uuid', type: 'uuid' },
        { name: 'priority', type: 'integer' },
      ],
    }],
  }]);

  function mockPgQueries(queryFn: jest.Mock, rowCount: number, statsRows: Record<string, unknown>[]) {
    queryFn.mockResolvedValueOnce(makeQueryResult(
      ['schema_name', 'table_name', 'row_count'],
      [{ schema_name: 'public', table_name: 'orders', row_count: rowCount }],
    ));
    queryFn.mockResolvedValueOnce(makeQueryResult(PG_STATS_COLS, statsRows));
  }

  it('makes exactly 2 queries for the entire database', async () => {
    const queryFn = jest.fn<Promise<QueryResult>, [string]>();
    mockPgQueries(queryFn, 1000, [
      pgStatsRow({ column_name: 'id', n_distinct: -1.0, description: 'Primary key' }),
      pgStatsRow({ column_name: 'status', n_distinct: 4, most_common_vals: '{pending,shipped,delivered,cancelled}', most_common_freqs: '{0.4,0.3,0.2,0.1}' }),
      pgStatsRow({ column_name: 'created_at', n_distinct: -0.95 }),
      pgStatsRow({ column_name: 'total', n_distinct: 200, histogram_bounds: '{1.5,50.0,100.0,500.0,999.99}' }),
      pgStatsRow({ column_name: 'is_active', n_distinct: 2 }),
      pgStatsRow({ column_name: 'user_uuid', n_distinct: -0.8 }),
      pgStatsRow({ column_name: 'priority', n_distinct: 5, histogram_bounds: '{1,2,3,4,5}' }),
    ]);

    const result = await profileDatabase('postgresql', schema, queryFn);
    expect(result.queryCount).toBe(2);
    expect(result.connectorType).toBe('postgresql');
  });

  it('classifies columns correctly — numeric stays numeric even with low cardinality', async () => {
    const queryFn = jest.fn<Promise<QueryResult>, [string]>();
    mockPgQueries(queryFn, 1000, [
      pgStatsRow({ column_name: 'id', n_distinct: -1.0 }),
      pgStatsRow({ column_name: 'status', n_distinct: 4, most_common_vals: '{a,b,c,d}', most_common_freqs: '{0.4,0.3,0.2,0.1}' }),
      pgStatsRow({ column_name: 'created_at', n_distinct: -0.95 }),
      pgStatsRow({ column_name: 'total', n_distinct: 200 }),
      pgStatsRow({ column_name: 'is_active', n_distinct: 2 }),
      pgStatsRow({ column_name: 'user_uuid', n_distinct: -0.9 }),
      pgStatsRow({ column_name: 'priority', n_distinct: 5 }), // integer with only 5 values — should be numeric, NOT categorical
    ]);

    const result = await profileDatabase('postgresql', schema, queryFn);
    const byName = Object.fromEntries(result.tables[0].columns.map(c => [c.name, c]));

    expect(byName.id.classification).toBe('id_unique');
    expect(byName.status.classification).toBe('categorical');  // text + low cardinality
    expect(byName.created_at.classification).toBe('temporal');
    expect(byName.total.classification).toBe('numeric');
    expect(byName.is_active.classification).toBe('boolean');
    expect(byName.user_uuid.classification).toBe('id_unique');
    expect(byName.priority.classification).toBe('numeric');    // integer stays numeric even with 5 distinct
  });

  it('parses most_common_vals into topValues for text categoricals only', async () => {
    const queryFn = jest.fn<Promise<QueryResult>, [string]>();
    mockPgQueries(queryFn, 1000, [
      pgStatsRow({ column_name: 'status', n_distinct: 3, most_common_vals: '{pending,shipped,delivered}', most_common_freqs: '{0.5,0.3,0.2}', description: 'Order status' }),
    ]);

    const smallSchema = makeSchema([{
      schema: 'public',
      tables: [{ table: 'orders', columns: [{ name: 'status', type: 'text' }] }],
    }]);

    const result = await profileDatabase('postgresql', smallSchema, queryFn);
    const status = result.tables[0].columns[0];

    expect(status.topValues).toHaveLength(3);
    expect(status.topValues![0]).toEqual({ value: 'pending', count: 500, fraction: 0.5 });
    expect(status.topValues![1]).toEqual({ value: 'shipped', count: 300, fraction: 0.3 });
    expect(status.topValues![2]).toEqual({ value: 'delivered', count: 200, fraction: 0.2 });
    expect(status.description).toBe('Order status');
  });

  it('extracts min/max from histogram_bounds for numeric columns', async () => {
    const queryFn = jest.fn<Promise<QueryResult>, [string]>();
    mockPgQueries(queryFn, 1000, [
      pgStatsRow({ column_name: 'total', n_distinct: 200, histogram_bounds: '{1.50,25.00,50.00,75.00,999.99}' }),
    ]);

    const smallSchema = makeSchema([{
      schema: 'public',
      tables: [{ table: 'orders', columns: [{ name: 'total', type: 'numeric' }] }],
    }]);

    const result = await profileDatabase('postgresql', smallSchema, queryFn);
    const total = result.tables[0].columns[0];

    expect(total.classification).toBe('numeric');
    expect(total.min).toBe(1.5);
    expect(total.max).toBe(999.99);
  });

  it('extracts min/max from histogram_bounds for temporal columns', async () => {
    const queryFn = jest.fn<Promise<QueryResult>, [string]>();
    mockPgQueries(queryFn, 1000, [
      pgStatsRow({ column_name: 'created_at', n_distinct: -0.95, histogram_bounds: '{2020-01-01,2021-06-15,2023-12-31}' }),
    ]);

    const smallSchema = makeSchema([{
      schema: 'public',
      tables: [{ table: 'orders', columns: [{ name: 'created_at', type: 'timestamp' }] }],
    }]);

    const result = await profileDatabase('postgresql', smallSchema, queryFn);
    const createdAt = result.tables[0].columns[0];

    expect(createdAt.classification).toBe('temporal');
    expect(createdAt.minDate).toBe('2020-01-01');
    expect(createdAt.maxDate).toBe('2023-12-31');
  });

  it('does not produce topValues for low-cardinality numeric columns', async () => {
    const queryFn = jest.fn<Promise<QueryResult>, [string]>();
    mockPgQueries(queryFn, 1000, [
      pgStatsRow({ column_name: 'priority', n_distinct: 5, most_common_vals: '{1,2,3,4,5}', most_common_freqs: '{0.3,0.25,0.2,0.15,0.1}', histogram_bounds: '{1,2,3,4,5}' }),
    ]);

    const smallSchema = makeSchema([{
      schema: 'public',
      tables: [{ table: 'orders', columns: [{ name: 'priority', type: 'integer' }] }],
    }]);

    const result = await profileDatabase('postgresql', smallSchema, queryFn);
    const priority = result.tables[0].columns[0];

    expect(priority.classification).toBe('numeric');
    expect(priority.topValues).toBeUndefined(); // numeric — no top values
    expect(priority.min).toBe(1);
    expect(priority.max).toBe(5);
  });

  it('skips tables when pg_stats is empty (ANALYZE not run)', async () => {
    const queryFn = jest.fn<Promise<QueryResult>, [string]>();
    mockPgQueries(queryFn, 1000, []);

    const result = await profileDatabase('postgresql', schema, queryFn);
    expect(result.queryCount).toBe(2);
    expect(result.tables).toHaveLength(0);
  });

  it('batches across multiple schemas and tables', async () => {
    const multiSchema = makeSchema([
      {
        schema: 'public',
        tables: [
          { table: 'users', columns: [{ name: 'id', type: 'integer' }] },
          { table: 'orders', columns: [{ name: 'id', type: 'integer' }] },
        ],
      },
      {
        schema: 'analytics',
        tables: [
          { table: 'events', columns: [{ name: 'id', type: 'integer' }] },
        ],
      },
    ]);

    const queryFn = jest.fn<Promise<QueryResult>, [string]>();

    queryFn.mockResolvedValueOnce(makeQueryResult(
      ['schema_name', 'table_name', 'row_count'],
      [
        { schema_name: 'public', table_name: 'users', row_count: 100 },
        { schema_name: 'public', table_name: 'orders', row_count: 500 },
        { schema_name: 'analytics', table_name: 'events', row_count: 10000 },
      ],
    ));

    queryFn.mockResolvedValueOnce(makeQueryResult(PG_STATS_COLS, [
      pgStatsRow({ schema_name: 'public', table_name: 'users', column_name: 'id', n_distinct: -1.0 }),
      pgStatsRow({ schema_name: 'public', table_name: 'orders', column_name: 'id', n_distinct: -1.0 }),
      pgStatsRow({ schema_name: 'analytics', table_name: 'events', column_name: 'id', n_distinct: -1.0 }),
    ]));

    const result = await profileDatabase('postgresql', multiSchema, queryFn);

    expect(result.queryCount).toBe(2);
    expect(result.tables).toHaveLength(3);
    expect(result.tables[0].rowCount).toBe(100);
    expect(result.tables[1].rowCount).toBe(500);
    expect(result.tables[2].rowCount).toBe(10000);
  });
});

// ─── DuckDB Strategy ─────────────────────────────────────────────────────────

describe('profileDuckDb', () => {
  const schema = makeSchema([{
    schema: 'main',
    tables: [{
      table: 'products',
      columns: [
        { name: 'id', type: 'INTEGER' },
        { name: 'category', type: 'VARCHAR' },
        { name: 'price', type: 'DOUBLE' },
        { name: 'status_code', type: 'BIGINT' },
      ],
    }],
  }]);

  it('makes 1 comment query + 1 SUMMARIZE per table + 1 per categorical', async () => {
    const queryFn = jest.fn<Promise<QueryResult>, [string]>();

    // Query 1: duckdb_columns() — batched comments
    queryFn.mockResolvedValueOnce(makeQueryResult(
      ['schema_name', 'table_name', 'column_name', 'comment'],
      [{ schema_name: 'main', table_name: 'products', column_name: 'category', comment: 'Product category' }],
    ));

    // Query 2: SUMMARIZE
    queryFn.mockResolvedValueOnce(makeQueryResult(
      ['column_name', 'column_type', 'min', 'max', 'approx_unique', 'avg', 'std', 'q25', 'q50', 'q75', 'count', 'null_percentage'],
      [
        { column_name: 'id', column_type: 'INTEGER', min: '1', max: '1000', approx_unique: 1000, avg: 500, std: null, q25: null, q50: null, q75: null, count: 1000, null_percentage: 0 },
        { column_name: 'category', column_type: 'VARCHAR', min: 'A', max: 'Z', approx_unique: 5, avg: null, std: null, q25: null, q50: null, q75: null, count: 1000, null_percentage: 2 },
        { column_name: 'price', column_type: 'DOUBLE', min: '1.99', max: '999.99', approx_unique: 200, avg: 49.99, std: null, q25: null, q50: null, q75: null, count: 1000, null_percentage: 0 },
        { column_name: 'status_code', column_type: 'BIGINT', min: '1', max: '5', approx_unique: 5, avg: 3, std: null, q25: null, q50: null, q75: null, count: 1000, null_percentage: 0 },
      ],
    ));

    // Query 3: top values for 'category' (only text categorical)
    queryFn.mockResolvedValueOnce(makeQueryResult(
      ['val', 'cnt'],
      [
        { val: 'Electronics', cnt: 400 },
        { val: 'Clothing', cnt: 300 },
        { val: 'Books', cnt: 200 },
        { val: 'Food', cnt: 80 },
        { val: 'Other', cnt: 20 },
      ],
    ));

    const result = await profileDatabase('duckdb', schema, queryFn);

    expect(result.queryCount).toBe(3); // 1 comments + 1 SUMMARIZE + 1 top values (only category, not status_code)
    expect(result.tables).toHaveLength(1);

    const byName = Object.fromEntries(result.tables[0].columns.map(c => [c.name, c]));

    expect(byName.id.classification).toBe('id_unique');
    expect(byName.category.classification).toBe('categorical');
    expect(byName.category.description).toBe('Product category');
    expect(byName.category.topValues).toHaveLength(5);
    expect(byName.price.classification).toBe('numeric');
    expect(byName.price.min).toBe(1.99);
    expect(byName.price.max).toBe(999.99);
    expect(byName.price.avg).toBe(49.99);
    // BIGINT with 5 distinct → numeric, not categorical. No top values, but gets min/max.
    expect(byName.status_code.classification).toBe('numeric');
    expect(byName.status_code.topValues).toBeUndefined();
    expect(byName.status_code.min).toBe(1);
    expect(byName.status_code.max).toBe(5);
    expect(byName.status_code.avg).toBe(3);
  });

  it('clamps nDistinct to rowCount (HyperLogLog overshoot)', async () => {
    const queryFn = jest.fn<Promise<QueryResult>, [string]>();

    queryFn.mockResolvedValueOnce(makeQueryResult(['schema_name', 'table_name', 'column_name', 'comment'], []));
    queryFn.mockResolvedValueOnce(makeQueryResult(
      ['column_name', 'column_type', 'min', 'max', 'approx_unique', 'avg', 'std', 'q25', 'q50', 'q75', 'count', 'null_percentage'],
      [
        // approx_unique (3231) > count (2652) — HyperLogLog overshoot
        { column_name: 'ts', column_type: 'TIMESTAMP', min: '2020-01-01', max: '2024-12-31', approx_unique: 3231, avg: null, std: null, q25: null, q50: null, q75: null, count: 2652, null_percentage: 0 },
      ],
    ));

    const tsSchema = makeSchema([{
      schema: 'main',
      tables: [{ table: 't', columns: [{ name: 'ts', type: 'TIMESTAMP' }] }],
    }]);

    const result = await profileDatabase('duckdb', tsSchema, queryFn);
    const col = result.tables[0].columns[0];

    expect(col.nDistinct).toBe(2652);        // clamped to rowCount, not 3231
    expect(col.cardinalityRatio).toBeLessThanOrEqual(1);
  });

  it('preserves original value types in topValues', async () => {
    const queryFn = jest.fn<Promise<QueryResult>, [string]>();

    queryFn.mockResolvedValueOnce(makeQueryResult(['schema_name', 'table_name', 'column_name', 'comment'], []));
    queryFn.mockResolvedValueOnce(makeQueryResult(
      ['column_name', 'column_type', 'min', 'max', 'approx_unique', 'avg', 'std', 'q25', 'q50', 'q75', 'count', 'null_percentage'],
      [{ column_name: 'name', column_type: 'VARCHAR', min: 'A', max: 'Z', approx_unique: 3, avg: null, std: null, q25: null, q50: null, q75: null, count: 100, null_percentage: 0 }],
    ));
    // Top values — string values should stay strings
    queryFn.mockResolvedValueOnce(makeQueryResult(['val', 'cnt'], [
      { val: 'Alice', cnt: 50 },
      { val: 'Bob', cnt: 30 },
    ]));

    const strSchema = makeSchema([{
      schema: 'main',
      tables: [{ table: 't', columns: [{ name: 'name', type: 'VARCHAR' }] }],
    }]);

    const result = await profileDatabase('duckdb', strSchema, queryFn);
    const topVals = result.tables[0].columns[0].topValues!;

    expect(typeof topVals[0].value).toBe('string');
    expect(topVals[0].value).toBe('Alice');
  });

  it('routes csv and google-sheets to DuckDB strategy', async () => {
    for (const connType of ['csv', 'google-sheets']) {
      const queryFn = jest.fn<Promise<QueryResult>, [string]>();

      queryFn.mockResolvedValueOnce(makeQueryResult(['schema_name', 'table_name', 'column_name', 'comment'], []));
      queryFn.mockResolvedValueOnce(makeQueryResult(
        ['column_name', 'column_type', 'min', 'max', 'approx_unique', 'avg', 'std', 'q25', 'q50', 'q75', 'count', 'null_percentage'],
        [{ column_name: 'id', column_type: 'INTEGER', min: '1', max: '10', approx_unique: 10, avg: 5, std: null, q25: null, q50: null, q75: null, count: 10, null_percentage: 0 }],
      ));

      const result = await profileDatabase(connType, schema, queryFn);
      expect(result.connectorType).toBe(connType);
      const queries = queryFn.mock.calls.map(c => c[0]);
      expect(queries.some(q => q.includes('SUMMARIZE'))).toBe(true);
    }
  });
});

// ─── BigQuery Strategy ───────────────────────────────────────────────────────

describe('profileBigQuery', () => {
  const schema = makeSchema([{
    schema: 'my_dataset',
    tables: [{
      table: 'events',
      columns: [
        { name: 'event_id', type: 'STRING' },
        { name: 'event_type', type: 'STRING' },
        { name: 'created_at', type: 'TIMESTAMP' },
        { name: 'score', type: 'INT64' },
      ],
    }],
  }]);

  it('batches metadata per dataset, classifies correctly, only text gets categorical', async () => {
    const queryFn = jest.fn<Promise<QueryResult>, [string]>();

    // Query 1: __TABLES__ (batched per dataset)
    queryFn.mockResolvedValueOnce(makeQueryResult(
      ['table_id', 'row_count'],
      [{ table_id: 'events', row_count: 50000 }],
    ));

    // Query 2: COLUMN_FIELD_PATHS (batched per dataset)
    queryFn.mockResolvedValueOnce(makeQueryResult(
      ['table_name', 'column_name', 'description'],
      [{ table_name: 'events', column_name: 'event_type', description: 'Type of user event' }],
    ));

    // Query 3: aggregation
    queryFn.mockResolvedValueOnce(makeQueryResult(
      ['dist_event_id', 'null_event_id', 'dist_event_type', 'null_event_type', 'dist_created_at', 'null_created_at', 'dist_score', 'null_score'],
      [{ dist_event_id: 50000, null_event_id: 0, dist_event_type: 8, null_event_type: 100, dist_created_at: 45000, null_created_at: 0, dist_score: 10, null_score: 500 }],
    ));

    // Query 4: top values for event_type (STRING categorical)
    queryFn.mockResolvedValueOnce(makeQueryResult(
      ['val', 'cnt'],
      [
        { val: 'click', cnt: 20000 },
        { val: 'view', cnt: 15000 },
        { val: 'purchase', cnt: 8000 },
      ],
    ));

    const result = await profileDatabase('bigquery', schema, queryFn);

    // 2 metadata + 1 aggregation + 1 top values (only event_type, not score)
    expect(result.queryCount).toBe(4);

    const byName = Object.fromEntries(result.tables[0].columns.map(c => [c.name, c]));

    expect(byName.event_id.classification).toBe('id_unique');
    expect(byName.event_type.classification).toBe('categorical');
    expect(byName.event_type.description).toBe('Type of user event');
    expect(byName.event_type.topValues).toHaveLength(3);
    expect(byName.created_at.classification).toBe('temporal');
    // INT64 with 10 distinct values → numeric, NOT categorical
    expect(byName.score.classification).toBe('numeric');
    expect(byName.score.topValues).toBeUndefined();

    // Verify APPROX_COUNT_DISTINCT is used
    const aggQuery = queryFn.mock.calls[2][0];
    expect(aggQuery).toContain('APPROX_COUNT_DISTINCT');
    expect(aggQuery).not.toContain('COUNT(DISTINCT');
  });

  it('uses backtick quoting', async () => {
    const queryFn = jest.fn<Promise<QueryResult>, [string]>();
    queryFn.mockResolvedValueOnce(makeQueryResult(['table_id', 'row_count'], []));
    queryFn.mockResolvedValueOnce(makeQueryResult(['table_name', 'column_name', 'description'], []));
    queryFn.mockResolvedValueOnce(makeQueryResult(
      ['dist_event_id', 'null_event_id', 'dist_event_type', 'null_event_type', 'dist_created_at', 'null_created_at', 'dist_score', 'null_score'],
      [{ dist_event_id: 100, null_event_id: 0, dist_event_type: 5, null_event_type: 0, dist_created_at: 90, null_created_at: 0, dist_score: 10, null_score: 0 }],
    ));

    await profileDatabase('bigquery', schema, queryFn);

    for (const [sql] of queryFn.mock.calls) {
      expect(sql).toContain('`');
      expect(sql).not.toMatch(/"my_dataset"/);
    }
  });
});

// ─── Edge Cases ──────────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('returns empty tables for empty schema', async () => {
    const queryFn = jest.fn<Promise<QueryResult>, [string]>();
    const result = await profileDatabase('postgresql', [], queryFn);
    expect(result.tables).toHaveLength(0);
  });

  it('handles query errors gracefully (skips failed tables)', async () => {
    const schema = makeSchema([{
      schema: 'main',
      tables: [{ table: 'broken', columns: [{ name: 'x', type: 'INTEGER' }] }],
    }]);

    const queryFn = jest.fn<Promise<QueryResult>, [string]>()
      .mockRejectedValue(new Error('connection lost'));

    const result = await profileDatabase('duckdb', schema, queryFn);
    expect(result.tables).toHaveLength(0);
  });

  it('handles null/missing values in pg_stats rows', async () => {
    const schema = makeSchema([{
      schema: 'public',
      tables: [{ table: 't', columns: [{ name: 'col', type: 'text' }] }],
    }]);

    const queryFn = jest.fn<Promise<QueryResult>, [string]>();
    queryFn.mockResolvedValueOnce(makeQueryResult(
      ['schema_name', 'table_name', 'row_count'],
      [{ schema_name: 'public', table_name: 't', row_count: 0 }],
    ));
    queryFn.mockResolvedValueOnce(makeQueryResult(PG_STATS_COLS, [
      pgStatsRow({ schema_name: 'public', table_name: 't', column_name: 'col' }),
    ]));

    const result = await profileDatabase('postgresql', schema, queryFn);
    expect(result.tables[0].columns[0].nullCount).toBe(0);
    expect(result.tables[0].columns[0].nDistinct).toBe(0);
    expect(result.tables[0].columns[0].description).toBeUndefined();
  });

  it('no topValues column removed from output has rowCount or nullFraction', async () => {
    const queryFn = jest.fn<Promise<QueryResult>, [string]>();
    queryFn.mockResolvedValueOnce(makeQueryResult(
      ['schema_name', 'table_name', 'row_count'],
      [{ schema_name: 'public', table_name: 't', row_count: 100 }],
    ));
    queryFn.mockResolvedValueOnce(makeQueryResult(PG_STATS_COLS, [
      pgStatsRow({ schema_name: 'public', table_name: 't', column_name: 'x', n_distinct: 50 }),
    ]));

    const schema = makeSchema([{
      schema: 'public',
      tables: [{ table: 't', columns: [{ name: 'x', type: 'text' }] }],
    }]);

    const result = await profileDatabase('postgresql', schema, queryFn);
    const col = result.tables[0].columns[0];

    // These fields should not exist on ColumnStatistics
    expect('rowCount' in col).toBe(false);
    expect('nullFraction' in col).toBe(false);
  });
});
