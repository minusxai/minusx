/**
 * Test database lifecycle management
 *
 * Handles initializing and cleaning up test databases.
 */

import {
  initTestDatabase,
  cleanupTestDatabase,
  setupTestStore
} from '@/store/__tests__/test-utils';
import { initializeDatabase } from '@/lib/database/import-export';

export interface TestDbHarness {
  getStore: () => ReturnType<typeof setupTestStore>;
}

export interface TestDbOptions {
  /** Custom initialization function called after base init */
  customInit?: (dbPath: string) => Promise<void>;
  /** Automatically add test connection (id: 'test_connection') */
  withTestConnection?: boolean;
  /**
   * Seed the database with full tutorial data from workspace-template.json
   * instead of creating a minimal empty database.
   * Gives tests access to the full set of tutorial files
   * (questions, dashboards, contexts, etc.) without any manual fixture setup.
   *
   * Compatible with withTestConnection and customInit — those run after seeding.
   */
  withTutorialFiles?: boolean;
}

/**
 * Initialise a test database from the tutorial template (workspace-template.json).
 * This gives tests the same data set the app seeds on first run.
 */
async function initTutorialDatabase(dbPath: string): Promise<void> {
  await initializeDatabase('Test User', 'test@example.com', 'password', dbPath);
}

/**
 * Common database initialization: adds test connection file
 */
export async function addTestConnection(_dbPath: string) {
  const { getAdapter } = await import('@/lib/database/adapter/factory');
  const db = await getAdapter();

  const now = new Date().toISOString();

  const existing = await db.query<{ id: number }>(
    `SELECT id FROM files WHERE path = $1`,
    ['/org/connections/test_connection']
  );

  if (existing.rows.length === 0) {
    const maxIdResult = await db.query<{ next_id: number }>(
      `SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM files`,
      []
    );
    const nextId = maxIdResult.rows[0].next_id;

    await db.query(
      `INSERT INTO files (id, name, path, type, content, file_references, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        nextId,
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
}

/**
 * Ensure mxfood.duckdb exists at data/mxfood.duckdb (repo root).
 * Downloads from GitHub releases if missing. Safe to call multiple times.
 */
export async function ensureMxfoodDataset(): Promise<void> {
  const { execSync } = require('child_process');
  const fs = require('fs');
  const path = require('path');
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
 */
export async function addMxfoodConnection(_dbPath: string) {
  const { getAdapter } = await import('@/lib/database/adapter/factory');
  const db = await getAdapter();

  const now = new Date().toISOString();
  const connectionPath = '/org/connections/mxfood';

  const existing = await db.query<{ id: number }>(
    `SELECT id FROM files WHERE path = $1`,
    [connectionPath]
  );

  if (existing.rows.length === 0) {
    const maxIdResult = await db.query<{ next_id: number }>(
      `SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM files`,
      []
    );
    const nextId = maxIdResult.rows[0].next_id;

    await db.query(
      `INSERT INTO files (id, name, path, type, content, file_references, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        nextId,
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
}

/**
 * Sets up test database with automatic initialization and cleanup.
 *
 * Usage:
 * ```ts
 * const { getStore } = setupTestDb(getTestDbPath('e2e'));
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
    const { resetAdapter } = await import('@/lib/database/adapter/factory');
    await resetAdapter();

    store = null as any;

    if (global.gc) {
      global.gc();
    }
  });

  afterAll(async () => {
    await cleanupTestDatabase(dbPath);
  });

  return {
    getStore: () => store
  };
}
