/**
 * E2E Test: Company-Scoped Import/Export API Endpoints
 *
 * Tests the Web UI endpoints for company-scoped data management:
 * - GET /api/admin/export-db - Export current user's company
 * - GET /api/admin/db-version - Get current DB version
 * - POST /api/admin/import-company - Import/overwrite current user's company
 *
 * These endpoints are scoped to the authenticated user's company for safety.
 * CLI tools should use core functions directly for multi-company operations.
 *
 * Run: npm test -- __tests__/companyImportExportAPI.test.ts
 */

import { NextRequest } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { gunzip } from 'zlib';
import { promisify } from 'util';

const gunzipAsync = promisify(gunzip);

// Define test DB path BEFORE mocking
const TEST_DB_PATH = path.join(process.cwd(), 'data', 'test_company_import_export_api.db');

// Mock database config
jest.mock('@/lib/database/db-config', () => ({
  DB_PATH: path.join(process.cwd(), 'data', 'test_company_import_export_api.db'),
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

// Mock auth helpers to return test users
const mockGetEffectiveUser = jest.fn();
jest.mock('@/lib/auth/auth-helpers', () => ({
  getEffectiveUser: () => mockGetEffectiveUser()
}));

// Helper to create test company
function createTestCompany(id: number, name: string, userCount: number, docCount: number): CompanyData {
  const documents = [];

  // Always add a connection (required for validation)
  documents.push({
    id: 1,
    name: `${name} Connection`,
    path: `/org/connection`,
    type: 'connection' as const,
    references: [],  // Phase 6: Connections have no references
    content: {
      name: `${name} Connection`,
      type: 'duckdb' as const,
      config: { file_path: 'test.duckdb' }
    },
    company_id: id,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });

  // Add additional documents
  for (let i = 1; i < docCount; i++) {
    documents.push({
      id: i + 1,
      name: `Document ${i + 1}`,
      path: `/org/doc${i + 1}`,
      type: 'question' as const,
      references: [],  // Phase 6: Questions have no references
      content: {
        name: `Document ${i + 1}`,
        query: 'SELECT 1',
        vizSettings: { type: 'table' as const },
        database_name: 'default_db'
      },
      company_id: id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
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

// Helper to create mock NextRequest
function createMockRequest(url: string = 'http://localhost:3000/api/admin/export-db'): NextRequest {
  return new NextRequest(url);
}

// Helper to create mock FormData with file
async function createMockFormDataWithFile(data: InitData, filename: string): Promise<FormData> {
  const jsonString = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const file = new File([blob], filename, { type: 'application/json' });

  const formData = new FormData();
  formData.append('file', file);

  return formData;
}

describe('Company Import/Export API Endpoints', () => {
  beforeEach(async () => {
    // Reset adapter to ensure fresh connection
    const { resetAdapter } = await import('@/lib/database/adapter/factory');
    await resetAdapter();

    // Clean up test database
    [TEST_DB_PATH, TEST_DB_PATH + '-wal', TEST_DB_PATH + '-shm', TEST_DB_PATH + '.backup'].forEach(filePath => {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    });

    // Create empty database
    await createEmptyDatabase(TEST_DB_PATH);

    // Reset adapter again after database creation to ensure fresh connection
    await resetAdapter();

    // Set data version to 2 (createEmptyDatabase already sets it, but be explicit)
    const { createAdapter, getAdapter } = await import('@/lib/database/adapter/factory');
    const db = await createAdapter({ type: 'sqlite', sqlitePath: TEST_DB_PATH });
    await setDataVersion(2, db);
    await db.close();

    // Reset adapter after setting version to ensure next connection picks up the change
    await resetAdapter();

    // Verify version was set correctly
    const { getDataVersion } = await import('@/lib/database/config-db');
    const verifyDb = await createAdapter({ type: 'sqlite', sqlitePath: TEST_DB_PATH });
    const actualVersion = await getDataVersion(verifyDb);
    await verifyDb.close();
    await resetAdapter();

    if (actualVersion !== 2) {
      throw new Error(`Failed to set version! Expected 2, got ${actualVersion}`);
    }

    // Create initial database with 3 companies
    const initialData: InitData = {
      version: 2,
      companies: [
        createTestCompany(1, 'Alpha', 2, 3),
        createTestCompany(2, 'Beta', 1, 2),
        createTestCompany(3, 'Gamma', 3, 5)
      ]
    };
    await atomicImport(initialData, TEST_DB_PATH);

    // Reset adapter after import to ensure next connection picks up the changes
    await resetAdapter();

    // Default: Mock user as admin of company 1
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
    // Clean up
    const { resetAdapter } = await import('@/lib/database/adapter/factory');
    await resetAdapter();

    [TEST_DB_PATH, TEST_DB_PATH + '-wal', TEST_DB_PATH + '-shm', TEST_DB_PATH + '.backup'].forEach(filePath => {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    });
    jest.clearAllMocks();
  });

  describe('GET /api/admin/export-db', () => {
    it('should export only current user\'s company', async () => {
      const request = createMockRequest();
      const response = await exportHandler(request, {} as any);

      expect(response.status).toBe(200);

      // Decompress and parse response
      const buffer = await response.arrayBuffer();
      const decompressed = await gunzipAsync(Buffer.from(buffer));
      const exportedData: InitData = JSON.parse(decompressed.toString('utf-8'));

      // Should only contain company 1 (user's company)
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
        companyId: null, // No company
        companyName: null
      });

      const request = createMockRequest();
      const response = await exportHandler(request, {} as any);

      // withAuth or the handler returns an error (403 or 400)
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
        companyId: 999, // Non-existent company
        companyName: 'Test Company'
      });

      const request = createMockRequest();
      const response = await exportHandler(request, {} as any);

      expect(response.status).toBe(404);
      const result = await response.json();
      expect(result.success).toBe(false);
      expect(result.errors).toContain('Company with ID 999 not found');
    });

    it('should set correct response headers', async () => {
      const request = createMockRequest();
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
      const request = createMockRequest('http://localhost:3000/api/admin/db-version');
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
        role: 'viewer', // Not admin
        home_folder: '/org',
        companyId: 1,
        companyName: 'Alpha Corp'
      });

      const request = createMockRequest('http://localhost:3000/api/admin/db-version');
      const response = await versionHandler(request, {} as any);

      expect(response.status).toBe(403);
    });
  });

  describe('POST /api/admin/import-company', () => {
    it('should import and overwrite current user\'s company', async () => {
      // Create import data with modified company 1
      const importData: InitData = {
        version: 2,
        companies: [
          createTestCompany(1, 'Alpha_Modified', 3, 4) // Modified
        ]
      };

      const formData = await createMockFormDataWithFile(importData, 'alpha_modified.json');
      const request = createMockRequest('http://localhost:3000/api/admin/import-company');

      // Mock formData method
      jest.spyOn(request, 'formData').mockResolvedValue(formData);

      const response = await importHandler(request, {} as any);

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.company.id).toBe(1);
      expect(result.company.name).toBe('Alpha_Modified');

      // Verify database state: [1 (modified), 2 (kept), 3 (kept)]
      const exportedData = await exportDatabase(TEST_DB_PATH);
      expect(exportedData.companies).toHaveLength(3);

      const company1 = (exportedData.companies as CompanyData[]).find(c => c.id === 1)!;
      expect(company1.display_name).toBe('Alpha_Modified Corp');
      expect(company1.users).toHaveLength(3);
      expect(company1.documents).toHaveLength(4);

      // Companies 2 and 3 should be unchanged
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
          createTestCompany(2, 'Beta', 1, 2) // Multiple companies
        ]
      };

      const formData = await createMockFormDataWithFile(importData, 'multi.json');
      const request = createMockRequest('http://localhost:3000/api/admin/import-company');
      jest.spyOn(request, 'formData').mockResolvedValue(formData);

      const response = await importHandler(request, {} as any);

      expect(response.status).toBe(400);
      const result = await response.json();
      expect(result.success).toBe(false);
      expect(result.errors).toContain('File must contain exactly 1 company');
    });

    it('should reject import with version mismatch', async () => {
      const importData: InitData = {
        version: 1, // Wrong version (DB is v2)
        companies: [
          createTestCompany(1, 'Alpha', 2, 3)
        ]
      };

      const formData = await createMockFormDataWithFile(importData, 'old_version.json');
      const request = createMockRequest('http://localhost:3000/api/admin/import-company');
      jest.spyOn(request, 'formData').mockResolvedValue(formData);

      const response = await importHandler(request, {} as any);

      expect(response.status).toBe(400);
      const result = await response.json();
      expect(result.success).toBe(false);
      expect(result.errors[0]).toContain('Version mismatch');
      expect(result.errors[1]).toContain('Please use CLI tools for migrations');
    });

    it('should reject import with mismatched company ID', async () => {
      // User is admin of company 1, but tries to import company 2
      const importData: InitData = {
        version: 2,
        companies: [
          createTestCompany(2, 'Beta', 1, 2) // Wrong company
        ]
      };

      const formData = await createMockFormDataWithFile(importData, 'wrong_company.json');
      const request = createMockRequest('http://localhost:3000/api/admin/import-company');
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
        companies: [
          createTestCompany(1, 'Alpha_Gzipped', 2, 3)
        ]
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

      const request = createMockRequest('http://localhost:3000/api/admin/import-company');
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
        role: 'viewer', // Not admin
        home_folder: '/org',
        companyId: 1,
        companyName: 'Alpha Corp'
      });

      const importData: InitData = {
        version: 2,
        companies: [createTestCompany(1, 'Alpha', 2, 3)]
      };

      const formData = await createMockFormDataWithFile(importData, 'test.json');
      const request = createMockRequest('http://localhost:3000/api/admin/import-company');
      jest.spyOn(request, 'formData').mockResolvedValue(formData);

      const response = await importHandler(request, {} as any);

      expect(response.status).toBe(403);
    });
  });
});
