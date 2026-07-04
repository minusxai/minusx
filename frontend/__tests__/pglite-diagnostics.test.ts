/**
 * PGLite Diagnostics Test
 *
 * Run with:   npm test -- "pglite-diagnostics" --no-coverage --verbose
 *
 * This test isolates exactly which SQL operations succeed or abort in PGLite,
 * independent of the rest of the stack. Keep this file until all CI tests pass.
 *
 * NOTE: PGLite cold-boot is ~5–8s. Tests that need a fresh DB share a single
 * `beforeAll` instance per describe block where it doesn't change semantics —
 * the operations under test are namespaced (different schemas / different
 * table names) so they coexist on one instance.
 */

import { PGlite } from '@electric-sql/pglite';
import { POSTGRES_SCHEMA, splitSQLStatements } from '@/lib/database/postgres-schema';
import { getModules } from '@/lib/modules/registry';
import { truncateAllTables } from '@/store/__tests__/test-utils';

// ─── 1. Raw PGLite: run ALL schema statements in sequence ─────────────────────
// Uses a SINGLE PGlite instance, properly awaited before tests run.

describe('1. Raw PGLite — all POSTGRES_SCHEMA stmts in sequence', () => {
  const stmts = splitSQLStatements(POSTGRES_SCHEMA);

  it(`runs all ${stmts.length} stmts without crash`, async () => {
    const db = new PGlite();
    await db.waitReady;
    const failed: string[] = [];
    for (let i = 0; i < stmts.length; i++) {
      const stmt = stmts[i];
      if (/^\s*CREATE\s+SCHEMA\b/i.test(stmt)) {
        console.log(`  SKIP [${i}] CREATE SCHEMA`);
        continue;
      }
      try {
        await db.exec(stmt);
        console.log(`  OK   [${i}] ${stmt.slice(0, 60).replace(/\n/g, ' ')}`);
      } catch (e: any) {
        if (e?.code === '23505' || e?.code === '42710') continue;
        failed.push(`[${i}] ${stmt.slice(0, 80)}: ${e?.message ?? e}`);
        console.error(`  FAIL [${i}] ${stmt.slice(0, 80)} — ${e?.message ?? e}`);
        // If WASM abort, the db is dead — stop
        if (e instanceof Error && e.message?.includes('Aborted')) break;
      }
    }
    expect(failed).toEqual([]);
  });
});

// ─── 2. Raw PGLite: CREATE SCHEMA + DDL routing operations ───────────────────
// All these tests verify that specific SQL forms work on a freshly-booted PGLite.
// They use different schema names / table names so they coexist on a single
// instance without interfering — share one cold-boot across all 5 checks.

describe('2. Raw PGLite — CREATE SCHEMA behaviour', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = new PGlite();
    await db.waitReady;
  });

  it('CREATE SCHEMA IF NOT EXISTS public — fresh db', async () => {
    await db.exec('CREATE SCHEMA IF NOT EXISTS public');
  });

  it('CREATE SCHEMA IF NOT EXISTS my_test_schema — fresh db', async () => {
    await db.exec('CREATE SCHEMA IF NOT EXISTS my_test_schema');
  });

  it('SET search_path TO public — fresh db', async () => {
    await db.exec('SET search_path TO public');
  });

  it('query() DDL: CREATE TABLE via query()', async () => {
    await db.query('CREATE TABLE IF NOT EXISTS t1 (id INT)');
  });

  it('query() DDL: CREATE SCHEMA via query()', async () => {
    await db.query('CREATE SCHEMA IF NOT EXISTS s1');
  });
});

// ─── 3. DBModule.exec routing ─────────────────────────────────────────────────

describe('3. DBModule.exec — routing (no-params + no-semicolon goes to query())', () => {
  beforeAll(async () => {
    // Init once — PGlite WASM cannot restart after close(); truncate data between tests instead.
    await getModules().db.exec<{ one: number }>('SELECT 1 AS one', []);
  });

  beforeEach(truncateAllTables);

  it('CREATE SCHEMA via DBModule.exec (no params, no semicolon → query())', async () => {
    await getModules().db.exec('CREATE SCHEMA IF NOT EXISTS diag_schema');
  });

  it('SELECT 1 via DBModule.exec', async () => {
    const result = await getModules().db.exec<{ one: number }>('SELECT 1 AS one', []);
    expect(result.rows[0]?.one).toBe(1);
  });

  it('INSERT+SELECT round-trip via DBModule.exec', async () => {
    await getModules().db.exec('CREATE TABLE IF NOT EXISTS diag_t (id INT, val TEXT)');
    await getModules().db.exec('INSERT INTO diag_t (id, val) VALUES ($1, $2)', [1, 'hello']);
    const r = await getModules().db.exec<{ id: number; val: string }>('SELECT id, val FROM diag_t WHERE id = $1', [1]);
    expect(r.rows[0]?.val).toBe('hello');
  });
});

// ─── 4. Full initializeSchema (via getAdapter) ────────────────────────────────
// One reset() shared across both checks — both want a freshly-initialised
// DBModule adapter; reset()ing twice in a row just pays the PGLite cold-boot cost
// twice for the same observation.

describe('4. Full initializeSchema via getAdapter()', () => {
  beforeAll(async () => {
    await getModules().db.reset?.();
    // Force adapter creation + initializeSchema once for the whole describe.
    await getModules().db.exec<{ one: number }>('SELECT 1 AS one', []);
  });

  it('initializes without crashing', async () => {
    const result = await getModules().db.exec<{ one: number }>('SELECT 1 AS one', []);
    expect(result.rows[0]?.one).toBe(1);
  });

  it('SELECT from files table after init', async () => {
    const r = await getModules().db.exec<{ count: number }>('SELECT COUNT(*) AS count FROM files', []);
    expect(r.rows[0]?.count).toBeDefined();
  });
});

// ─── 5. Named-schema setup (setupTestDb pattern) ──────────────────────────────

describe('5. Named schema creation (setupTestDb pattern)', () => {
  it('creates named schema and runs DDL inside it', async () => {
    await getModules().db.reset?.();
    await getModules().db.exec('SELECT 1 AS one', []); // force initializeSchema
    await getModules().db.exec('CREATE SCHEMA IF NOT EXISTS diag_named');
    await getModules().db.exec('SET search_path TO diag_named');
    const stmts = splitSQLStatements(POSTGRES_SCHEMA);
    for (const stmt of stmts) {
      if (/^\s*CREATE\s+SCHEMA\b/i.test(stmt)) continue;
      try {
        await getModules().db.exec(stmt);
      } catch (e: any) {
        if (e?.code === '23505' || e?.code === '42710') continue;
        throw new Error(`DDL failed: ${stmt.slice(0, 80)} — ${e?.message}`);
      }
    }
    const r = await getModules().db.exec<{ count: number }>('SELECT COUNT(*) AS count FROM files', []);
    expect(r.rows[0]?.count).toBeDefined();
  });
});
