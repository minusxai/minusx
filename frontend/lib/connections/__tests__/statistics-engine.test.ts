/**
 * Tests for statistics-engine.ts
 *
 * Tests each profiling strategy with mock queryFn returning canned SQL results.
 * Verifies: column classification, query count (batching), description extraction,
 * top-value parsing, and correct routing by connector type.
 */

import { profileDatabase } from '../statistics-engine';
import type { SchemaEntry, QueryResult } from '../base';

// ─── Test Helpers ────────────────────────────────────────────────────────────

function makeQueryResult(columns: string[], rows: Record<string, unknown>[]): QueryResult {
  return { columns, types: columns.map(() => 'text'), rows };
}

function makeSchema(entries: Array<{ schema: string; tables: Array<{ table: string; columns: Array<{ name: string; type: string }> }> }>): SchemaEntry[] {
  return entries;
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
      ],
    }],
  }]);

  it('makes exactly 2 queries for the entire database', async () => {
    const queryFn = jest.fn<Promise<QueryResult>, [string]>();

    // Query 1: pg_class row counts
    queryFn.mockResolvedValueOnce(makeQueryResult(
      ['schema_name', 'table_name', 'row_count'],
      [{ schema_name: 'public', table_name: 'orders', row_count: 1000 }],
    ));

    // Query 2: pg_stats + pg_description
    queryFn.mockResolvedValueOnce(makeQueryResult(
      ['schema_name', 'table_name', 'column_name', 'null_frac', 'n_distinct', 'most_common_vals', 'most_common_freqs', 'description'],
      [
        { schema_name: 'public', table_name: 'orders', column_name: 'id', null_frac: 0, n_distinct: -1.0, most_common_vals: null, most_common_freqs: null, description: 'Primary key' },
        { schema_name: 'public', table_name: 'orders', column_name: 'status', null_frac: 0.01, n_distinct: 4, most_common_vals: '{pending,shipped,delivered,cancelled}', most_common_freqs: '{0.4,0.3,0.2,0.1}', description: 'Order status' },
        { schema_name: 'public', table_name: 'orders', column_name: 'created_at', null_frac: 0, n_distinct: -0.95, most_common_vals: null, most_common_freqs: null, description: null },
        { schema_name: 'public', table_name: 'orders', column_name: 'total', null_frac: 0.05, n_distinct: 500, most_common_vals: null, most_common_freqs: null, description: null },
        { schema_name: 'public', table_name: 'orders', column_name: 'is_active', null_frac: 0, n_distinct: 2, most_common_vals: '{t,f}', most_common_freqs: '{0.7,0.3}', description: null },
        { schema_name: 'public', table_name: 'orders', column_name: 'user_uuid', null_frac: 0, n_distinct: -0.8, most_common_vals: null, most_common_freqs: null, description: null },
      ],
    ));

    const result = await profileDatabase('postgresql', schema, queryFn);

    expect(result.queryCount).toBe(2);
    expect(result.connectorType).toBe('postgresql');
  });

  it('classifies columns correctly', async () => {
    const queryFn = jest.fn<Promise<QueryResult>, [string]>();

    queryFn.mockResolvedValueOnce(makeQueryResult(
      ['schema_name', 'table_name', 'row_count'],
      [{ schema_name: 'public', table_name: 'orders', row_count: 1000 }],
    ));

    queryFn.mockResolvedValueOnce(makeQueryResult(
      ['schema_name', 'table_name', 'column_name', 'null_frac', 'n_distinct', 'most_common_vals', 'most_common_freqs', 'description'],
      [
        { schema_name: 'public', table_name: 'orders', column_name: 'id', null_frac: 0, n_distinct: -1.0, most_common_vals: null, most_common_freqs: null, description: null },
        { schema_name: 'public', table_name: 'orders', column_name: 'status', null_frac: 0, n_distinct: 4, most_common_vals: '{a,b,c,d}', most_common_freqs: '{0.4,0.3,0.2,0.1}', description: null },
        { schema_name: 'public', table_name: 'orders', column_name: 'created_at', null_frac: 0, n_distinct: -0.95, most_common_vals: null, most_common_freqs: null, description: null },
        { schema_name: 'public', table_name: 'orders', column_name: 'total', null_frac: 0, n_distinct: 200, most_common_vals: null, most_common_freqs: null, description: null },
        { schema_name: 'public', table_name: 'orders', column_name: 'is_active', null_frac: 0, n_distinct: 2, most_common_vals: null, most_common_freqs: null, description: null },
        { schema_name: 'public', table_name: 'orders', column_name: 'user_uuid', null_frac: 0, n_distinct: -0.9, most_common_vals: null, most_common_freqs: null, description: null },
      ],
    ));

    const result = await profileDatabase('postgresql', schema, queryFn);
    const cols = result.tables[0].columns;
    const byName = Object.fromEntries(cols.map(c => [c.name, c]));

    expect(byName.id.classification).toBe('id_unique');        // n_distinct = -1.0 → ratio 1.0
    expect(byName.status.classification).toBe('categorical');  // n_distinct = 4
    expect(byName.created_at.classification).toBe('temporal'); // timestamp type
    expect(byName.total.classification).toBe('numeric');       // numeric type, moderate cardinality
    expect(byName.is_active.classification).toBe('boolean');   // boolean type
    expect(byName.user_uuid.classification).toBe('id_unique'); // uuid type
  });

  it('parses most_common_vals into topValues for categoricals', async () => {
    const queryFn = jest.fn<Promise<QueryResult>, [string]>();

    queryFn.mockResolvedValueOnce(makeQueryResult(
      ['schema_name', 'table_name', 'row_count'],
      [{ schema_name: 'public', table_name: 'orders', row_count: 1000 }],
    ));

    queryFn.mockResolvedValueOnce(makeQueryResult(
      ['schema_name', 'table_name', 'column_name', 'null_frac', 'n_distinct', 'most_common_vals', 'most_common_freqs', 'description'],
      [
        { schema_name: 'public', table_name: 'orders', column_name: 'status', null_frac: 0.01, n_distinct: 3, most_common_vals: '{pending,shipped,delivered}', most_common_freqs: '{0.5,0.3,0.2}', description: 'Order status' },
      ],
    ));

    // Only 'status' column in schema for simplicity
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

  it('skips tables when pg_stats is empty (ANALYZE not run)', async () => {
    const queryFn = jest.fn<Promise<QueryResult>, [string]>();

    queryFn.mockResolvedValueOnce(makeQueryResult(
      ['schema_name', 'table_name', 'row_count'],
      [{ schema_name: 'public', table_name: 'orders', row_count: 1000 }],
    ));

    // Empty pg_stats
    queryFn.mockResolvedValueOnce(makeQueryResult(
      ['schema_name', 'table_name', 'column_name', 'null_frac', 'n_distinct', 'most_common_vals', 'most_common_freqs', 'description'],
      [],
    ));

    const result = await profileDatabase('postgresql', schema, queryFn);

    expect(result.queryCount).toBe(2);
    expect(result.tables).toHaveLength(0); // Skipped, no fallback
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

    // Query 1: pg_class — all tables
    queryFn.mockResolvedValueOnce(makeQueryResult(
      ['schema_name', 'table_name', 'row_count'],
      [
        { schema_name: 'public', table_name: 'users', row_count: 100 },
        { schema_name: 'public', table_name: 'orders', row_count: 500 },
        { schema_name: 'analytics', table_name: 'events', row_count: 10000 },
      ],
    ));

    // Query 2: pg_stats — all columns across all tables
    queryFn.mockResolvedValueOnce(makeQueryResult(
      ['schema_name', 'table_name', 'column_name', 'null_frac', 'n_distinct', 'most_common_vals', 'most_common_freqs', 'description'],
      [
        { schema_name: 'public', table_name: 'users', column_name: 'id', null_frac: 0, n_distinct: -1.0, most_common_vals: null, most_common_freqs: null, description: null },
        { schema_name: 'public', table_name: 'orders', column_name: 'id', null_frac: 0, n_distinct: -1.0, most_common_vals: null, most_common_freqs: null, description: null },
        { schema_name: 'analytics', table_name: 'events', column_name: 'id', null_frac: 0, n_distinct: -1.0, most_common_vals: null, most_common_freqs: null, description: null },
      ],
    ));

    const result = await profileDatabase('postgresql', multiSchema, queryFn);

    // Still only 2 queries — batched across schemas
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
      ],
    ));

    // Query 3: top values for 'category' (categorical)
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

    expect(result.queryCount).toBe(3); // 1 comments + 1 SUMMARIZE + 1 top values
    expect(result.tables).toHaveLength(1);

    const cols = result.tables[0].columns;
    const byName = Object.fromEntries(cols.map(c => [c.name, c]));

    expect(byName.id.classification).toBe('id_unique');
    expect(byName.category.classification).toBe('categorical');
    expect(byName.category.description).toBe('Product category');
    expect(byName.category.topValues).toHaveLength(5);
    expect(byName.price.classification).toBe('numeric');
    expect(byName.price.min).toBe(1.99);
    expect(byName.price.max).toBe(999.99);
    expect(byName.price.avg).toBe(49.99);
  });

  it('routes csv and google-sheets to DuckDB strategy', async () => {
    for (const connType of ['csv', 'google-sheets']) {
      const queryFn = jest.fn<Promise<QueryResult>, [string]>();

      // comments
      queryFn.mockResolvedValueOnce(makeQueryResult(['schema_name', 'table_name', 'column_name', 'comment'], []));
      // SUMMARIZE
      queryFn.mockResolvedValueOnce(makeQueryResult(
        ['column_name', 'column_type', 'min', 'max', 'approx_unique', 'avg', 'std', 'q25', 'q50', 'q75', 'count', 'null_percentage'],
        [{ column_name: 'id', column_type: 'INTEGER', min: '1', max: '10', approx_unique: 10, avg: 5, std: null, q25: null, q50: null, q75: null, count: 10, null_percentage: 0 }],
      ));

      const result = await profileDatabase(connType, schema, queryFn);
      expect(result.connectorType).toBe(connType);
      // Should have called SUMMARIZE (duckdb strategy), not generic SQL
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
      ],
    }],
  }]);

  it('batches __TABLES__ and COLUMN_FIELD_PATHS per dataset', async () => {
    const queryFn = jest.fn<Promise<QueryResult>, [string]>();

    // Query 1: __TABLES__ for dataset (batched)
    queryFn.mockResolvedValueOnce(makeQueryResult(
      ['table_id', 'row_count'],
      [{ table_id: 'events', row_count: 50000 }],
    ));

    // Query 2: COLUMN_FIELD_PATHS for dataset (batched)
    queryFn.mockResolvedValueOnce(makeQueryResult(
      ['table_name', 'column_name', 'description'],
      [{ table_name: 'events', column_name: 'event_type', description: 'Type of user event' }],
    ));

    // Query 3: aggregation for 'events' table
    queryFn.mockResolvedValueOnce(makeQueryResult(
      ['dist_event_id', 'null_event_id', 'dist_event_type', 'null_event_type', 'dist_created_at', 'null_created_at'],
      [{ dist_event_id: 50000, null_event_id: 0, dist_event_type: 8, null_event_type: 100, dist_created_at: 45000, null_created_at: 0 }],
    ));

    // Query 4: top values for event_type (categorical)
    queryFn.mockResolvedValueOnce(makeQueryResult(
      ['val', 'cnt'],
      [
        { val: 'click', cnt: 20000 },
        { val: 'view', cnt: 15000 },
        { val: 'purchase', cnt: 8000 },
      ],
    ));

    const result = await profileDatabase('bigquery', schema, queryFn);

    // 2 metadata (batched per dataset) + 1 aggregation + 1 top values
    expect(result.queryCount).toBe(4);

    const cols = result.tables[0].columns;
    const byName = Object.fromEntries(cols.map(c => [c.name, c]));

    expect(byName.event_id.classification).toBe('id_unique');     // ratio = 1.0
    expect(byName.event_type.classification).toBe('categorical'); // n_distinct = 8
    expect(byName.event_type.description).toBe('Type of user event');
    expect(byName.event_type.topValues).toHaveLength(3);
    expect(byName.created_at.classification).toBe('temporal');    // TIMESTAMP type

    // Verify APPROX_COUNT_DISTINCT is used (not COUNT(DISTINCT))
    const aggQuery = queryFn.mock.calls[2][0];
    expect(aggQuery).toContain('APPROX_COUNT_DISTINCT');
    expect(aggQuery).not.toContain('COUNT(DISTINCT');
  });

  it('uses backtick quoting', async () => {
    const queryFn = jest.fn<Promise<QueryResult>, [string]>();
    queryFn.mockResolvedValueOnce(makeQueryResult(['table_id', 'row_count'], []));
    queryFn.mockResolvedValueOnce(makeQueryResult(['table_name', 'column_name', 'description'], []));
    queryFn.mockResolvedValueOnce(makeQueryResult(
      ['dist_event_id', 'null_event_id', 'dist_event_type', 'null_event_type', 'dist_created_at', 'null_created_at'],
      [{ dist_event_id: 100, null_event_id: 0, dist_event_type: 5, null_event_type: 0, dist_created_at: 90, null_created_at: 0 }],
    ));

    await profileDatabase('bigquery', schema, queryFn);

    // All queries should use backtick quoting
    for (const [sql] of queryFn.mock.calls) {
      expect(sql).toContain('`');
      expect(sql).not.toMatch(/"my_dataset"/); // No double-quote quoting
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

    // Should not throw — gracefully returns empty
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
    queryFn.mockResolvedValueOnce(makeQueryResult(
      ['schema_name', 'table_name', 'column_name', 'null_frac', 'n_distinct', 'most_common_vals', 'most_common_freqs', 'description'],
      [{ schema_name: 'public', table_name: 't', column_name: 'col', null_frac: null, n_distinct: null, most_common_vals: null, most_common_freqs: null, description: null }],
    ));

    const result = await profileDatabase('postgresql', schema, queryFn);
    expect(result.tables[0].columns[0].nullCount).toBe(0);
    expect(result.tables[0].columns[0].nDistinct).toBe(0);
    expect(result.tables[0].columns[0].description).toBeUndefined();
  });
});
