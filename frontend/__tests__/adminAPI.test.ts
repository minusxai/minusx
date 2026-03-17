/**
 * Admin API E2E Tests
 *
 * Combined test file covering two admin endpoint suites:
 *   1. Company Import/Export API — GET /api/admin/export-db, GET /api/admin/db-version,
 *      POST /api/admin/import-company
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
  DB_PATH: path.join(process.cwd(), 'data', 'test_admin_api.db'),
  DB_DIR: path.join(process.cwd(), 'data'),
  getDbType: () => 'sqlite' as const
}));

// Import after mocking
import { CompanyData, InitData, exportDatabase, atomicImport } from '@/lib/database/import-export';
import { createEmptyDatabase } from '@/scripts/create-empty-db';
import { setDataVersion } from '@/lib/database/config-db';

// Import API route handlers AFTER mocking
import { GET as exportHandler } from '@/app/api/admin/export-db/route';
import { GET as versionHandler } from '@/app/api/admin/db-version/route';
import { POST as importHandler } from '@/app/api/admin/import-company/route';
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
// Suite 1 helpers: Company Import/Export
// ============================================================================

function createTestCompany(id: number, name: string, userCount: number, docCount: number): CompanyData {
  const documents = [];

  documents.push({
    id: 1,
    name: `${name} Connection`,
    path: `/org/connection`,
    type: 'connection' as const,
    references: [],
    content: {
      name: `${name} Connection`,
      type: 'duckdb' as const,
      config: { file_path: 'test.duckdb' }
    },
    company_id: id,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    version: 1,
    last_edit_id: null,
  });

  for (let i = 1; i < docCount; i++) {
    documents.push({
      id: i + 1,
      name: `Document ${i + 1}`,
      path: `/org/doc${i + 1}`,
      type: 'question' as const,
      references: [],
      content: {
        name: `Document ${i + 1}`,
        query: 'SELECT 1',
        vizSettings: { type: 'table' as const },
        database_name: 'default_db'
      },
      company_id: id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
      last_edit_id: null,
    });
  }

  return {
    id,
    name,
    display_name: `${name} Corp`,
    subdomain: name.toLowerCase(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    users: Array.from({ length: userCount }, (_, i) => ({
      id: i + 1,
      email: `user${i + 1}@${name}.com`,
      name: `User ${i + 1}`,
      password_hash: 'hash',
      phone: null,
      state: null,
      home_folder: '/org',
      role: i === 0 ? 'admin' : 'viewer',
      company_id: id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })),
    documents
  };
}

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
// Suite 1: Company Import/Export API Endpoints
// ============================================================================

describe('Company Import/Export API Endpoints', () => {
  beforeEach(async () => {
    const { resetAdapter, createAdapter } = await import('@/lib/database/adapter/factory');
    await resetAdapter();

    cleanupDbFiles();

    await createEmptyDatabase(TEST_DB_PATH);
    await resetAdapter();

    const { getDataVersion } = await import('@/lib/database/config-db');
    const db = await createAdapter({ type: 'sqlite', sqlitePath: TEST_DB_PATH });
    await setDataVersion(2, db);
    await db.close();
    await resetAdapter();

    const verifyDb = await createAdapter({ type: 'sqlite', sqlitePath: TEST_DB_PATH });
    const actualVersion = await getDataVersion(verifyDb);
    await verifyDb.close();
    await resetAdapter();

    if (actualVersion !== 2) {
      throw new Error(`Failed to set version! Expected 2, got ${actualVersion}`);
    }

    const initialData: InitData = {
      version: 2,
      companies: [
        createTestCompany(1, 'Alpha', 2, 3),
        createTestCompany(2, 'Beta', 1, 2),
        createTestCompany(3, 'Gamma', 3, 5)
      ]
    };
    await atomicImport(initialData, TEST_DB_PATH);
    await resetAdapter();

    mockGetEffectiveUser.mockResolvedValue({
      userId: 1,
      email: 'admin@alpha.com',
      name: 'Alpha Admin',
      role: 'admin',
      home_folder: '/org',
      companyId: 1,
      companyName: 'Alpha Corp'
    });
  });

  afterEach(async () => {
    const { resetAdapter } = await import('@/lib/database/adapter/factory');
    await resetAdapter();
    cleanupDbFiles();
    jest.clearAllMocks();
  });

  describe('GET /api/admin/export-db', () => {
    it('should export only current user\'s company', async () => {
      const request = createExportRequest();
      const response = await exportHandler(request, {} as any);

      expect(response.status).toBe(200);

      const buffer = await response.arrayBuffer();
      const decompressed = await gunzipAsync(Buffer.from(buffer));
      const exportedData: InitData = JSON.parse(decompressed.toString('utf-8'));

      expect(exportedData.companies).toHaveLength(1);
      const company = exportedData.companies[0] as CompanyData;
      expect(company.id).toBe(1);
      expect(company.name).toBe('Alpha');
      expect(company.display_name).toBe('Alpha Corp');
      expect(company.users).toHaveLength(2);
      expect(company.documents).toHaveLength(3);
    });

    it('should return error if user has no companyId', async () => {
      mockGetEffectiveUser.mockResolvedValue({
        userId: 1,
        email: 'admin@test.com',
        name: 'Admin',
        role: 'admin',
        home_folder: '/org',
        companyId: null,
        companyName: null
      });

      const request = createExportRequest();
      const response = await exportHandler(request, {} as any);

      expect([400, 403]).toContain(response.status);
      const result = await response.json();
      expect(result.error || result.message).toBeDefined();
    });

    it('should return 404 if company does not exist', async () => {
      mockGetEffectiveUser.mockResolvedValue({
        userId: 1,
        email: 'admin@test.com',
        name: 'Admin',
        role: 'admin',
        home_folder: '/org',
        companyId: 999,
        companyName: 'Test Company'
      });

      const request = createExportRequest();
      const response = await exportHandler(request, {} as any);

      expect(response.status).toBe(404);
      const result = await response.json();
      expect(result.success).toBe(false);
      expect(result.errors).toContain('Company with ID 999 not found');
    });

    it('should set correct response headers', async () => {
      const request = createExportRequest();
      const response = await exportHandler(request, {} as any);

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('application/gzip');
      expect(response.headers.get('Content-Disposition')).toMatch(/attachment; filename="atlas_export_company_1_\d{4}-\d{2}-\d{2}\.json\.gz"/);
      expect(response.headers.get('X-Validation-Status')).toBe('valid');

      const stats = JSON.parse(response.headers.get('X-Export-Stats') || '{}');
      expect(stats.companies).toBe(1);
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
      expect(result.version).toBe(2);
    });

    it('should require admin role', async () => {
      mockGetEffectiveUser.mockResolvedValue({
        userId: 2,
        email: 'viewer@alpha.com',
        name: 'Viewer',
        role: 'viewer',
        home_folder: '/org',
        companyId: 1,
        companyName: 'Alpha Corp'
      });

      const request = createExportRequest('http://localhost:3000/api/admin/db-version');
      const response = await versionHandler(request, {} as any);

      expect(response.status).toBe(403);
    });
  });

  describe('POST /api/admin/import-company', () => {
    it('should import and overwrite current user\'s company', async () => {
      const importData: InitData = {
        version: 2,
        companies: [createTestCompany(1, 'Alpha_Modified', 3, 4)]
      };

      const formData = await createMockFormDataWithFile(importData, 'alpha_modified.json');
      const request = createExportRequest('http://localhost:3000/api/admin/import-company');
      jest.spyOn(request, 'formData').mockResolvedValue(formData);

      const response = await importHandler(request, {} as any);

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.company.id).toBe(1);
      expect(result.company.name).toBe('Alpha_Modified');

      const exportedData = await exportDatabase(TEST_DB_PATH);
      expect(exportedData.companies).toHaveLength(3);

      const company1 = (exportedData.companies as CompanyData[]).find(c => c.id === 1)!;
      expect(company1.display_name).toBe('Alpha_Modified Corp');
      expect(company1.users).toHaveLength(3);
      expect(company1.documents).toHaveLength(4);

      const company2 = (exportedData.companies as CompanyData[]).find(c => c.id === 2)!;
      expect(company2.display_name).toBe('Beta Corp');
      expect(company2.users).toHaveLength(1);

      const company3 = (exportedData.companies as CompanyData[]).find(c => c.id === 3)!;
      expect(company3.display_name).toBe('Gamma Corp');
      expect(company3.users).toHaveLength(3);
    });

    it('should reject import with multiple companies', async () => {
      const importData: InitData = {
        version: 2,
        companies: [
          createTestCompany(1, 'Alpha', 2, 3),
          createTestCompany(2, 'Beta', 1, 2)
        ]
      };

      const formData = await createMockFormDataWithFile(importData, 'multi.json');
      const request = createExportRequest('http://localhost:3000/api/admin/import-company');
      jest.spyOn(request, 'formData').mockResolvedValue(formData);

      const response = await importHandler(request, {} as any);

      expect(response.status).toBe(400);
      const result = await response.json();
      expect(result.success).toBe(false);
      expect(result.errors).toContain('File must contain exactly 1 company');
    });

    it('should reject import with version mismatch', async () => {
      const importData: InitData = {
        version: 1,
        companies: [createTestCompany(1, 'Alpha', 2, 3)]
      };

      const formData = await createMockFormDataWithFile(importData, 'old_version.json');
      const request = createExportRequest('http://localhost:3000/api/admin/import-company');
      jest.spyOn(request, 'formData').mockResolvedValue(formData);

      const response = await importHandler(request, {} as any);

      expect(response.status).toBe(400);
      const result = await response.json();
      expect(result.success).toBe(false);
      expect(result.errors[0]).toContain('Version mismatch');
      expect(result.errors[1]).toContain('Please use CLI tools for migrations');
    });

    it('should reject import with mismatched company ID', async () => {
      const importData: InitData = {
        version: 2,
        companies: [createTestCompany(2, 'Beta', 1, 2)]
      };

      const formData = await createMockFormDataWithFile(importData, 'wrong_company.json');
      const request = createExportRequest('http://localhost:3000/api/admin/import-company');
      jest.spyOn(request, 'formData').mockResolvedValue(formData);

      const response = await importHandler(request, {} as any);

      expect(response.status).toBe(400);
      const result = await response.json();
      expect(result.success).toBe(false);
      expect(result.errors[0]).toContain('Company ID mismatch');
      expect(result.errors[0]).toContain('You are admin of company 1, but file contains company 2');
    });

    it('should handle gzipped files', async () => {
      const importData: InitData = {
        version: 2,
        companies: [createTestCompany(1, 'Alpha_Gzipped', 2, 3)]
      };

      const jsonString = JSON.stringify(importData, null, 2);
      const { gzip } = require('zlib');
      const { promisify } = require('util');
      const gzipAsync = promisify(gzip);
      const compressed = await gzipAsync(Buffer.from(jsonString, 'utf-8'));

      const blob = new Blob([compressed], { type: 'application/gzip' });
      const file = new File([blob], 'alpha.json.gz', { type: 'application/gzip' });

      const formData = new FormData();
      formData.append('file', file);

      const request = createExportRequest('http://localhost:3000/api/admin/import-company');
      jest.spyOn(request, 'formData').mockResolvedValue(formData);

      const response = await importHandler(request, {} as any);

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.company.name).toBe('Alpha_Gzipped');
    });

    it('should require admin role', async () => {
      mockGetEffectiveUser.mockResolvedValue({
        userId: 2,
        email: 'viewer@alpha.com',
        name: 'Viewer',
        role: 'viewer',
        home_folder: '/org',
        companyId: 1,
        companyName: 'Alpha Corp'
      });

      const importData: InitData = {
        version: 2,
        companies: [createTestCompany(1, 'Alpha', 2, 3)]
      };

      const formData = await createMockFormDataWithFile(importData, 'test.json');
      const request = createExportRequest('http://localhost:3000/api/admin/import-company');
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
    const { resetAdapter, createAdapter } = await import('@/lib/database/adapter/factory');

    await resetAdapter();
    cleanupDbFiles();

    await createEmptyDatabase(TEST_DB_PATH);
    await resetAdapter();

    const db = await createAdapter({ type: 'sqlite', sqlitePath: TEST_DB_PATH });
    await setDataVersion(15, db);
    await db.close();
    await resetAdapter();

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

    // Dirty tutorial state: modified seed file
    await setupDb.query(
      'INSERT INTO files (company_id, id, name, path, type, content, file_references, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [
        1, 11, 'my-modified-dashboard', '/tutorial/my-modified-dashboard',
        'dashboard', JSON.stringify({ name: 'my-modified-dashboard', layout: [] }),
        JSON.stringify([]), now, now
      ]
    );

    // User-created tutorial question
    await setupDb.query(
      'INSERT INTO files (company_id, id, name, path, type, content, file_references, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [
        1, 500, 'user-question', '/tutorial/user-question',
        'question', JSON.stringify({ name: 'user-question', query: 'SELECT 1', vizSettings: { type: 'table' }, database_name: 'mxfood' }),
        JSON.stringify([]), now, now
      ]
    );

    // Org files that must survive the reset
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
    cleanupDbFiles();
    jest.clearAllMocks();
  });

  it('should reset tutorial to exact template state', async () => {
    const request = createResetRequest();
    const response = await resetTutorialHandler(request, {} as any);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.documentsCreated).toBe(46);

    const { createAdapter } = await import('@/lib/database/adapter/factory');
    const db = await createAdapter({ type: 'sqlite', sqlitePath: TEST_DB_PATH });

    const tutorialResult = await db.query<{ count: number }>(
      "SELECT COUNT(*) as count FROM files WHERE company_id = 1 AND (path = '/tutorial' OR path LIKE '/tutorial/%')",
      []
    );
    expect(tutorialResult.rows[0].count).toBe(26);

    const userFileResult = await db.query<{ count: number }>(
      "SELECT COUNT(*) as count FROM files WHERE company_id = 1 AND id = 500",
      []
    );
    expect(userFileResult.rows[0].count).toBe(0);

    const rootResult = await db.query<{ id: number; path: string; name: string }>(
      "SELECT id, path, name FROM files WHERE company_id = 1 AND id = 1",
      []
    );
    expect(rootResult.rows).toHaveLength(1);
    expect(rootResult.rows[0].path).toBe('/tutorial');
    expect(rootResult.rows[0].name).toBe('tutorial');

    const connResult = await db.query<{ id: number; path: string }>(
      "SELECT id, path FROM files WHERE company_id = 1 AND id = 9",
      []
    );
    expect(connResult.rows).toHaveLength(1);
    expect(connResult.rows[0].path).toBe('/tutorial/database/mxfood');

    const id11Result = await db.query<{ path: string }>(
      "SELECT path FROM files WHERE company_id = 1 AND id = 11",
      []
    );
    expect(id11Result.rows).toHaveLength(1);
    expect(id11Result.rows[0].path).toBe('/tutorial/top-level-metrics');

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

    const request = createResetRequest();
    const response = await resetTutorialHandler(request, {} as any);

    expect(response.status).toBe(403);
  });

  it('should delete id < 100 orphan even when path is not under /tutorial', async () => {
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

    const request = createResetRequest();
    const response = await resetTutorialHandler(request, {} as any);
    expect(response.status).toBe(200);

    const db = await createAdapter({ type: 'sqlite', sqlitePath: TEST_DB_PATH });

    const orphanResult = await db.query<{ count: number }>(
      'SELECT COUNT(*) as count FROM files WHERE company_id = 1 AND id = 50',
      []
    );
    expect(orphanResult.rows[0].count).toBe(0);

    const orgResult = await db.query<{ count: number }>(
      'SELECT COUNT(*) as count FROM files WHERE company_id = 1 AND id IN (100, 101)',
      []
    );
    expect(orgResult.rows[0].count).toBe(2);

    await db.close();
  });

  it('should not affect another company\'s tutorial files', async () => {
    const { createAdapter, resetAdapter } = await import('@/lib/database/adapter/factory');
    const now = new Date().toISOString();
    const setupDb = await createAdapter({ type: 'sqlite', sqlitePath: TEST_DB_PATH });

    await setupDb.query(
      'INSERT INTO companies (id, name, display_name, subdomain, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [2, 'OtherCo', 'OtherCo Corp', 'otherco', now, now]
    );

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

    const request = createResetRequest();
    const response = await resetTutorialHandler(request, {} as any);
    expect(response.status).toBe(200);

    const db = await createAdapter({ type: 'sqlite', sqlitePath: TEST_DB_PATH });

    const c1Result = await db.query<{ count: number }>(
      "SELECT COUNT(*) as count FROM files WHERE company_id = 1 AND (path = '/tutorial' OR path LIKE '/tutorial/%')",
      []
    );
    expect(c1Result.rows[0].count).toBe(26);

    const c2Result = await db.query<{ count: number }>(
      "SELECT COUNT(*) as count FROM files WHERE company_id = 2",
      []
    );
    expect(c2Result.rows[0].count).toBe(2);

    await db.close();
  });

  it('should be idempotent — second call also returns 26 docs', async () => {
    const request1 = createResetRequest();
    const response1 = await resetTutorialHandler(request1, {} as any);
    expect(response1.status).toBe(200);
    const body1 = await response1.json();
    expect(body1.documentsCreated).toBe(46);

    const request2 = createResetRequest();
    const response2 = await resetTutorialHandler(request2, {} as any);
    expect(response2.status).toBe(200);
    const body2 = await response2.json();
    expect(body2.success).toBe(true);
    expect(body2.documentsCreated).toBe(46);

    const { createAdapter } = await import('@/lib/database/adapter/factory');
    const db = await createAdapter({ type: 'sqlite', sqlitePath: TEST_DB_PATH });
    const result = await db.query<{ count: number }>(
      "SELECT COUNT(*) as count FROM files WHERE company_id = 1 AND (path = '/tutorial' OR path LIKE '/tutorial/%')",
      []
    );
    expect(result.rows[0].count).toBe(26);
    await db.close();
  });
});
