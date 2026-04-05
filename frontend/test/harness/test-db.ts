/**
 * Test database lifecycle management
 *
 * Handles initializing and cleaning up test databases.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  initTestDatabase,
  cleanupTestDatabase,
  setupTestStore
} from '@/store/__tests__/test-utils';

export interface TestDbHarness {
  getStore: () => ReturnType<typeof setupTestStore>;
}

export interface TestDbOptions {
  /** Custom initialization function called after base init */
  customInit?: (dbPath: string) => Promise<void>;
  /** Automatically add test connection (id: 'test_connection') */
  withTestConnection?: boolean;
  /**
   * Copy the live atlas_documents.db (tutorial data) instead of creating an
   * empty database.  Gives tests access to the full set of tutorial files
   * (questions, dashboards, contexts, etc.) without any manual fixture setup.
   *
   * Compatible with withTestConnection and customInit — those run after the copy.
   */
  withTutorialFiles?: boolean;
}

/** Path to the live tutorial database that seeds the app on first run.
 *  Mirrors the IS_DEV resolution in db-config.ts: one level up from frontend/. */
const TUTORIAL_DB_PATH = path.join(process.cwd(), '..', 'data', 'atlas_documents.db');

/**
 * Initialise a test database from the live tutorial data.
 * Deletes any stale test DB first, then copies atlas_documents.db.
 */
async function initTutorialDatabase(dbPath: string): Promise<void> {
  [dbPath, `${dbPath}-shm`, `${dbPath}-wal`].forEach(f => {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  });
  if (!fs.existsSync(TUTORIAL_DB_PATH)) {
    throw new Error(
      `Tutorial database not found at ${TUTORIAL_DB_PATH}. ` +
      `Run \`npm run import-db -- --replace-db=y\` to create it.`
    );
  }
  fs.copyFileSync(TUTORIAL_DB_PATH, dbPath);
}

/**
 * Common database initialization: adds test connection file
 * Note: Validation not needed here since we're adding to an already valid DB
 */
export async function addTestConnection(dbPath: string) {
  const { createAdapter } = await import('@/lib/database/adapter/factory');
  const db = await createAdapter({ type: 'sqlite', sqlitePath: dbPath });

  const now = new Date().toISOString();

  // Use INSERT OR IGNORE on path so re-running is idempotent and tutorial DBs
  // (which may already have files at id=1) don't cause conflicts.
  // Check if connection already exists (idempotent for tutorial DBs)
  const existing = await db.query<{ id: number }>(
    `SELECT id FROM files WHERE company_id = $1 AND path = $2`,
    [1, '/org/connections/test_connection']
  );

  if (existing.rows.length === 0) {
    // Get next id (same pattern as DocumentDB.create for SQLite)
    const maxIdResult = await db.query<{ next_id: number }>(
      `SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM files WHERE company_id = $1`,
      [1]
    );
    const nextId = maxIdResult.rows[0].next_id;

    await db.query(
      `INSERT INTO files (company_id, id, name, path, type, content, file_references, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        1, nextId,
        'default_db',
        '/org/connections/test_connection',
        'connection',
        JSON.stringify({ id: 'test_connection', name: 'default_db', type: 'duckdb', config: { file_path: 'test.duckdb' } }),
        '[]',
        now,
        now
      ]
    );
  }

  await db.close();
}

/**
 * Ensure mxfood.duckdb exists at data/mxfood.duckdb (repo root).
 * Downloads from GitHub releases if missing. Safe to call multiple times.
 */
export async function ensureMxfoodDataset(): Promise<void> {
  const { execSync } = require('child_process');
  const datasetPath = path.join(process.cwd(), '..', 'data', 'mxfood.duckdb');
  if (fs.existsSync(datasetPath)) return;

  const dir = path.dirname(datasetPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  console.log('📥 Downloading mxfood.duckdb...');
  execSync(
    `curl -fSL -o "${datasetPath}" https://github.com/minusxai/sample_datasets/releases/download/v1.0/mxfood.duckdb`,
    { stdio: 'inherit' }
  );
  console.log('✅ mxfood.duckdb downloaded');
}

/**
 * Add a mxfood DuckDB connection to the test database.
 * file_path "data/mxfood.duckdb" resolves via BASE_DUCKDB_DATA_PATH=.. to
 * ../data/mxfood.duckdb relative to the backend directory.
 */
export async function addMxfoodConnection(dbPath: string) {
  const { createAdapter } = await import('@/lib/database/adapter/factory');
  const db = await createAdapter({ type: 'sqlite', sqlitePath: dbPath });

  const now = new Date().toISOString();
  const connectionPath = '/org/connections/mxfood';

  const existing = await db.query<{ id: number }>(
    `SELECT id FROM files WHERE company_id = $1 AND path = $2`,
    [1, connectionPath]
  );

  if (existing.rows.length === 0) {
    const maxIdResult = await db.query<{ next_id: number }>(
      `SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM files WHERE company_id = $1`,
      [1]
    );
    const nextId = maxIdResult.rows[0].next_id;

    await db.query(
      `INSERT INTO files (company_id, id, name, path, type, content, file_references, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        1, nextId,
        'mxfood',
        connectionPath,
        'connection',
        JSON.stringify({ id: 'mxfood', name: 'mxfood', type: 'duckdb', config: { file_path: 'data/mxfood.duckdb' } }),
        '[]',
        now,
        now
      ]
    );
  }

  await db.close();
}

/**
 * Sets up test database with automatic initialization and cleanup.
 *
 * Usage:
 * ```ts
 * // Basic usage
 * const { getStore } = setupTestDb(getTestDbPath('e2e'));
 *
 * // With custom initialization
 * const { getStore } = setupTestDb(getTestDbPath('nested_tools'), {
 *   customInit: async (dbPath) => {
 *     // Add custom test data
 *     const { createAdapter } = await import('@/lib/database/adapter/factory');
 *     const db = await createAdapter({ type: 'sqlite', sqlitePath: dbPath });
 *     await db.query('INSERT INTO files ...', [...]);
 *     await db.close();
 *   }
 * });
 *
 * it('should work', () => {
 *   const store = getStore();
 *   // use store in test
 * });
 * ```
 */
export function setupTestDb(dbPath: string, options: TestDbOptions = {}): TestDbHarness {
  const { customInit, withTestConnection = false, withTutorialFiles = false } = options;
  let store: ReturnType<typeof setupTestStore>;

  beforeEach(async () => {
    // Reset adapter to ensure fresh connection
    const { resetAdapter } = await import('@/lib/database/adapter/factory');
    await resetAdapter();

    if (withTutorialFiles) {
      await initTutorialDatabase(dbPath);
    } else {
      await initTestDatabase(dbPath);
    }
    if (withTestConnection) {
      await addTestConnection(dbPath);
    }
    if (customInit) {
      await customInit(dbPath);
    }
    store = setupTestStore();
    jest.clearAllMocks();
  });

  afterEach(async () => {
    // Clean up database adapter after each test to prevent memory leaks
    const { resetAdapter } = await import('@/lib/database/adapter/factory');
    await resetAdapter();

    // Clear Redux store reference
    store = null as any;

    // Force garbage collection if available (run tests with --expose-gc)
    if (global.gc) {
      global.gc();
    }
  });

  afterAll(async () => {
    await cleanupTestDatabase(dbPath);
    // Note: SessionTokenManager no longer needs cleanup (uses JWTs, not intervals)
  });

  return {
    getStore: () => store
  };
}
