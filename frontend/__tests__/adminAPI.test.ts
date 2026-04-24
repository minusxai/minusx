/**
 * Admin API E2E Tests
 *
 * Combined test file covering two admin endpoint suites:
 *   1. Import/Export API — GET /api/admin/export-db, GET /api/admin/db-version,
 *      POST /api/admin/import-data
 *   2. Tutorial Reset API — POST /api/admin/reset-tutorial
 *
 * Both suites share a single test database path to reduce file system overhead.
 * Each suite has its own beforeEach/afterEach that creates a fresh DB state.
 *
 * Run: npm test -- __tests__/adminAPI.test.ts
 */

import { NextRequest } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { gunzip } from 'zlib';
import { promisify } from 'util';

const gunzipAsync = promisify(gunzip);

// Unified test DB path for all suites in this file
const TEST_DB_PATH = path.join(process.cwd(), 'data', 'test_admin_api.db');

// Mock database config
jest.mock('@/lib/database/db-config', () => ({
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const
}));

// Import after mocking
import { InitData, exportDatabase, atomicImport } from '@/lib/database/import-export';
import { getModules } from '@/lib/modules/registry';
import { truncateAllTables } from '@/store/__tests__/test-utils';
import { LATEST_DATA_VERSION } from '@/lib/database/constants';

// Import API route handlers AFTER mocking
import { GET as exportHandler } from '@/app/api/admin/export-db/route';
import { GET as versionHandler } from '@/app/api/admin/db-version/route';
import { POST as importHandler } from '@/app/api/admin/import-data/route';
import { POST as resetTutorialHandler } from '@/app/api/admin/reset-tutorial/route';

// Shared auth mock for all suites
const mockGetEffectiveUser = jest.fn();
jest.mock('@/lib/auth/auth-helpers', () => ({
  getEffectiveUser: () => mockGetEffectiveUser()
}));

// ============================================================================
// Shared helpers
// ============================================================================

function cleanupDbFiles() {
  [TEST_DB_PATH, TEST_DB_PATH + '-wal', TEST_DB_PATH + '-shm', TEST_DB_PATH + '.backup'].forEach(filePath => {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  });
}

// ============================================================================
// Suite 1 helpers: Import/Export
// ============================================================================

function createExportRequest(url: string = 'http://localhost:3000/api/admin/export-db'): NextRequest {
  return new NextRequest(url);
}

async function createMockFormDataWithFile(data: InitData, filename: string): Promise<FormData> {
  const jsonString = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const file = new File([blob], filename, { type: 'application/json' });
  const formData = new FormData();
  formData.append('file', file);
  return formData;
}

// ============================================================================
// Suite 2 helpers: Reset Tutorial
// ============================================================================

function createResetRequest(url = 'http://localhost:3000/api/admin/reset-tutorial'): NextRequest {
  return new NextRequest(url, { method: 'POST' });
}

// ============================================================================
// Suite 1: Import/Export API Endpoints
// ============================================================================

describe('Import/Export API Endpoints', () => {
  beforeEach(async () => {
    cleanupDbFiles();

    // Seed test data — atomicImport lazily creates the adapter (with schema) on first exec().
    const initialData: InitData = {
      version: LATEST_DATA_VERSION,
      users: [
        { id: 1, email: 'user1@alpha.com', name: 'User 1', password_hash: 'hash', phone: null, state: null, home_folder: '/org', role: 'admin', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        { id: 2, email: 'user2@alpha.com', name: 'User 2', password_hash: 'hash', phone: null, state: null, home_folder: '/org', role: 'viewer', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      ],
      documents: [
        { id: 1, name: 'Connection', path: '/org/connection', type: 'connection', content: { type: 'duckdb', config: { file_path: 'test.duckdb' } }, references: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString(), version: 1, last_edit_id: null },
        { id: 2, name: 'Document 2', path: '/org/doc2', type: 'question', content: { query: 'SELECT 1', vizSettings: { type: 'table' as const }, connection_name: 'default_db' }, references: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString(), version: 1, last_edit_id: null },
        { id: 3, name: 'Document 3', path: '/org/doc3', type: 'question', content: { query: 'SELECT 2', vizSettings: { type: 'table' as const }, connection_name: 'default_db' }, references: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString(), version: 1, last_edit_id: null },
      ],
    };
    await atomicImport(initialData, TEST_DB_PATH);

    mockGetEffectiveUser.mockResolvedValue({
      userId: 1,
      email: 'admin@alpha.com',
      name: 'Alpha Admin',
      role: 'admin',
      home_folder: '/org',
      companyName: 'Alpha Corp'
    });
  });

  afterEach(async () => {
    cleanupDbFiles();
    jest.clearAllMocks();
  });

  describe('GET /api/admin/export-db', () => {
    it('should export all users and documents', async () => {
      const request = createExportRequest();
      const response = await exportHandler(request, {} as any);

      expect(response.status).toBe(200);

      const buffer = await response.arrayBuffer();
      const decompressed = await gunzipAsync(Buffer.from(buffer));
      const exportedData: InitData = JSON.parse(decompressed.toString('utf-8'));

      expect(exportedData.users).toHaveLength(2);
      expect(exportedData.documents).toHaveLength(3);
    });

    it('should set correct response headers', async () => {
      const request = createExportRequest();
      const response = await exportHandler(request, {} as any);

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('application/gzip');
      expect(response.headers.get('Content-Disposition')).toMatch(/attachment; filename="atlas_export_\d{4}-\d{2}-\d{2}\.json\.gz"/);
      expect(response.headers.get('X-Validation-Status')).toBe('valid');

      const stats = JSON.parse(response.headers.get('X-Export-Stats') || '{}');
      expect(stats.users).toBe(2);
      expect(stats.documents).toBe(3);
    });
  });

  describe('GET /api/admin/db-version', () => {
    it('should return current database version', async () => {
      const request = createExportRequest('http://localhost:3000/api/admin/db-version');
      const response = await versionHandler(request, {} as any);

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.version).toBe(LATEST_DATA_VERSION);
    });

    it('should require admin role', async () => {
      mockGetEffectiveUser.mockResolvedValue({
        userId: 2,
        email: 'viewer@alpha.com',
        name: 'Viewer',
        role: 'viewer',
        home_folder: '/org',
        companyName: 'Alpha Corp'
      });

      const request = createExportRequest('http://localhost:3000/api/admin/db-version');
      const response = await versionHandler(request, {} as any);

      expect(response.status).toBe(403);
    });
  });

  describe('POST /api/admin/import-data', () => {
    it('should import and replace all data', async () => {
      const importData: InitData = {
        version: LATEST_DATA_VERSION,
        users: [
          { id: 1, email: 'newadmin@example.com', name: 'New Admin', password_hash: 'hash', phone: null, state: null, home_folder: '/org', role: 'admin', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
          { id: 2, email: 'newuser@example.com', name: 'New User', password_hash: 'hash', phone: null, state: null, home_folder: '/org', role: 'viewer', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
          { id: 3, email: 'newuser2@example.com', name: 'New User 2', password_hash: 'hash', phone: null, state: null, home_folder: '/org', role: 'viewer', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        ],
        documents: [
          { id: 1, name: 'Doc 1', path: '/org/doc1', type: 'question', content: { query: 'SELECT 1', vizSettings: { type: 'table' as const }, connection_name: '' }, references: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString(), version: 1, last_edit_id: null },
          { id: 2, name: 'Doc 2', path: '/org/doc2', type: 'question', content: { query: 'SELECT 2', vizSettings: { type: 'table' as const }, connection_name: '' }, references: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString(), version: 1, last_edit_id: null },
          { id: 3, name: 'Doc 3', path: '/org/doc3', type: 'question', content: { query: 'SELECT 3', vizSettings: { type: 'table' as const }, connection_name: '' }, references: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString(), version: 1, last_edit_id: null },
          { id: 4, name: 'Doc 4', path: '/org/doc4', type: 'question', content: { query: 'SELECT 4', vizSettings: { type: 'table' as const }, connection_name: '' }, references: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString(), version: 1, last_edit_id: null },
        ],
      };

      const formData = await createMockFormDataWithFile(importData, 'data.json');
      const request = createExportRequest('http://localhost:3000/api/admin/import-data');
      jest.spyOn(request, 'formData').mockResolvedValue(formData);

      const response = await importHandler(request, {} as any);

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);

      const exportedData = await exportDatabase(TEST_DB_PATH);
      expect(exportedData.users).toHaveLength(3);
      expect(exportedData.documents).toHaveLength(4);
    });

    it('should reject import with version mismatch', async () => {
      const importData: InitData = {
        version: 1,
        users: [],
        documents: [],
      };

      const formData = await createMockFormDataWithFile(importData, 'old_version.json');
      const request = createExportRequest('http://localhost:3000/api/admin/import-data');
      jest.spyOn(request, 'formData').mockResolvedValue(formData);

      const response = await importHandler(request, {} as any);

      expect(response.status).toBe(400);
      const result = await response.json();
      expect(result.success).toBe(false);
      expect(result.errors[0]).toContain('Version mismatch');
      expect(result.errors[1]).toContain('Please use CLI tools for migrations');
    });

    it('should handle gzipped files', async () => {
      const importData: InitData = {
        version: LATEST_DATA_VERSION,
        users: [
          { id: 1, email: 'admin@gzipped.com', name: 'Admin', password_hash: 'hash', phone: null, state: null, home_folder: '/org', role: 'admin', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        ],
        documents: [],
      };

      const jsonString = JSON.stringify(importData, null, 2);
      const { gzip } = require('zlib');
      const { promisify } = require('util');
      const gzipAsync = promisify(gzip);
      const compressed = await gzipAsync(Buffer.from(jsonString, 'utf-8'));

      const blob = new Blob([compressed], { type: 'application/gzip' });
      const file = new File([blob], 'data.json.gz', { type: 'application/gzip' });

      const formData = new FormData();
      formData.append('file', file);

      const request = createExportRequest('http://localhost:3000/api/admin/import-data');
      jest.spyOn(request, 'formData').mockResolvedValue(formData);

      const response = await importHandler(request, {} as any);

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
    });

    it('should require admin role', async () => {
      mockGetEffectiveUser.mockResolvedValue({
        userId: 2,
        email: 'viewer@alpha.com',
        name: 'Viewer',
        role: 'viewer',
        home_folder: '/org',
        companyName: 'Alpha Corp'
      });

      const importData: InitData = {
        version: 2,
        users: [],
        documents: [],
      };

      const formData = await createMockFormDataWithFile(importData, 'test.json');
      const request = createExportRequest('http://localhost:3000/api/admin/import-data');
      jest.spyOn(request, 'formData').mockResolvedValue(formData);

      const response = await importHandler(request, {} as any);

      expect(response.status).toBe(403);
    });
  });
});

// ============================================================================
// Suite 2: Tutorial Reset API
// ============================================================================

describe('POST /api/admin/reset-tutorial', () => {
  beforeEach(async () => {
    cleanupDbFiles();
    await truncateAllTables();

    const db = getModules().db;
    const now = new Date().toISOString();

    // Dirty tutorial state: modified seed file
    await db.exec(
      'INSERT INTO files (id, name, path, type, content, file_references, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [
        11, 'my-modified-dashboard', '/tutorial/my-modified-dashboard',
        'dashboard', JSON.stringify({ name: 'my-modified-dashboard', layout: [] }),
        JSON.stringify([]), now, now
      ]
    );

    // User-created tutorial question
    await db.exec(
      'INSERT INTO files (id, name, path, type, content, file_references, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [
        500, 'user-question', '/tutorial/user-question',
        'question', JSON.stringify({ name: 'user-question', query: 'SELECT 1', vizSettings: { type: 'table' }, connection_name: 'mxfood' }),
        JSON.stringify([]), now, now
      ]
    );

    // User-created org files that must survive the reset (paths don't conflict with template)
    await db.exec(
      'INSERT INTO files (id, name, path, type, content, file_references, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [
        100, 'custom-folder', '/org/custom-folder',
        'folder', JSON.stringify({ name: 'custom-folder' }),
        JSON.stringify([]), now, now
      ]
    );

    await db.exec(
      'INSERT INTO files (id, name, path, type, content, file_references, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [
        101, 'custom-report', '/org/custom-folder/report',
        'question', JSON.stringify({ name: 'custom-report', query: 'SELECT 1', vizSettings: { type: 'table' }, connection_name: 'static' }),
        JSON.stringify([]), now, now
      ]
    );

    mockGetEffectiveUser.mockResolvedValue({
      userId: 1,
      email: 'admin@testco.com',
      name: 'Admin',
      role: 'admin',
      home_folder: '',
      companyName: 'TestCo Corp'
    });
  });

  afterEach(async () => {
    cleanupDbFiles();
    jest.clearAllMocks();
  });

  it('should reset tutorial to exact template state', async () => {
    const request = createResetRequest();
    const response = await resetTutorialHandler(request, {} as any);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.documentsCreated).toBe(68);

    const db = getModules().db;

    const tutorialResult = await db.exec<{ count: number }>(
      "SELECT COUNT(*) as count FROM files WHERE (path = '/tutorial' OR path LIKE '/tutorial/%')",
      []
    );
    // 30 template docs + 1 user-created question at /tutorial (id=500, preserved)
    expect(tutorialResult.rows[0].count).toBe(31);

    const userFileResult = await db.exec<{ count: number }>(
      "SELECT COUNT(*) as count FROM files WHERE id = 500",
      []
    );
    expect(userFileResult.rows[0].count).toBe(1); // user-created file is preserved

    const rootResult = await db.exec<{ id: number; path: string; name: string }>(
      "SELECT id, path, name FROM files WHERE id = 1",
      []
    );
    expect(rootResult.rows).toHaveLength(1);
    expect(rootResult.rows[0].path).toBe('/tutorial');
    expect(rootResult.rows[0].name).toBe('tutorial');

    const connResult = await db.exec<{ id: number; path: string }>(
      "SELECT id, path FROM files WHERE id = 6",
      []
    );
    expect(connResult.rows).toHaveLength(1);
    expect(connResult.rows[0].path).toBe('/tutorial/database/static');

    const id11Result = await db.exec<{ path: string }>(
      "SELECT path FROM files WHERE id = 11",
      []
    );
    expect(id11Result.rows).toHaveLength(1);
    expect(id11Result.rows[0].path).toBe('/tutorial/top-level-metrics');

    // ids 100/101 are user-like files (no longer template IDs) — preserved by reset
    const orgResult = await db.exec<{ id: number; path: string }>(
      "SELECT id, path FROM files WHERE id IN (100, 101) ORDER BY id",
      []
    );
    expect(orgResult.rows).toHaveLength(2);
    expect(orgResult.rows[0]).toMatchObject({ id: 100, path: '/org/custom-folder' });
    expect(orgResult.rows[1]).toMatchObject({ id: 101, path: '/org/custom-folder/report' });
    // The actual /org and /org/database template docs now live at ids 1003 and 1006
    const orgFolderResult = await db.exec<{ id: number; path: string }>(
      "SELECT id, path FROM files WHERE id IN (1003, 1006) ORDER BY id",
      []
    );
    expect(orgFolderResult.rows).toHaveLength(2);
    expect(orgFolderResult.rows[0]).toMatchObject({ id: 1003, path: '/org' });
    expect(orgFolderResult.rows[1]).toMatchObject({ id: 1006, path: '/org/database' });
  });

  it('should deny access to non-admin', async () => {
    mockGetEffectiveUser.mockResolvedValue({
      userId: 2,
      email: 'viewer@testco.com',
      name: 'Viewer',
      role: 'viewer',
      home_folder: '',
      companyName: 'TestCo Corp'
    });

    const request = createResetRequest();
    const response = await resetTutorialHandler(request, {} as any);

    expect(response.status).toBe(403);
  });

  it('should not delete non-template docs that happen to have id < 1000', async () => {
    // id=56 is not a template ID — reset-tutorial deletes by explicit template ID list,
    // so this doc must be left untouched (user-created files are never deleted).
    const now = new Date().toISOString();
    const db = getModules().db;
    await db.exec(
      'INSERT INTO files (id, name, path, type, content, file_references, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [
        56, 'orphan', '/org/orphan',
        'folder', JSON.stringify({ name: 'orphan' }),
        JSON.stringify([]), now, now
      ]
    );

    const request = createResetRequest();
    const response = await resetTutorialHandler(request, {} as any);
    expect(response.status).toBe(200);

    const orphanResult = await db.exec<{ count: number }>(
      'SELECT COUNT(*) as count FROM files WHERE id = 56',
      []
    );
    expect(orphanResult.rows[0].count).toBe(1); // preserved — not a template ID

    // ids 100/101 (user-like files from beforeEach) are also preserved
    const orgResult = await db.exec<{ count: number }>(
      'SELECT COUNT(*) as count FROM files WHERE id IN (100, 101)',
      []
    );
    expect(orgResult.rows[0].count).toBe(2);
  });

  it('should be idempotent — second call also returns 30 docs', async () => {
    const request1 = createResetRequest();
    const response1 = await resetTutorialHandler(request1, {} as any);
    expect(response1.status).toBe(200);
    const body1 = await response1.json();
    expect(body1.documentsCreated).toBe(68);

    const request2 = createResetRequest();
    const response2 = await resetTutorialHandler(request2, {} as any);
    expect(response2.status).toBe(200);
    const body2 = await response2.json();
    expect(body2.success).toBe(true);
    expect(body2.documentsCreated).toBe(68);

    const result = await getModules().db.exec<{ count: number }>(
      "SELECT COUNT(*) as count FROM files WHERE (path = '/tutorial' OR path LIKE '/tutorial/%')",
      []
    );
    expect(result.rows[0].count).toBe(31); // 30 template + 1 preserved user file (id=500)
  });
});
