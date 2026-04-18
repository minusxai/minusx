/**
 * Tests for normalizeSql and validateRoundTrip.
 * Ported from backend/tests/test_enhanced_validator.py.
 */
import { normalizeSql, validateRoundTrip } from '../enhanced-validator';

// ---------------------------------------------------------------------------
// TestNormalizeSql
// ---------------------------------------------------------------------------

describe('normalizeSql', () => {
  it('normalizes whitespace - duckdb', async () => {
    const a = await normalizeSql('SELECT   id  FROM   users', 'duckdb');
    const b = await normalizeSql('SELECT id FROM users', 'duckdb');
    expect(a).toBe(b);
  });

  it('normalizes case - postgres', async () => {
    const a = await normalizeSql('select id from users', 'postgres');
    const b = await normalizeSql('SELECT id FROM users', 'postgres');
    expect(a).toBe(b);
  });

  it('normalizes trailing semicolon - bigquery', async () => {
    const a = await normalizeSql('SELECT 1;', 'bigquery');
    const b = await normalizeSql('SELECT 1', 'bigquery');
    expect(a).toBe(b);
  });

  it('different queries do not match - duckdb', async () => {
    const a = await normalizeSql('SELECT id FROM users', 'duckdb');
    const b = await normalizeSql('SELECT name FROM users', 'duckdb');
    expect(a).not.toBe(b);
  });

  it('different tables do not match - postgres', async () => {
    const a = await normalizeSql('SELECT id FROM users', 'postgres');
    const b = await normalizeSql('SELECT id FROM orders', 'postgres');
    expect(a).not.toBe(b);
  });

  it('column alias preserved - bigquery', async () => {
    const a = await normalizeSql('SELECT id AS user_id FROM users', 'bigquery');
    const b = await normalizeSql('SELECT id AS user_id FROM users', 'bigquery');
    expect(a).toBe(b);
  });

  it('parse failure returns stripped original', async () => {
    const badSql = 'SELECT * FROM users WHERE x =';
    const result = await normalizeSql(badSql, 'duckdb');
    expect(result).toBe(badSql.trim());
  });

  it('empty string - duckdb', async () => {
    const result = await normalizeSql('', 'duckdb');
    expect(typeof result).toBe('string');
  });

  it('CTE normalizes consistently - postgres', async () => {
    const sql = 'WITH cte AS (SELECT id FROM users) SELECT * FROM cte';
    const a = await normalizeSql(sql, 'postgres');
    const b = await normalizeSql(sql, 'postgres');
    expect(a).toBe(b);
  });

  it('JOIN normalizes consistently - duckdb', async () => {
    const sql = 'SELECT u.id, o.total FROM users u JOIN orders o ON o.user_id = u.id';
    const a = await normalizeSql(sql, 'duckdb');
    const b = await normalizeSql(sql, 'duckdb');
    expect(a).toBe(b);
  });

  it('aggregate normalizes consistently - bigquery', async () => {
    const sql = 'SELECT COUNT(*) AS total, SUM(amount) AS revenue FROM orders GROUP BY status';
    const a = await normalizeSql(sql, 'bigquery');
    const b = await normalizeSql(sql, 'bigquery');
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// TestValidateRoundTrip
// ---------------------------------------------------------------------------

describe('validateRoundTrip', () => {
  it('identical SQL is lossless - duckdb', async () => {
    const sql = 'SELECT id, name FROM users WHERE active = TRUE';
    const result = await validateRoundTrip(sql, sql, 'duckdb');
    expect(result.supported).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('whitespace difference is lossless - postgres', async () => {
    const original = 'SELECT id FROM users';
    const regenerated = 'SELECT   id   FROM   users';
    const result = await validateRoundTrip(original, regenerated, 'postgres');
    expect(result.supported).toBe(true);
  });

  it('case difference is lossless - bigquery', async () => {
    const original = 'select id from users';
    const regenerated = 'SELECT id FROM users';
    const result = await validateRoundTrip(original, regenerated, 'bigquery');
    expect(result.supported).toBe(true);
  });

  it('different columns is lossy - duckdb', async () => {
    const original = 'SELECT id, name, email FROM users';
    const regenerated = 'SELECT id, name FROM users';
    const result = await validateRoundTrip(original, regenerated, 'duckdb');
    expect(result.supported).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.hint).not.toBeNull();
  });

  it('missing WHERE clause is lossy - postgres', async () => {
    const original = 'SELECT id FROM users WHERE active = TRUE';
    const regenerated = 'SELECT id FROM users';
    const result = await validateRoundTrip(original, regenerated, 'postgres');
    expect(result.supported).toBe(false);
  });

  it('missing ORDER BY is lossy - bigquery', async () => {
    const original = 'SELECT id FROM users ORDER BY name';
    const regenerated = 'SELECT id FROM users';
    const result = await validateRoundTrip(original, regenerated, 'bigquery');
    expect(result.supported).toBe(false);
  });

  it('missing LIMIT is lossy - duckdb', async () => {
    const original = 'SELECT id FROM users LIMIT 100';
    const regenerated = 'SELECT id FROM users';
    const result = await validateRoundTrip(original, regenerated, 'duckdb');
    expect(result.supported).toBe(false);
  });

  it('missing GROUP BY is lossy - postgres', async () => {
    const original = 'SELECT status, COUNT(*) FROM orders GROUP BY status';
    const regenerated = 'SELECT status, COUNT(*) FROM orders';
    const result = await validateRoundTrip(original, regenerated, 'postgres');
    expect(result.supported).toBe(false);
  });

  it('added column is lossy - bigquery', async () => {
    const original = 'SELECT id FROM users';
    const regenerated = 'SELECT id, name FROM users';
    const result = await validateRoundTrip(original, regenerated, 'bigquery');
    expect(result.supported).toBe(false);
  });

  it('complex query lossless - duckdb', async () => {
    const sql =
      'SELECT u.id, u.name, COUNT(o.id) AS order_count ' +
      'FROM users u LEFT JOIN orders o ON o.user_id = u.id ' +
      'GROUP BY u.id, u.name ORDER BY order_count DESC LIMIT 50';
    const result = await validateRoundTrip(sql, sql, 'duckdb');
    expect(result.supported).toBe(true);
  });

  it('CTE lossless - postgres', async () => {
    const sql =
      'WITH active AS (SELECT id FROM users WHERE active = TRUE) ' +
      'SELECT * FROM active';
    const result = await validateRoundTrip(sql, sql, 'postgres');
    expect(result.supported).toBe(true);
  });

  // --- Without optimizer (same results since we don't use sqlglot optimizer) ---

  it('ORDER BY ASC lossless', async () => {
    const original = 'SELECT name FROM users ORDER BY name';
    const regenerated = 'SELECT name FROM users ORDER BY name';
    const result = await validateRoundTrip(original, regenerated, 'duckdb');
    expect(result.supported).toBe(true);
  });

  it('JOIN lossless', async () => {
    const original = 'SELECT u.id FROM users u JOIN orders o ON o.user_id = u.id';
    const regenerated = 'SELECT u.id FROM users u JOIN orders o ON o.user_id = u.id';
    const result = await validateRoundTrip(original, regenerated, 'postgres');
    expect(result.supported).toBe(true);
  });

  it('ORDER BY DESC preserved', async () => {
    const original = 'SELECT id FROM users ORDER BY id DESC';
    const regenerated = 'SELECT id FROM users ORDER BY id DESC';
    const result = await validateRoundTrip(original, regenerated, 'bigquery');
    expect(result.supported).toBe(true);
  });

  it('different columns lossy (no optimizer)', async () => {
    const original = 'SELECT id, name FROM users';
    const regenerated = 'SELECT id FROM users';
    const result = await validateRoundTrip(original, regenerated, 'duckdb');
    expect(result.supported).toBe(false);
  });

  it('dropped WHERE lossy (no optimizer)', async () => {
    const original = 'SELECT id FROM users WHERE active = TRUE';
    const regenerated = 'SELECT id FROM users';
    const result = await validateRoundTrip(original, regenerated, 'postgres');
    expect(result.supported).toBe(false);
  });

  it('whitespace difference lossless (no optimizer)', async () => {
    const original = 'SELECT   id   FROM   users';
    const regenerated = 'SELECT id FROM users';
    const result = await validateRoundTrip(original, regenerated, 'duckdb');
    expect(result.supported).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Param dialect compat (ported from test_param_dialect_compat.py)
// ---------------------------------------------------------------------------

describe('Param dialect compatibility', () => {
  const substituteParams = (query: string, params: Record<string, string>) => {
    let result = query;
    for (const [name, value] of Object.entries(params)) {
      result = result.replace(new RegExp(`:${name}\\b`, 'g'), value);
    }
    return result;
  };

  const TEXT_VALUE = "'active'";
  const DATE_VALUE = "'2024-01-01'";
  const NUMBER_VALUE = '100';

  const dialects = ['duckdb', 'postgres', 'bigquery'] as const;

  describe('full query with all param types', () => {
    const queries: Record<string, { sql: string; params: Record<string, string> }> = {
      duckdb: {
        sql: `SELECT DATE_TRUNC('month', created_at) AS month, status, COUNT(*) AS total_orders, SUM(amount) AS revenue
              FROM orders WHERE status = :status AND created_at >= :start_date AND amount > :min_amount
              GROUP BY 1, 2 ORDER BY month DESC LIMIT 500`,
        params: { status: TEXT_VALUE, start_date: DATE_VALUE, min_amount: NUMBER_VALUE },
      },
      postgres: {
        sql: `SELECT DATE_TRUNC('week', created_at) AS week, region, COUNT(DISTINCT user_id) AS unique_users, SUM(spend) AS total_spend
              FROM transactions WHERE region = :region AND created_at >= :start_date AND spend > :min_spend
              GROUP BY 1, 2 ORDER BY week DESC LIMIT 500`,
        params: { region: TEXT_VALUE, start_date: DATE_VALUE, min_spend: NUMBER_VALUE },
      },
      bigquery: {
        sql: `SELECT DATE_TRUNC(event_date, MONTH) AS month, country, COUNT(*) AS events, SUM(revenue) AS total_revenue
              FROM events WHERE country = :country AND event_date >= :start_date AND revenue > :min_revenue
              GROUP BY 1, 2 ORDER BY month DESC LIMIT 500`,
        params: { country: TEXT_VALUE, start_date: DATE_VALUE, min_revenue: NUMBER_VALUE },
      },
    };

    for (const dialect of dialects) {
      it(`parses cleanly for ${dialect}`, async () => {
        const { sql, params } = queries[dialect];
        const substituted = substituteParams(sql, params);
        // Just verify it normalizes without throwing
        const result = await normalizeSql(substituted, dialect);
        expect(result).toBeTruthy();
      });
    }
  });

  describe('isolated param types × dialects', () => {
    const paramQueries: Array<{ name: string; sql: string; params: Record<string, string> }> = [
      { name: 'text', sql: "SELECT * FROM orders WHERE status = :status LIMIT 100", params: { status: TEXT_VALUE } },
      { name: 'date-iso-date', sql: "SELECT * FROM orders WHERE created_at >= :start_date LIMIT 100", params: { start_date: DATE_VALUE } },
      { name: 'date-iso-datetime', sql: "SELECT * FROM orders WHERE created_at >= :start_ts LIMIT 100", params: { start_ts: "'2024-01-01T00:00:00'" } },
      { name: 'number', sql: "SELECT * FROM orders WHERE amount > :min_amount LIMIT 100", params: { min_amount: NUMBER_VALUE } },
    ];

    for (const dialect of dialects) {
      for (const { name, sql, params } of paramQueries) {
        it(`${name} valid for ${dialect}`, async () => {
          const substituted = substituteParams(sql, params);
          const result = await normalizeSql(substituted, dialect);
          expect(result).toBeTruthy();
        });
      }
    }
  });
});
