/**
 * Tests for validateSqlLocal (polyglot WASM).
 * Ported from backend/tests/test_sql_validator.py to ensure parity.
 */
import { validateSqlLocal } from '../validate-sql';

describe('validateSqlLocal (polyglot WASM)', () => {
  // --- Basic valid queries (various dialects) ---

  it('valid simple select - duckdb', async () => {
    const result = await validateSqlLocal('SELECT * FROM foo', 'duckdb');
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('valid simple select - postgres', async () => {
    const result = await validateSqlLocal(
      'SELECT id, name FROM users WHERE active = true',
      'postgres',
    );
    expect(result.valid).toBe(true);
  });

  it('valid simple select - bigquery', async () => {
    const result = await validateSqlLocal(
      'SELECT COUNT(*) AS total FROM orders',
      'bigquery',
    );
    expect(result.valid).toBe(true);
  });

  // --- Empty / whitespace ---

  it('empty query is valid', async () => {
    const result = await validateSqlLocal('', 'duckdb');
    expect(result.valid).toBe(true);
  });

  it('whitespace-only query is valid', async () => {
    const result = await validateSqlLocal('   ', 'postgres');
    expect(result.valid).toBe(true);
  });

  // --- Invalid queries ---

  it('invalid keyword - duckdb', async () => {
    const result = await validateSqlLocal('SELEC * FROM foo', 'duckdb');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('invalid keyword - postgres', async () => {
    const result = await validateSqlLocal('SELEC * FROM foo', 'postgres');
    expect(result.valid).toBe(false);
  });

  it('invalid keyword - bigquery', async () => {
    const result = await validateSqlLocal('SELEC * FROM foo', 'bigquery');
    expect(result.valid).toBe(false);
  });

  // --- Error position info ---

  it('error has valid position info', async () => {
    const result = await validateSqlLocal('SELEC * FROM foo', 'duckdb');
    const err = result.errors[0];
    expect(err.line).toBeGreaterThanOrEqual(1);
    expect(err.col).toBeGreaterThanOrEqual(1);
    expect(err.end_col).toBeGreaterThan(err.col);
  });

  // --- Params and references ---

  it('params dont cause errors - postgres', async () => {
    const result = await validateSqlLocal(
      'SELECT * FROM foo WHERE d > :start_date AND n = :name',
      'postgres',
    );
    expect(result.valid).toBe(true);
  });

  it('params dont cause errors - bigquery', async () => {
    const result = await validateSqlLocal(
      'SELECT * FROM foo WHERE amount > :min_amount',
      'bigquery',
    );
    expect(result.valid).toBe(true);
  });

  it('references dont cause errors', async () => {
    const result = await validateSqlLocal(
      'SELECT * FROM @revenue_1 r JOIN @costs_2 c ON r.id = c.id',
      'duckdb',
    );
    expect(result.valid).toBe(true);
  });

  it('mixed params and references', async () => {
    const result = await validateSqlLocal(
      'SELECT * FROM @rev_1 WHERE d > :start_date',
      'postgres',
    );
    expect(result.valid).toBe(true);
  });

  // --- Multi-statement ---

  it('multi statement is valid', async () => {
    const result = await validateSqlLocal('SELECT 1; SELECT 2', 'duckdb');
    expect(result.valid).toBe(true);
  });

  // --- Error positions not shifted by params ---

  it('error positions not shifted by params', async () => {
    const result = await validateSqlLocal(
      'SELECT * FROM foo WHERE :start_date BETWEEN AND',
      'postgres',
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].line).toBe(1);
  });

  // --- Dialect-specific syntax ---

  it('duckdb read_csv', async () => {
    const result = await validateSqlLocal(
      "SELECT * FROM read_csv('file.csv')",
      'duckdb',
    );
    expect(result.valid).toBe(true);
  });

  it('duckdb list literal', async () => {
    const result = await validateSqlLocal(
      'SELECT [1, 2, 3] AS nums',
      'duckdb',
    );
    expect(result.valid).toBe(true);
  });

  it('bigquery backtick table', async () => {
    const result = await validateSqlLocal(
      'SELECT * FROM `project.dataset.table`',
      'bigquery',
    );
    expect(result.valid).toBe(true);
  });

  it('bigquery struct', async () => {
    const result = await validateSqlLocal(
      "SELECT STRUCT(1 AS a, 'foo' AS b) AS s",
      'bigquery',
    );
    expect(result.valid).toBe(true);
  });

  it('postgres dollar quoting', async () => {
    const result = await validateSqlLocal(
      'SELECT $$hello world$$ AS greeting',
      'postgres',
    );
    expect(result.valid).toBe(true);
  });

  // --- Multiline SQL with errors ---

  it('multiline missing FROM (JION typo)', async () => {
    const result = await validateSqlLocal(
      `SELECT
    u.id,
    u.name,
    o.total
JION orders o ON o.user_id = u.id
WHERE u.active = true`,
      'duckdb',
    );
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('multiline unclosed subquery', async () => {
    const result = await validateSqlLocal(
      `SELECT *
FROM (
    SELECT id, name
    FROM users
    WHERE active = true

WHERE id > 10`,
      'postgres',
    );
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('multiline error reports correct line', async () => {
    const result = await validateSqlLocal(
      'SELECT id\nFROM users\nWHERE id >\nORDER BY',
      'bigquery',
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].line).toBeGreaterThan(1);
  });

  it('multiline CTE with typo', async () => {
    const result = await validateSqlLocal(
      `WITH monthly_revenue AS (
    SELECT
        DATE_TRUNC('month', created_at) AS month,
        SUM(amount) AS revenue
    FROM orders
    GRUOP BY 1
)
SELECT *
FROM monthly_revenue
ORDER BY month`,
      'duckdb',
    );
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('multiline double WHERE', async () => {
    const result = await validateSqlLocal(
      `SELECT
    u.name,
    o.total
FROM users u
JOIN orders o ON o.user_id = u.id
WHERE u.active = true
WHERE o.created_at > '2024-01-01'`,
      'postgres',
    );
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('multiline valid complex query', async () => {
    const result = await validateSqlLocal(
      `WITH active_users AS (
    SELECT id, name, email
    FROM users
    WHERE active = true
),
user_orders AS (
    SELECT
        u.id,
        u.name,
        COUNT(o.id) AS order_count,
        SUM(o.total) AS total_spent
    FROM active_users u
    LEFT JOIN orders o ON o.user_id = u.id
    GROUP BY u.id, u.name
)
SELECT
    name,
    order_count,
    total_spent,
    CASE
        WHEN total_spent > 1000 THEN 'high'
        WHEN total_spent > 100 THEN 'medium'
        ELSE 'low'
    END AS tier
FROM user_orders
ORDER BY total_spent DESC
LIMIT 50`,
      'bigquery',
    );
    expect(result.valid).toBe(true);
  });

  it('multiline with params and references', async () => {
    const result = await validateSqlLocal(
      `SELECT
    r.month,
    r.revenue,
    c.cost,
    r.revenue - c.cost AS profit
FROM @revenue_by_month_1 r
JOIN @costs_by_month_2 c ON c.month = r.month
WHERE r.month >= :start_date
    AND r.month <= :end_date
ORDER BY r.month`,
      'duckdb',
    );
    expect(result.valid).toBe(true);
  });

  it('multiline mismatched parens', async () => {
    const result = await validateSqlLocal(
      `SELECT
    id,
    name,
    (CASE WHEN active THEN 'yes' ELSE 'no' AS status
FROM users`,
      'postgres',
    );
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
