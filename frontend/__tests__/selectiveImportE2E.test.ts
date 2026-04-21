/**
 * E2E Test: Import/Export with conflict preview and merge
 *
 * Tests the complete flat-format import/export flow:
 * 1. Create initial DB with users and documents
 * 2. Export and verify flat structure
 * 3. Import new data and verify replacement
 * 4. Test metadata extraction
 */

import * as path from 'path';
import {
  InitData,
  exportDatabase,
  atomicImport,
} from '@/lib/database/import-export';
import { createEmptyDatabase } from '@/scripts/create-empty-db';

const TEST_DB_PATH = path.join(process.cwd(), 'data', 'test_selective_import.db');

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
    // Clean up any existing test database
    try {
      const fs = require('fs');
      [TEST_DB_PATH, TEST_DB_PATH + '-wal', TEST_DB_PATH + '-shm', TEST_DB_PATH + '.backup'].forEach(p => {
        if (fs.existsSync(p)) {
          fs.unlinkSync(p);
        }
      });
    } catch (err) {
      // Ignore cleanup errors
    }

    // Create fresh empty database
    await createEmptyDatabase(TEST_DB_PATH);
  });

  afterEach(async () => {
    // Clean up test database
    try {
      const { resetAdapter } = await import('@/lib/database/adapter/factory');
      await resetAdapter();

      const fs = require('fs');
      [TEST_DB_PATH, TEST_DB_PATH + '-wal', TEST_DB_PATH + '-shm', TEST_DB_PATH + '.backup'].forEach(p => {
        if (fs.existsSync(p)) {
          fs.unlinkSync(p);
        }
      });
    } catch (err) {
      // Ignore cleanup errors
    }
  });

  it('should import and export flat data correctly', async () => {
    const { users, documents } = createTestData(2, 3);
    const initialData: InitData = { version: 2, users, documents };

    await atomicImport(initialData, TEST_DB_PATH);

    const exportedData = await exportDatabase(TEST_DB_PATH);

    expect(exportedData.users).toHaveLength(2);
    expect(exportedData.documents).toHaveLength(3);
    expect(exportedData.users![0].email).toBe('user1@example.com');
    expect(exportedData.documents![0].type).toBe('connection');
  });

  it('should replace all data on subsequent import', async () => {
    // First import: 2 users, 3 documents
    const initial = createTestData(2, 3);
    await atomicImport({ version: 2, ...initial }, TEST_DB_PATH);

    // Second import: 1 user, 5 documents (fully replaces first)
    const replacement = createTestData(1, 5);
    await atomicImport({ version: 2, ...replacement }, TEST_DB_PATH);

    const exportedData = await exportDatabase(TEST_DB_PATH);
    expect(exportedData.users).toHaveLength(1);
    expect(exportedData.documents).toHaveLength(5);
  });

  it('should handle import with nested orgs format (flattened automatically)', async () => {
    const initialData: InitData = {
      version: 2,
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

    await atomicImport(initialData, TEST_DB_PATH);

    const exportedData = await exportDatabase(TEST_DB_PATH);
    expect(exportedData.users).toHaveLength(2);
    expect(exportedData.documents).toHaveLength(2);
  });

});
