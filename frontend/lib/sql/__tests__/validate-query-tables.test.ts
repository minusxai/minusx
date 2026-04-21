/**
 * E2E tests for validateQueryTables
 *
 * These tests call the function end-to-end through the Python backend's
 * /api/validate-query-tables endpoint (sqlglot). They cover the same
 * behavioural contract that the previous node-sql-parser implementation had.
 *
 * TDD Red→Blue: tests were written first (with the new async signature), the
 * Python endpoint was added, and these tests confirm the behaviour is preserved.
 */

import { validateQueryTables, type WhitelistEntry } from '../validate-query-tables';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const TEST_USER: EffectiveUser = {
  userId: 1,
  email: 'test@example.com',
  name: 'Test User',
  role: 'admin',
  home_folder: '/org',
  mode: 'org',
};

/** Whitelist: only public.users is allowed */
const WHITELIST_USERS_ONLY: WhitelistEntry[] = [
  { schema: 'public', tables: [{ table: 'users' }] },
];

/** Whitelist with multiple tables across schemas */
const WHITELIST_MULTI: WhitelistEntry[] = [
  { schema: 'public', tables: [{ table: 'users' }, { table: 'accounts' }] },
  { schema: 'analytics', tables: [{ table: 'events' }] },
];

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('validateQueryTables — local WASM', () => {

  // ── Empty / no-op cases ──────────────────────────────────────────────────

  it('returns null for an empty whitelist (no restriction)', async () => {
    const result = await validateQueryTables('SELECT * FROM orders', [], TEST_USER);
    expect(result).toBeNull();
  });

  it('returns null when whitelist is undefined-like (empty)', async () => {
    const result = await validateQueryTables('SELECT * FROM orders', [] as WhitelistEntry[], TEST_USER);
    expect(result).toBeNull();
  });

  // ── Allowed tables ────────────────────────────────────────────────────────

  it('returns null when all referenced tables are whitelisted', async () => {
    const result = await validateQueryTables('SELECT id, name FROM users', WHITELIST_USERS_ONLY, TEST_USER);
    expect(result).toBeNull();
  });

  it('returns null for schema-qualified allowed reference (public.users)', async () => {
    const result = await validateQueryTables('SELECT * FROM public.users', WHITELIST_USERS_ONLY, TEST_USER);
    expect(result).toBeNull();
  });

  it('returns null when all tables across multiple schemas are whitelisted', async () => {
    const sql = 'SELECT u.id, e.event FROM public.users u JOIN analytics.events e ON u.id = e.user_id';
    const result = await validateQueryTables(sql, WHITELIST_MULTI, TEST_USER);
    expect(result).toBeNull();
  });

  // ── Blocked tables ────────────────────────────────────────────────────────

  it('returns an error string when a table is not in the whitelist', async () => {
    const result = await validateQueryTables('SELECT * FROM orders', WHITELIST_USERS_ONLY, TEST_USER);
    expect(result).not.toBeNull();
    expect(typeof result).toBe('string');
    expect(result).toMatch(/orders/i);
  });

  it('error message mentions the blocked table name', async () => {
    const result = await validateQueryTables('SELECT * FROM secret_data', WHITELIST_USERS_ONLY, TEST_USER);
    expect(result).toMatch(/secret_data/i);
  });

  it('returns an error when one table in a multi-table query is blocked', async () => {
    const sql = 'SELECT u.id FROM users u JOIN restricted_table r ON u.id = r.user_id';
    const result = await validateQueryTables(sql, WHITELIST_USERS_ONLY, TEST_USER);
    expect(result).not.toBeNull();
    expect(result).toMatch(/restricted_table/i);
  });

  it('returns an error for wrong-schema qualified reference (analytics.users not in whitelist)', async () => {
    // analytics.users is not in WHITELIST_USERS_ONLY (only public.users is)
    const result = await validateQueryTables('SELECT * FROM analytics.users', WHITELIST_USERS_ONLY, TEST_USER);
    expect(result).not.toBeNull();
  });

  // ── CTE handling ─────────────────────────────────────────────────────────

  it('does not flag a CTE whose name matches a blocked table', async () => {
    // "orders" is not whitelisted, but here it is a CTE — not a real table
    const sql = 'WITH orders AS (SELECT 1 AS id) SELECT id FROM orders';
    const result = await validateQueryTables(sql, WHITELIST_USERS_ONLY, TEST_USER);
    expect(result).toBeNull();
  });

  it('flags a real table referenced inside a CTE body', async () => {
    // "secret_table" is the real table inside the CTE body — should be blocked
    const sql = 'WITH cte AS (SELECT * FROM secret_table) SELECT * FROM cte';
    const result = await validateQueryTables(sql, WHITELIST_USERS_ONLY, TEST_USER);
    expect(result).not.toBeNull();
    expect(result).toMatch(/secret_table/i);
  });

  // ── Error tolerance ───────────────────────────────────────────────────────

  it('returns null for unparseable SQL (allow through — execution layer surfaces errors)', async () => {
    const result = await validateQueryTables('NOT VALID SQL !!! ###', WHITELIST_USERS_ONLY, TEST_USER);
    expect(result).toBeNull();
  });

  it('returns null for an empty SQL string', async () => {
    const result = await validateQueryTables('', WHITELIST_USERS_ONLY, TEST_USER);
    expect(result).toBeNull();
  });
});
