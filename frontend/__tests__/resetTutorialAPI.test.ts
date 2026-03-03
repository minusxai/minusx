/**
 * E2E Test: POST /api/admin/reset-tutorial
 *
 * Tests the admin endpoint that wipes tutorial-mode state and restores
 * the 27 canonical tutorial documents from company-template.json.
 *
 * Run: npm test -- __tests__/resetTutorialAPI.test.ts
 */

import { NextRequest } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

// Define test DB path BEFORE mocking (jest hoisting)
const TEST_DB_PATH = path.join(process.cwd(), 'data', 'test_reset_tutorial_api.db');

// Mock database config
jest.mock('@/lib/database/db-config', () => ({
  DB_PATH: path.join(process.cwd(), 'data', 'test_reset_tutorial_api.db'),
  DB_DIR: path.join(process.cwd(), 'data'),
  getDbType: () => 'sqlite' as const
}));

// Import after mocking
import { createEmptyDatabase } from '@/scripts/create-empty-db';
import { setDataVersion } from '@/lib/database/config-db';

// Import API route handler AFTER mocking
import { POST as resetTutorialHandler } from '@/app/api/admin/reset-tutorial/route';

// Mock auth helpers to return test users
const mockGetEffectiveUser = jest.fn();
jest.mock('@/lib/auth/auth-helpers', () => ({
  getEffectiveUser: () => mockGetEffectiveUser()
}));

// Helper to create mock NextRequest
function createMockRequest(url = 'http://localhost:3000/api/admin/reset-tutorial'): NextRequest {
  return new NextRequest(url, { method: 'POST' });
}

describe('POST /api/admin/reset-tutorial', () => {
  beforeEach(async () => {
    const { resetAdapter, createAdapter } = await import('@/lib/database/adapter/factory');

    // Reset adapter to close any existing connections
    await resetAdapter();

    // Clean up test database files
    [TEST_DB_PATH, TEST_DB_PATH + '-wal', TEST_DB_PATH + '-shm', TEST_DB_PATH + '.backup'].forEach(filePath => {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    });

    // Create empty database with schema
    await createEmptyDatabase(TEST_DB_PATH);
    await resetAdapter();

    // Set data version
    const db = await createAdapter({ type: 'sqlite', sqlitePath: TEST_DB_PATH });
    await setDataVersion(15, db);
    await db.close();
    await resetAdapter();

    // Insert base records: company and admin user
    const setupDb = await createAdapter({ type: 'sqlite', sqlitePath: TEST_DB_PATH });
    const now = new Date().toISOString();

    await setupDb.query(
      'INSERT INTO companies (id, name, display_name, subdomain, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [1, 'TestCo', 'TestCo Corp', 'testco', now, now]
    );

    await setupDb.query(
      'INSERT INTO users (company_id, id, email, name, password_hash, home_folder, role, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [1, 1, 'admin@testco.com', 'Admin', 'hash', '', 'admin', now, now]
    );

    // Insert dirty tutorial state:
    // 1. Modified seed file (ID 11 overwritten with different path/name)
    await setupDb.query(
      'INSERT INTO files (company_id, id, name, path, type, content, file_references, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [
        1, 11, 'my-modified-dashboard', '/tutorial/my-modified-dashboard',
        'dashboard', JSON.stringify({ name: 'my-modified-dashboard', layout: [] }),
        JSON.stringify([]), now, now
      ]
    );

    // 2. User-created tutorial question (high ID)
    await setupDb.query(
      'INSERT INTO files (company_id, id, name, path, type, content, file_references, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [
        1, 500, 'user-question', '/tutorial/user-question',
        'question', JSON.stringify({ name: 'user-question', query: 'SELECT 1', vizSettings: { type: 'table' }, database_name: 'mxfood' }),
        JSON.stringify([]), now, now
      ]
    );

    // Insert org files that must survive the reset
    await setupDb.query(
      'INSERT INTO files (company_id, id, name, path, type, content, file_references, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [
        1, 100, 'org', '/org',
        'folder', JSON.stringify({ name: 'org', description: 'Org folder' }),
        JSON.stringify([]), now, now
      ]
    );

    await setupDb.query(
      'INSERT INTO files (company_id, id, name, path, type, content, file_references, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [
        1, 101, 'database', '/org/database',
        'folder', JSON.stringify({ name: 'database', description: 'DB folder' }),
        JSON.stringify([]), now, now
      ]
    );

    await setupDb.close();
    await resetAdapter();

    // Default: mock user as admin of company 1
    mockGetEffectiveUser.mockResolvedValue({
      userId: 1,
      email: 'admin@testco.com',
      name: 'Admin',
      role: 'admin',
      home_folder: '',
      companyId: 1,
      companyName: 'TestCo Corp'
    });
  });

  afterEach(async () => {
    const { resetAdapter } = await import('@/lib/database/adapter/factory');
    await resetAdapter();

    [TEST_DB_PATH, TEST_DB_PATH + '-wal', TEST_DB_PATH + '-shm', TEST_DB_PATH + '.backup'].forEach(filePath => {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    });

    jest.clearAllMocks();
  });

  it('should reset tutorial to exact template state', async () => {
    const request = createMockRequest();
    const response = await resetTutorialHandler(request, {} as any);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.documentsCreated).toBe(27);

    // Verify DB state via direct query
    const { createAdapter } = await import('@/lib/database/adapter/factory');
    const db = await createAdapter({ type: 'sqlite', sqlitePath: TEST_DB_PATH });

    // Exactly 27 tutorial docs
    const tutorialResult = await db.query<{ count: number }>(
      "SELECT COUNT(*) as count FROM files WHERE company_id = 1 AND (path = '/tutorial' OR path LIKE '/tutorial/%')",
      []
    );
    expect(tutorialResult.rows[0].count).toBe(27);

    // User-created file should be gone
    const userFileResult = await db.query<{ count: number }>(
      "SELECT COUNT(*) as count FROM files WHERE company_id = 1 AND id = 500",
      []
    );
    expect(userFileResult.rows[0].count).toBe(0);

    // Template root doc exists: id=1, path='/tutorial', name='tutorial'
    const rootResult = await db.query<{ id: number; path: string; name: string }>(
      "SELECT id, path, name FROM files WHERE company_id = 1 AND id = 1",
      []
    );
    expect(rootResult.rows).toHaveLength(1);
    expect(rootResult.rows[0].path).toBe('/tutorial');
    expect(rootResult.rows[0].name).toBe('tutorial');

    // Template connection doc exists: id=9, path='/tutorial/database/mxfood'
    const connResult = await db.query<{ id: number; path: string }>(
      "SELECT id, path FROM files WHERE company_id = 1 AND id = 9",
      []
    );
    expect(connResult.rows).toHaveLength(1);
    expect(connResult.rows[0].path).toBe('/tutorial/database/mxfood');

    // ID 11 should now be the template's top-level-metrics dashboard (not the dirty modified one)
    const id11Result = await db.query<{ path: string }>(
      "SELECT path FROM files WHERE company_id = 1 AND id = 11",
      []
    );
    expect(id11Result.rows).toHaveLength(1);
    expect(id11Result.rows[0].path).toBe('/tutorial/top-level-metrics');

    // Org files (IDs 100, 101) must still exist and be unchanged
    const orgResult = await db.query<{ id: number; path: string }>(
      "SELECT id, path FROM files WHERE company_id = 1 AND id IN (100, 101) ORDER BY id",
      []
    );
    expect(orgResult.rows).toHaveLength(2);
    expect(orgResult.rows[0]).toMatchObject({ id: 100, path: '/org' });
    expect(orgResult.rows[1]).toMatchObject({ id: 101, path: '/org/database' });

    await db.close();
  });

  it('should deny access to non-admin', async () => {
    mockGetEffectiveUser.mockResolvedValue({
      userId: 2,
      email: 'viewer@testco.com',
      name: 'Viewer',
      role: 'viewer',
      home_folder: '',
      companyId: 1,
      companyName: 'TestCo Corp'
    });

    const request = createMockRequest();
    const response = await resetTutorialHandler(request, {} as any);

    expect(response.status).toBe(403);
  });

  it('should delete id < 100 orphan even when path is not under /tutorial', async () => {
    // Simulate an orphan: a seed-range ID whose path was changed away from /tutorial
    // (e.g. a user renamed/moved it). The path-based DELETE won't catch it,
    // but the id < 100 DELETE must.
    const { createAdapter, resetAdapter } = await import('@/lib/database/adapter/factory');
    const now = new Date().toISOString();
    const orphanDb = await createAdapter({ type: 'sqlite', sqlitePath: TEST_DB_PATH });
    await orphanDb.query(
      'INSERT INTO files (company_id, id, name, path, type, content, file_references, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [
        1, 50, 'orphan', '/org/orphan',
        'folder', JSON.stringify({ name: 'orphan' }),
        JSON.stringify([]), now, now
      ]
    );
    await orphanDb.close();
    await resetAdapter();

    const request = createMockRequest();
    const response = await resetTutorialHandler(request, {} as any);
    expect(response.status).toBe(200);

    const db = await createAdapter({ type: 'sqlite', sqlitePath: TEST_DB_PATH });

    // Orphan with id=50 at non-tutorial path must be gone
    const orphanResult = await db.query<{ count: number }>(
      'SELECT COUNT(*) as count FROM files WHERE company_id = 1 AND id = 50',
      []
    );
    expect(orphanResult.rows[0].count).toBe(0);

    // Org files at id >= 100 must still exist
    const orgResult = await db.query<{ count: number }>(
      'SELECT COUNT(*) as count FROM files WHERE company_id = 1 AND id IN (100, 101)',
      []
    );
    expect(orgResult.rows[0].count).toBe(2);

    await db.close();
  });

  it('should not affect another company\'s tutorial files', async () => {
    // Set up company 2 with its own tutorial files
    const { createAdapter, resetAdapter } = await import('@/lib/database/adapter/factory');
    const now = new Date().toISOString();
    const setupDb = await createAdapter({ type: 'sqlite', sqlitePath: TEST_DB_PATH });

    await setupDb.query(
      'INSERT INTO companies (id, name, display_name, subdomain, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [2, 'OtherCo', 'OtherCo Corp', 'otherco', now, now]
    );

    // Company 2 has its own tutorial root and a question (composite key allows same id)
    await setupDb.query(
      'INSERT INTO files (company_id, id, name, path, type, content, file_references, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [
        2, 1, 'tutorial', '/tutorial',
        'folder', JSON.stringify({ name: 'tutorial' }),
        JSON.stringify([]), now, now
      ]
    );
    await setupDb.query(
      'INSERT INTO files (company_id, id, name, path, type, content, file_references, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [
        2, 500, 'other-question', '/tutorial/other-question',
        'question', JSON.stringify({ name: 'other-question', query: 'SELECT 2', vizSettings: { type: 'table' }, database_name: 'db' }),
        JSON.stringify([]), now, now
      ]
    );
    await setupDb.close();
    await resetAdapter();

    // Reset tutorial as admin of company 1
    const request = createMockRequest();
    const response = await resetTutorialHandler(request, {} as any);
    expect(response.status).toBe(200);

    const db = await createAdapter({ type: 'sqlite', sqlitePath: TEST_DB_PATH });

    // Company 1 should have exactly 27 tutorial docs
    const c1Result = await db.query<{ count: number }>(
      "SELECT COUNT(*) as count FROM files WHERE company_id = 1 AND (path = '/tutorial' OR path LIKE '/tutorial/%')",
      []
    );
    expect(c1Result.rows[0].count).toBe(27);

    // Company 2's tutorial files must be untouched
    const c2Result = await db.query<{ count: number }>(
      "SELECT COUNT(*) as count FROM files WHERE company_id = 2",
      []
    );
    expect(c2Result.rows[0].count).toBe(2);

    await db.close();
  });

  it('should be idempotent — second call also returns 27 docs', async () => {
    // First call
    const request1 = createMockRequest();
    const response1 = await resetTutorialHandler(request1, {} as any);
    expect(response1.status).toBe(200);
    const body1 = await response1.json();
    expect(body1.documentsCreated).toBe(27);

    // Second call — should succeed without duplicate insert errors
    const request2 = createMockRequest();
    const response2 = await resetTutorialHandler(request2, {} as any);
    expect(response2.status).toBe(200);
    const body2 = await response2.json();
    expect(body2.success).toBe(true);
    expect(body2.documentsCreated).toBe(27);

    // Verify still exactly 27 tutorial docs
    const { createAdapter } = await import('@/lib/database/adapter/factory');
    const db = await createAdapter({ type: 'sqlite', sqlitePath: TEST_DB_PATH });
    const result = await db.query<{ count: number }>(
      "SELECT COUNT(*) as count FROM files WHERE company_id = 1 AND (path = '/tutorial' OR path LIKE '/tutorial/%')",
      []
    );
    expect(result.rows[0].count).toBe(27);
    await db.close();
  });
});
