/**
 * Tests for inferColumnsLocal (polyglot WASM).
 * Ported from backend tests (infer-columns.test.ts Part A) to ensure parity.
 */
import { inferColumnsLocal } from '../infer-columns';

describe('inferColumnsLocal (polyglot WASM)', () => {
  it('infers column names from aggregate SELECT', async () => {
    const result = await inferColumnsLocal(
      'SELECT user_id, SUM(amount) AS total FROM orders GROUP BY user_id',
      [],
      'duckdb',
    );
    const names = result.columns.map((c) => c.name);
    expect(names).toContain('user_id');
    expect(names).toContain('total');
    expect(result.columns).toHaveLength(2);
  });

  it('infers column names from aliased string/function expressions', async () => {
    const result = await inferColumnsLocal(
      'SELECT id, LOWER(name) AS lower_name, created_at FROM users',
      [],
      'duckdb',
    );
    const names = result.columns.map((c) => c.name);
    expect(names).toContain('id');
    expect(names).toContain('lower_name');
    expect(names).toContain('created_at');
  });

  it('infers CAST type annotation', async () => {
    const result = await inferColumnsLocal(
      'SELECT CAST(price AS DECIMAL(10,2)) AS price_decimal FROM products',
      [],
      'duckdb',
    );
    const priceCol = result.columns.find((c) => c.name === 'price_decimal');
    expect(priceCol).toBeDefined();
    expect(priceCol!.type.toLowerCase()).toMatch(/decimal/);
  });

  it('expands SELECT * columns from schema_data', async () => {
    const schemaData = [
      {
        databaseName: 'test_db',
        schemas: [
          {
            schema: 'public',
            tables: [
              {
                table: 'orders',
                columns: [
                  { name: 'order_id', type: 'int' },
                  { name: 'amount', type: 'decimal' },
                ],
              },
            ],
          },
        ],
      },
    ];

    const result = await inferColumnsLocal('SELECT * FROM orders', schemaData, 'duckdb');
    const names = result.columns.map((c) => c.name);
    expect(names).toContain('order_id');
    expect(names).toContain('amount');
  });

  it('handles invalid SQL without throwing (graceful degradation)', async () => {
    const result = await inferColumnsLocal('NOT VALID SQL AT ALL !!!', [], 'duckdb');
    expect(Array.isArray(result.columns)).toBe(true);
  });

  it('looks up column type from schema_data for plain column references', async () => {
    const schemaData = [
      {
        databaseName: 'test_db',
        schemas: [
          {
            schema: 'public',
            tables: [
              {
                table: 'users',
                columns: [{ name: 'email', type: 'varchar' }],
              },
            ],
          },
        ],
      },
    ];

    const result = await inferColumnsLocal('SELECT email FROM users', schemaData, 'duckdb');
    const emailCol = result.columns.find((c) => c.name === 'email');
    expect(emailCol).toBeDefined();
    expect(emailCol!.type).toBe('varchar');
  });

  // --- Additional edge cases ---

  it('handles SELECT with literal values', async () => {
    const result = await inferColumnsLocal(
      "SELECT 42 AS num, 'hello' AS greeting FROM t",
      [],
      'duckdb',
    );
    const numCol = result.columns.find((c) => c.name === 'num');
    const greetCol = result.columns.find((c) => c.name === 'greeting');
    expect(numCol).toBeDefined();
    expect(numCol!.type).toBe('number');
    expect(greetCol).toBeDefined();
    expect(greetCol!.type).toBe('text');
  });

  it('infers number type for aggregate functions', async () => {
    const result = await inferColumnsLocal(
      'SELECT COUNT(*) AS cnt, AVG(price) AS avg_price, MAX(qty) AS max_qty FROM t',
      [],
      'duckdb',
    );
    for (const col of result.columns) {
      expect(col.type).toBe('number');
    }
  });

  it('infers text type for string functions', async () => {
    const result = await inferColumnsLocal(
      'SELECT LOWER(name) AS low, UPPER(name) AS up, TRIM(name) AS trimmed FROM t',
      [],
      'duckdb',
    );
    for (const col of result.columns) {
      expect(col.type).toBe('text');
    }
  });

  it('returns wildcard placeholder when no schema for SELECT *', async () => {
    const result = await inferColumnsLocal('SELECT * FROM unknown_table', [], 'duckdb');
    expect(result.columns).toHaveLength(1);
    expect(result.columns[0].name).toBe('*');
    expect(result.columns[0].type).toBe('unknown');
  });

  it('empty query returns empty columns', async () => {
    const result = await inferColumnsLocal('', [], 'duckdb');
    expect(result.columns).toEqual([]);
  });

  it('works with postgres dialect', async () => {
    const result = await inferColumnsLocal(
      'SELECT id, name FROM users',
      [],
      'postgres',
    );
    expect(result.columns).toHaveLength(2);
    expect(result.columns[0].name).toBe('id');
  });

  it('works with bigquery dialect', async () => {
    const result = await inferColumnsLocal(
      'SELECT id FROM `project.dataset.table`',
      [],
      'bigquery',
    );
    expect(result.columns).toHaveLength(1);
    expect(result.columns[0].name).toBe('id');
  });
});
