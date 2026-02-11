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

export interface TestDbHarness {
  getStore: () => ReturnType<typeof setupTestStore>;
}

export interface TestDbOptions {
  /** Custom initialization function called after base init */
  customInit?: (dbPath: string) => Promise<void>;
  /** Automatically add test connection (id: 'test_connection') */
  withTestConnection?: boolean;
}

/**
 * Common database initialization: adds test connection file
 * Note: Validation not needed here since we're adding to an already valid DB
 */
export async function addTestConnection(dbPath: string) {
  const { createAdapter } = await import('@/lib/database/adapter/factory');
  const db = await createAdapter({ type: 'sqlite', sqlitePath: dbPath });

  const doc = {
    id: 1,
    name: 'default_db',
    path: '/org/connections/test_connection',
    type: 'connection',
    content: {
      id: 'test_connection',
      name: 'default_db',
      type: 'duckdb',
      config: { file_path: 'test.duckdb' }
    },
    company_id: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  await db.query(
    `INSERT INTO files (id, name, path, type, content, company_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      doc.id,
      doc.name,
      doc.path,
      doc.type,
      JSON.stringify(doc.content),
      doc.company_id,
      doc.created_at,
      doc.updated_at
    ]
  );

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
  const { customInit, withTestConnection = false } = options;
  let store: ReturnType<typeof setupTestStore>;

  beforeEach(async () => {
    // Reset adapter to ensure fresh connection
    const { resetAdapter } = await import('@/lib/database/adapter/factory');
    await resetAdapter();

    await initTestDatabase(dbPath);
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
