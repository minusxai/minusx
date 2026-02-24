/**
 * E2E Test: Selective Import/Export with Conflict Preview and Merge
 *
 * Tests the complete flow:
 * 1. Create initial DB with companies [1, 2, 3]
 * 2. Create import file with companies [1, 4, 5] (company 1 overlaps)
 * 3. Test conflict detection (company 1 = "will_overwrite")
 * 4. Test selective merge with selection [1, 5]
 * 5. Export → verify result is [1 (new), 2 (kept), 3 (kept), 5 (new)]
 * 6. Test per-company export (export only company 2)
 */

import * as path from 'path';
import {
  InitData,
  CompanyData,
  exportDatabase,
  atomicImport,
  filterDataByCompanies,
  extractCompanyMetadata
} from '@/lib/database/import-export';
import { createEmptyDatabase } from '@/scripts/create-empty-db';
import * as crypto from 'crypto';

const TEST_DB_PATH = path.join(process.cwd(), 'data', 'test_selective_import.db');

// Helper to hash company data for comparison
function hashCompany(company: CompanyData): string {
  const normalized = {
    id: company.id,
    name: company.name,
    display_name: company.display_name,
    users: company.users.map(u => ({ id: u.id, email: u.email, name: u.name })),
    documents: company.documents.map(d => ({ id: d.id, name: d.name, type: d.type }))
  };
  return crypto.createHash('md5').update(JSON.stringify(normalized)).digest('hex');
}

// Create test data
function createTestCompany(id: number, name: string, userCount: number, docCount: number): CompanyData {
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
    documents: Array.from({ length: docCount }, (_, i) => ({
      id: i + 1,
      name: `Document ${i + 1}`,
      path: `/org/doc${i + 1}`,
      type: i === 0 ? 'connection' as const : 'question' as const,
      references: [],  // Phase 6: Connections and questions have no references
      content: i === 0
        ? { type: 'duckdb' as const, name: 'test', database_type: 'duckdb', config: { file_path: 'test.duckdb' } } as any
        : { query: 'SELECT 1', database_name: 'test_db', vizSettings: { type: 'table' } },
      company_id: id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }))
  };
}

describe('Selective Import/Export E2E', () => {
  beforeEach(async () => {
    // Clean up any existing test database
    try {
      const fs = require('fs');
      [TEST_DB_PATH, TEST_DB_PATH + '-wal', TEST_DB_PATH + '-shm', TEST_DB_PATH + '.backup'].forEach(path => {
        if (fs.existsSync(path)) {
          fs.unlinkSync(path);
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
      [TEST_DB_PATH, TEST_DB_PATH + '-wal', TEST_DB_PATH + '-shm', TEST_DB_PATH + '.backup'].forEach(path => {
        if (fs.existsSync(path)) {
          fs.unlinkSync(path);
        }
      });
    } catch (err) {
      // Ignore cleanup errors
    }
  });

  it('should handle selective import with conflict preview and merge', async () => {
    // ============================================================
    // STEP 1: Create initial database with companies [1, 2, 3]
    // ============================================================
    const initialData: InitData = {
      version: 2,
      companies: [
        createTestCompany(1, 'Alpha', 2, 3),
        createTestCompany(2, 'Beta', 1, 2),
        createTestCompany(3, 'Gamma', 3, 5)
      ]
    };

    await atomicImport(initialData, TEST_DB_PATH);

    // Hash initial companies for later comparison
    const initialCompany1Hash = hashCompany(initialData.companies[0] as CompanyData);
    const initialCompany2Hash = hashCompany(initialData.companies[1] as CompanyData);
    const initialCompany3Hash = hashCompany(initialData.companies[2] as CompanyData);

    // ============================================================
    // STEP 2: Create import file with companies [1, 4, 5]
    // ============================================================
    // Company 1 overlaps (different data), companies 4 and 5 are new
    const importData: InitData = {
      version: 2,
      companies: [
        createTestCompany(1, 'Alpha_Modified', 3, 4), // Modified version of company 1
        createTestCompany(4, 'Delta', 2, 1),
        createTestCompany(5, 'Epsilon', 1, 3)
      ]
    };

    const importCompany1Hash = hashCompany(importData.companies[0] as CompanyData);

    // ============================================================
    // STEP 3: Test conflict detection
    // ============================================================
    const existingData = await exportDatabase(TEST_DB_PATH);
    const existingCompanyIds = (existingData.companies as CompanyData[]).map(c => c.id);
    const importCompanyIds = (importData.companies as CompanyData[]).map(c => c.id);

    const willOverwrite = importCompanyIds.filter(id => existingCompanyIds.includes(id));
    const willAdd = importCompanyIds.filter(id => !existingCompanyIds.includes(id));

    expect(existingCompanyIds.sort()).toEqual([1, 2, 3]);
    expect(willOverwrite).toEqual([1]);
    expect(willAdd.sort()).toEqual([4, 5]);

    // Test extractCompanyMetadata with conflict status
    const metadata = extractCompanyMetadata(importData).map(company => ({
      ...company,
      conflictStatus: existingCompanyIds.includes(company.id) ? 'will_overwrite' as const : 'new' as const
    }));

    expect(metadata).toHaveLength(3);
    expect(metadata[0].conflictStatus).toBe('will_overwrite'); // Company 1
    expect(metadata[1].conflictStatus).toBe('new'); // Company 4
    expect(metadata[2].conflictStatus).toBe('new'); // Company 5

    // ============================================================
    // STEP 4: Perform selective merge with selection [1, 5]
    // ============================================================
    // User selects companies 1 and 5 (deselects company 4)
    // Expected result: [1 (new), 2 (kept), 3 (kept), 5 (new)]

    const selectedCompanyIds = [1, 5];

    // SURGICAL IMPORT: Import only selected companies using atomicImport
    // This automatically keeps companies 2 and 3, replaces 1, and adds 5
    await atomicImport(importData, TEST_DB_PATH, selectedCompanyIds);

    // ============================================================
    // STEP 5: Export and verify the final state
    // ============================================================
    const exportedData = await exportDatabase(TEST_DB_PATH);

    expect(exportedData.companies).toHaveLength(4);

    // Verify company IDs
    const exportedCompanyIds = (exportedData.companies as CompanyData[]).map(c => c.id).sort();
    expect(exportedCompanyIds).toEqual([1, 2, 3, 5]);

    // Verify company 1 was replaced (hash should match import, not initial)
    const finalCompany1 = (exportedData.companies as CompanyData[]).find(c => c.id === 1)!;
    const finalCompany1Hash = hashCompany(finalCompany1);
    expect(finalCompany1Hash).toBe(importCompany1Hash);
    expect(finalCompany1Hash).not.toBe(initialCompany1Hash);
    expect(finalCompany1.display_name).toBe('Alpha_Modified Corp');

    // Verify companies 2 and 3 were kept unchanged
    const finalCompany2 = (exportedData.companies as CompanyData[]).find(c => c.id === 2)!;
    const finalCompany2Hash = hashCompany(finalCompany2);
    expect(finalCompany2Hash).toBe(initialCompany2Hash);

    const finalCompany3 = (exportedData.companies as CompanyData[]).find(c => c.id === 3)!;
    const finalCompany3Hash = hashCompany(finalCompany3);
    expect(finalCompany3Hash).toBe(initialCompany3Hash);

    // Verify company 5 was added
    const finalCompany5 = (exportedData.companies as CompanyData[]).find(c => c.id === 5)!;
    expect(finalCompany5).toBeDefined();
    expect(finalCompany5.display_name).toBe('Epsilon Corp');

    // Verify company 4 was NOT imported (deselected)
    const finalCompany4 = (exportedData.companies as CompanyData[]).find(c => c.id === 4);
    expect(finalCompany4).toBeUndefined();
  });

  it('should support per-company export using filterDataByCompanies', async () => {
    // ============================================================
    // STEP 1: Create database with multiple companies
    // ============================================================
    const initialData: InitData = {
      version: 2,
      companies: [
        createTestCompany(1, 'Alpha', 2, 3),
        createTestCompany(2, 'Beta', 1, 2),
        createTestCompany(3, 'Gamma', 3, 5)
      ]
    };

    await atomicImport(initialData, TEST_DB_PATH);

    // ============================================================
    // STEP 2: Export only company 2 using filterDataByCompanies
    // ============================================================
    const allData = await exportDatabase(TEST_DB_PATH);
    const company2Data = filterDataByCompanies(allData, [2]);

    expect(company2Data.companies).toHaveLength(1);

    const exportedCompany = company2Data.companies[0] as CompanyData;
    expect(exportedCompany.id).toBe(2);
    expect(exportedCompany.name).toBe('Beta');
    expect(exportedCompany.display_name).toBe('Beta Corp');
    expect(exportedCompany.users).toHaveLength(1);
    expect(exportedCompany.documents).toHaveLength(2);
  });

  it('should support per-company export using exportDatabase with companyId parameter', async () => {
    // ============================================================
    // STEP 1: Create database with multiple companies
    // ============================================================
    const initialData: InitData = {
      version: 2,
      companies: [
        createTestCompany(1, 'Alpha', 2, 3),
        createTestCompany(2, 'Beta', 1, 2),
        createTestCompany(3, 'Gamma', 3, 5)
      ]
    };

    await atomicImport(initialData, TEST_DB_PATH);

    // ============================================================
    // STEP 2: Export only company 2 using companyId parameter (efficient SQL filtering)
    // ============================================================
    const company2Data = await exportDatabase(TEST_DB_PATH, 2);

    expect(company2Data.companies).toHaveLength(1);

    const exportedCompany = company2Data.companies[0] as CompanyData;
    expect(exportedCompany.id).toBe(2);
    expect(exportedCompany.name).toBe('Beta');
    expect(exportedCompany.display_name).toBe('Beta Corp');
    expect(exportedCompany.users).toHaveLength(1);
    expect(exportedCompany.documents).toHaveLength(2);

    // ============================================================
    // STEP 3: Verify filtering at SQL level returns same result as post-processing
    // ============================================================
    const allData = await exportDatabase(TEST_DB_PATH);
    const filteredData = filterDataByCompanies(allData, [2]);

    // Both methods should return identical results
    expect(company2Data.companies).toHaveLength(filteredData.companies.length);
    expect(hashCompany(company2Data.companies[0] as CompanyData)).toBe(
      hashCompany(filteredData.companies[0] as CompanyData)
    );
  });

  it('should return empty array when exporting non-existent company by ID', async () => {
    // ============================================================
    // STEP 1: Create database with companies [1, 2]
    // ============================================================
    const initialData: InitData = {
      version: 2,
      companies: [
        createTestCompany(1, 'Alpha', 2, 3),
        createTestCompany(2, 'Beta', 1, 2)
      ]
    };

    await atomicImport(initialData, TEST_DB_PATH);

    // ============================================================
    // STEP 2: Try to export company 999 (doesn't exist)
    // ============================================================
    const exportedData = await exportDatabase(TEST_DB_PATH, 999);

    expect(exportedData.companies).toHaveLength(0);
  });

  it('should handle filtering non-existent company', async () => {
    // ============================================================
    // STEP 1: Create database with companies [1, 2]
    // ============================================================
    const initialData: InitData = {
      version: 2,
      companies: [
        createTestCompany(1, 'Alpha', 2, 3),
        createTestCompany(2, 'Beta', 1, 2)
      ]
    };

    await atomicImport(initialData, TEST_DB_PATH);

    // ============================================================
    // STEP 2: Try to filter company 999 (doesn't exist)
    // ============================================================
    const allData = await exportDatabase(TEST_DB_PATH);
    const filteredData = filterDataByCompanies(allData, [999]);

    expect(filteredData.companies).toHaveLength(0);
  });

  it('should correctly extract company metadata', async () => {
    // ============================================================
    // Create test data with various document types
    // ============================================================
    const testData: InitData = {
      version: 2,
      companies: [
        {
          id: 1,
          name: 'TestCo',
          display_name: 'Test Company',
          subdomain: 'test',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          users: [
            {
              id: 1,
              email: 'admin@test.com',
              name: 'Admin',
              password_hash: 'hash',
              phone: null,
              state: null,
              home_folder: '/org',
              role: 'admin',
              company_id: 1,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            },
            {
              id: 2,
              email: 'user@test.com',
              name: 'User',
              password_hash: 'hash',
              phone: null,
              state: null,
              home_folder: '/org',
              role: 'viewer',
              company_id: 1,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            }
          ],
          documents: [
            {
              id: 1,
              name: 'Connection',
              path: '/conn',
              type: 'connection' as const,
              references: [],  // Phase 6: Connections have no references
              content: { type: 'duckdb' as const, name: 'test', database_type: 'duckdb', config: { file_path: 'test.duckdb' } } as any,
              company_id: 1,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            },
            {
              id: 2,
              name: 'Question 1',
              path: '/q1',
              type: 'question' as const,
              references: [],  // Phase 6: Questions have no references
              content: {
                query: 'SELECT 1',
                vizSettings: { type: 'table' as const },
                database_name: 'default_db'
              },
              company_id: 1,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            },
            {
              id: 3,
              name: 'Question 2',
              path: '/q2',
              type: 'question' as const,
              references: [],  // Phase 6: Questions have no references
              content: {
                query: 'SELECT 2',
                vizSettings: { type: 'table' as const },
                database_name: 'default_db'
              },
              company_id: 1,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            },
            {
              id: 4,
              name: 'Dashboard',
              path: '/dash',
              type: 'dashboard' as const,
              references: [],  // Phase 6: References extracted from content.assets
              content: {
                assets: []
              },
              company_id: 1,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            }
          ]
        }
      ]
    };

    // ============================================================
    // Extract and verify metadata
    // ============================================================
    const metadata = extractCompanyMetadata(testData);

    expect(metadata).toHaveLength(1);
    expect(metadata[0]).toEqual({
      id: 1,
      name: 'TestCo',
      display_name: 'Test Company',
      subdomain: 'test',
      stats: {
        userCount: 2,
        documentCount: 4,
        documentsByType: {
          connection: 1,
          question: 2,
          dashboard: 1
        }
      }
    });
  });
});
