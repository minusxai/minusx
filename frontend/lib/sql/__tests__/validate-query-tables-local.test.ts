/**
 * Tests for validateQueryTablesLocal (polyglot WASM).
 * Ported from validate-query-tables.test.ts E2E tests to run without Python backend.
 */
import { validateQueryTablesLocal, type WhitelistEntry } from '../validate-query-tables';

/** Whitelist: only public.users is allowed */
const WHITELIST_USERS_ONLY: WhitelistEntry[] = [
  { schema: 'public', tables: [{ table: 'users' }] },
];

/** Whitelist with multiple tables across schemas */
const WHITELIST_MULTI: WhitelistEntry[] = [
  { schema: 'public', tables: [{ table: 'users' }, { table: 'accounts' }] },
  { schema: 'analytics', tables: [{ table: 'events' }] },
];

describe('validateQueryTablesLocal (polyglot WASM)', () => {
  // ── Empty / no-op cases ──────────────────────────────────────────────────

  it('returns null for an empty whitelist (no restriction)', async () => {
    const result = await validateQueryTablesLocal('SELECT * FROM orders', []);
    expect(result).toBeNull();
  });

  // ── Allowed tables ────────────────────────────────────────────────────────

  it('returns null when all referenced tables are whitelisted', async () => {
    const result = await validateQueryTablesLocal('SELECT id, name FROM users', WHITELIST_USERS_ONLY);
    expect(result).toBeNull();
  });

  it('returns null for schema-qualified allowed reference (public.users)', async () => {
    const result = await validateQueryTablesLocal('SELECT * FROM public.users', WHITELIST_USERS_ONLY);
    expect(result).toBeNull();
  });

  it('returns null when all tables across multiple schemas are whitelisted', async () => {
    const sql = 'SELECT u.id, e.event FROM public.users u JOIN analytics.events e ON u.id = e.user_id';
    const result = await validateQueryTablesLocal(sql, WHITELIST_MULTI);
    expect(result).toBeNull();
  });

  // ── Blocked tables ────────────────────────────────────────────────────────

  it('returns an error string when a table is not in the whitelist', async () => {
    const result = await validateQueryTablesLocal('SELECT * FROM orders', WHITELIST_USERS_ONLY);
    expect(result).not.toBeNull();
    expect(typeof result).toBe('string');
    expect(result).toMatch(/orders/i);
  });

  it('error message mentions the blocked table name', async () => {
    const result = await validateQueryTablesLocal('SELECT * FROM secret_data', WHITELIST_USERS_ONLY);
    expect(result).toMatch(/secret_data/i);
  });

  it('returns an error when one table in a multi-table query is blocked', async () => {
    const sql = 'SELECT u.id FROM users u JOIN restricted_table r ON u.id = r.user_id';
    const result = await validateQueryTablesLocal(sql, WHITELIST_USERS_ONLY);
    expect(result).not.toBeNull();
    expect(result).toMatch(/restricted_table/i);
  });

  it('returns an error for wrong-schema qualified reference (analytics.users not in whitelist)', async () => {
    const result = await validateQueryTablesLocal('SELECT * FROM analytics.users', WHITELIST_USERS_ONLY);
    expect(result).not.toBeNull();
  });

  // ── CTE handling ─────────────────────────────────────────────────────────

  it('does not flag a CTE whose name matches a blocked table', async () => {
    const sql = 'WITH orders AS (SELECT 1 AS id) SELECT id FROM orders';
    const result = await validateQueryTablesLocal(sql, WHITELIST_USERS_ONLY);
    expect(result).toBeNull();
  });

  it('flags a real table referenced inside a CTE body', async () => {
    const sql = 'WITH cte AS (SELECT * FROM secret_table) SELECT * FROM cte';
    const result = await validateQueryTablesLocal(sql, WHITELIST_USERS_ONLY);
    expect(result).not.toBeNull();
    expect(result).toMatch(/secret_table/i);
  });

  // ── Error tolerance ───────────────────────────────────────────────────────

  it('returns null for unparseable SQL (allow through)', async () => {
    const result = await validateQueryTablesLocal('NOT VALID SQL !!! ###', WHITELIST_USERS_ONLY);
    expect(result).toBeNull();
  });

  it('returns null for an empty SQL string', async () => {
    const result = await validateQueryTablesLocal('', WHITELIST_USERS_ONLY);
    expect(result).toBeNull();
  });
});
