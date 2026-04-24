/**
 * E2E Test: Import/Export with conflict preview and merge
 *
 * Tests the complete flat-format import/export flow:
 * 1. Create initial DB with users and documents
 * 2. Export and verify flat structure
 * 3. Import new data and verify replacement
 * 4. Test metadata extraction
 */

// Must be hoisted before any imports that touch the DB
jest.mock('@/lib/database/db-config', () => ({
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

import {
  InitData,
  exportDatabase,
  atomicImport,
} from '@/lib/database/import-export';
import { LATEST_DATA_VERSION } from '@/lib/database/constants';

// Create test data in flat format
function createTestData(userCount: number, docCount: number): { users: InitData['users']; documents: InitData['documents'] } {
  return {
    users: Array.from({ length: userCount }, (_, i) => ({
      id: i + 1,
      email: `user${i + 1}@example.com`,
      name: `User ${i + 1}`,
      password_hash: 'hash',
      phone: null,
      state: null,
      home_folder: '/org',
      role: i === 0 ? 'admin' as const : 'viewer' as const,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })),
    documents: Array.from({ length: docCount }, (_, i) => ({
      id: i + 1,
      name: `Document ${i + 1}`,
      path: `/org/doc${i + 1}`,
      type: i === 0 ? 'connection' as const : 'question' as const,
      references: [],
      content: i === 0
        ? { type: 'duckdb' as const, name: 'test', database_type: 'duckdb', config: { file_path: 'test.duckdb' } } as any
        : { query: 'SELECT 1', connection_name: 'test_db', vizSettings: { type: 'table' } },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
      last_edit_id: null,
    }))
  };
}

describe('Import/Export E2E', () => {
  beforeEach(async () => {
    const { getModules } = await import('@/lib/modules/registry');
    await getModules().db.reset?.();
  });

  afterEach(async () => {
    const { getModules } = await import('@/lib/modules/registry');
    await getModules().db.reset?.();
  });

  it('should import and export flat data correctly', async () => {
    const { users, documents } = createTestData(2, 3);
    const initialData: InitData = { version: LATEST_DATA_VERSION, users, documents };

    await atomicImport(initialData, '');

    const exportedData = await exportDatabase('');

    expect(exportedData.users).toHaveLength(2);
    expect(exportedData.documents).toHaveLength(3);
    expect(exportedData.users![0].email).toBe('user1@example.com');
    expect(exportedData.documents![0].type).toBe('connection');
  });

  it('should replace all data on subsequent import', async () => {
    // First import: 2 users, 3 documents
    const initial = createTestData(2, 3);
    await atomicImport({ version: LATEST_DATA_VERSION, ...initial }, '');

    // Second import: 1 user, 5 documents (fully replaces first)
    const replacement = createTestData(1, 5);
    await atomicImport({ version: LATEST_DATA_VERSION, ...replacement }, '');

    const exportedData = await exportDatabase('');
    expect(exportedData.users).toHaveLength(1);
    expect(exportedData.documents).toHaveLength(5);
  });

  it('should handle import with nested orgs format (flattened automatically)', async () => {
    const initialData: InitData = {
      version: LATEST_DATA_VERSION,
      orgs: [
        {
          id: 1,
          name: 'Alpha',
          display_name: 'Alpha Corp',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          users: [
            { id: 1, email: 'admin@alpha.com', name: 'Admin', password_hash: 'hash', phone: null, state: null, home_folder: '/org', role: 'admin', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
            { id: 2, email: 'user@alpha.com', name: 'User', password_hash: 'hash', phone: null, state: null, home_folder: '/org', role: 'viewer', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
          ],
          documents: [
            { id: 1, name: 'Doc 1', path: '/org/doc1', type: 'question' as const, references: [], content: { query: 'SELECT 1', vizSettings: { type: 'table' as const }, connection_name: '' }, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), version: 1, last_edit_id: null },
            { id: 2, name: 'Doc 2', path: '/org/doc2', type: 'question' as const, references: [], content: { query: 'SELECT 2', vizSettings: { type: 'table' as const }, connection_name: '' }, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), version: 1, last_edit_id: null },
          ]
        }
      ]
    };

    await atomicImport(initialData, '');

    const exportedData = await exportDatabase('');
    expect(exportedData.users).toHaveLength(2);
    expect(exportedData.documents).toHaveLength(2);
  });

});
