/**
 * Tests for enforceQueryLimit (polyglot WASM).
 * Ported from backend/tests/test_limit_enforcer.py.
 */
import { enforceQueryLimit } from '../limit-enforcer';

describe('enforceQueryLimit', () => {
  it('no LIMIT adds default', async () => {
    const result = await enforceQueryLimit('SELECT * FROM users', { defaultLimit: 1000, dialect: 'duckdb' });
    expect(result).toContain('LIMIT');
    expect(result).toContain('1000');
  });

  it('existing LIMIT under max is preserved', async () => {
    const result = await enforceQueryLimit('SELECT * FROM users LIMIT 500', { maxLimit: 10000, dialect: 'postgres' });
    expect(result).toContain('LIMIT');
    expect(result).toContain('500');
  });

  it('existing LIMIT over max is capped', async () => {
    const result = await enforceQueryLimit('SELECT * FROM users LIMIT 50000', { maxLimit: 10000, dialect: 'bigquery' });
    expect(result.toUpperCase()).toContain('LIMIT 10000');
    expect(result).not.toContain('50000');
  });

  it('LIMIT with OFFSET preserved', async () => {
    const result = await enforceQueryLimit('SELECT * FROM users LIMIT 5000 OFFSET 100', { maxLimit: 10000, dialect: 'duckdb' });
    expect(result).toContain('5000');
    expect(result.toUpperCase()).toContain('OFFSET');
    expect(result).toContain('100');
  });

  it('LIMIT over max with OFFSET', async () => {
    const result = await enforceQueryLimit('SELECT * FROM users LIMIT 50000 OFFSET 100', { maxLimit: 10000, dialect: 'postgres' });
    expect(result.toUpperCase()).toContain('LIMIT 10000');
    expect(result.toUpperCase()).toContain('OFFSET');
  });

  it('subquery LIMIT ignored, outer LIMIT added', async () => {
    const result = await enforceQueryLimit('SELECT * FROM (SELECT * FROM users LIMIT 100) sub', { defaultLimit: 1000, dialect: 'bigquery' });
    expect(result).toContain('100');
    expect(result).toContain('1000');
  });

  it('CTE with LIMIT, outer LIMIT added', async () => {
    const sql = `WITH top_users AS (SELECT * FROM users LIMIT 50) SELECT * FROM top_users`;
    const result = await enforceQueryLimit(sql, { defaultLimit: 1000, dialect: 'duckdb' });
    expect(result).toContain('50');
    expect(result).toContain('1000');
  });

  it('UNION queries get LIMIT', async () => {
    const result = await enforceQueryLimit('SELECT * FROM users UNION SELECT * FROM admins', { defaultLimit: 1000, dialect: 'postgres' });
    expect(result.toUpperCase()).toContain('LIMIT 1000');
  });

  it('UNION with existing over-max LIMIT is capped', async () => {
    const result = await enforceQueryLimit('SELECT * FROM users UNION SELECT * FROM admins LIMIT 50000', { maxLimit: 10000, dialect: 'duckdb' });
    expect(result.toUpperCase()).toContain('LIMIT 10000');
    expect(result).not.toContain('50000');
  });

  it('parse error returns original SQL', async () => {
    const sql = 'SELECT * FROM users WHERE x = ';
    const result = await enforceQueryLimit(sql, { defaultLimit: 1000, dialect: 'duckdb' });
    expect(result).toBe(sql);
  });

  it('INSERT query — no LIMIT added', async () => {
    const sql = "INSERT INTO users (name) VALUES ('Alice')";
    const result = await enforceQueryLimit(sql, { defaultLimit: 1000, dialect: 'postgres' });
    expect(result.toUpperCase()).not.toContain('LIMIT');
  });

  it('UPDATE query — no LIMIT added', async () => {
    const sql = "UPDATE users SET name = 'Bob' WHERE id = 1";
    const result = await enforceQueryLimit(sql, { defaultLimit: 1000, dialect: 'bigquery' });
    expect(result.toUpperCase()).not.toContain('LIMIT');
  });

  it('DELETE query — no LIMIT added', async () => {
    const sql = 'DELETE FROM users WHERE id = 1';
    const result = await enforceQueryLimit(sql, { defaultLimit: 1000, dialect: 'duckdb' });
    expect(result.toUpperCase()).not.toContain('LIMIT');
  });

  it('CREATE TABLE — no LIMIT added', async () => {
    const sql = 'CREATE TABLE users (id INTEGER, name TEXT)';
    const result = await enforceQueryLimit(sql, { defaultLimit: 1000, dialect: 'postgres' });
    expect(result.toUpperCase()).not.toContain('LIMIT');
  });

  it('case insensitive keywords', async () => {
    const result = await enforceQueryLimit('select * from users', { defaultLimit: 1000, dialect: 'bigquery' });
    expect(result.toUpperCase()).toContain('LIMIT 1000');
  });

  it('multiple UNIONs', async () => {
    const sql = 'SELECT * FROM users UNION SELECT * FROM admins UNION SELECT * FROM guests';
    const result = await enforceQueryLimit(sql, { defaultLimit: 1000, dialect: 'duckdb' });
    expect(result.toUpperCase()).toContain('LIMIT 1000');
  });

  it('INTERSECT queries', async () => {
    const result = await enforceQueryLimit('SELECT * FROM users INTERSECT SELECT * FROM admins', { defaultLimit: 1000, dialect: 'postgres' });
    expect(result.toUpperCase()).toContain('LIMIT 1000');
  });

  it('EXCEPT queries', async () => {
    const result = await enforceQueryLimit('SELECT * FROM users EXCEPT SELECT * FROM admins', { defaultLimit: 1000, dialect: 'postgres' });
    expect(result.toUpperCase()).toContain('LIMIT 1000');
  });

  it('nested subqueries — only one LIMIT added at root', async () => {
    const sql = 'SELECT * FROM (SELECT * FROM (SELECT * FROM users) a) b';
    const result = await enforceQueryLimit(sql, { defaultLimit: 1000, dialect: 'duckdb' });
    const limitCount = (result.toUpperCase().match(/LIMIT/g) || []).length;
    expect(limitCount).toBe(1);
    expect(result.toUpperCase()).toContain('LIMIT 1000');
  });

  // --- Named parameter preservation ---

  it('postgres preserves :param in date filter', async () => {
    const sql = 'SELECT COUNT(DISTINCT id) AS total_users FROM stores WHERE created_at > :date_min';
    const result = await enforceQueryLimit(sql, { defaultLimit: 1000, dialect: 'postgres' });
    expect(result).toContain(':date_min');
    expect(result.toUpperCase()).toContain('LIMIT 1000');
  });

  it('postgres preserves :param in number filter', async () => {
    const sql = 'SELECT * FROM orders WHERE amount > :min_amount';
    const result = await enforceQueryLimit(sql, { defaultLimit: 1000, dialect: 'postgres' });
    expect(result).toContain(':min_amount');
  });

  it('postgres preserves multiple :params', async () => {
    const sql = 'SELECT * FROM events WHERE created_at > :date_min AND created_at < :date_max';
    const result = await enforceQueryLimit(sql, { defaultLimit: 1000, dialect: 'postgres' });
    expect(result).toContain(':date_min');
    expect(result).toContain(':date_max');
  });

  it('postgres preserves :param in text filter', async () => {
    const sql = 'SELECT * FROM users WHERE name = :name_val';
    const result = await enforceQueryLimit(sql, { defaultLimit: 1000, dialect: 'postgres' });
    expect(result).toContain(':name_val');
  });

  it('duckdb preserves :param', async () => {
    const sql = 'SELECT * FROM stores WHERE created_at > :date_min';
    const result = await enforceQueryLimit(sql, { defaultLimit: 1000, dialect: 'duckdb' });
    expect(result).toContain(':date_min');
  });

  it('bigquery preserves :param', async () => {
    const sql = 'SELECT * FROM stores WHERE created_at > :date_min';
    const result = await enforceQueryLimit(sql, { defaultLimit: 1000, dialect: 'bigquery' });
    expect(result).toContain(':date_min');
  });
});
