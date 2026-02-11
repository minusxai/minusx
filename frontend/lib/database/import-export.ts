/**
 * Reusable import/export functions for database management
 * Shared between CLI scripts and admin APIs
 */

import fs from 'fs';
import path from 'path';
import { DbRow } from './documents-db';
import { DB_PATH, getDbType } from './db-config';
import { createEmptyDatabase } from '../../scripts/create-empty-db';
import { Company } from './company-db';
import { User } from './user-db';
import { DbFile } from '../types';
import { getDataVersion } from './config-db';
import { createAdapter } from './adapter/factory';
import { hashPassword } from '../auth/password-utils';
import { DEFAULT_STYLES } from '../branding/whitelabel';
import companyTemplate from './company-template.json';

/**
 * Company data with nested users and documents
 */
export interface CompanyData {
  id: number;
  name: string;
  display_name: string;
  subdomain: string | null;
  created_at: string;
  updated_at: string;
  users: User[];
  documents: ExportedDocument[];
}

/**
 * Interface for database export/import data
 * Companies array with nested users/documents
 */
export interface InitData {
  version: number;  // Data format version
  companies: CompanyData[];  // Array of companies with nested users/documents
}

/**
 * Document structure for export/import
 * Extends DbFile but makes company_id required for import/export
 */
export interface ExportedDocument extends Omit<DbFile, 'company_id'> {
  company_id: number;  // Required in export format
}

/**
 * Export entire database to InitData format
 * Reads actual version from configs table to ensure accurate export
 *
 * @param dbPath - Path to database file (default: DB_PATH)
 * @param companyId - Optional company ID to filter export (more efficient than post-processing)
 */
export async function exportDatabase(dbPath: string = DB_PATH, companyId?: number): Promise<InitData> {
  const dbType = getDbType();
  const db = dbType === 'sqlite'
    ? await createAdapter({ type: 'sqlite', sqlitePath: dbPath })
    : await createAdapter({ type: 'postgres', postgresConnectionString: process.env.POSTGRES_URL });

  try {
    // Get actual data version from configs table (or 0 if not set)
    const currentVersion = await getDataVersion(db);

    // Export companies (with optional filter)
    const companySql = companyId
      ? 'SELECT * FROM companies WHERE id = $1 ORDER BY id'
      : 'SELECT * FROM companies ORDER BY id';
    const companiesResult = companyId
      ? await db.query<Company>(companySql, [companyId])
      : await db.query<Company>(companySql);
    const companies = companiesResult.rows;

    // Export users (with optional company filter)
    const userSql = companyId
      ? 'SELECT * FROM users WHERE company_id = $1 ORDER BY id'
      : 'SELECT * FROM users ORDER BY id';
    const usersResult = companyId
      ? await db.query<User>(userSql, [companyId])
      : await db.query<User>(userSql);
    const users = usersResult.rows;

    // Export documents from the specified database (with optional company filter at SQL level)
    // Query directly - bypasses multi-tenant isolation (admin operation only)
    const docSql = companyId
      ? 'SELECT * FROM files WHERE company_id = $1 ORDER BY updated_at DESC'
      : 'SELECT * FROM files ORDER BY updated_at DESC';
    const docsResult = companyId
      ? await db.query<DbRow>(docSql, [companyId])
      : await db.query<DbRow>(docSql);

    const allDocs: DbFile[] = docsResult.rows.map((row) => ({
      id: row.id,
      name: row.name,
      path: row.path,
      type: row.type as any,
      references: JSON.parse(row.file_references || '[]'),  // Phase 6: Parse file_references array
      content: JSON.parse(row.content),
      company_id: row.company_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));

    // Map documents to export format
    const documents: ExportedDocument[] = allDocs.map(doc => ({
      id: doc.id,
      name: doc.name,
      path: doc.path,
      type: doc.type,
      references: doc.references,  // Phase 6: Include references array
      content: doc.content,
      company_id: doc.company_id!,  // Always present - we just queried it from DB (NOT NULL column)
      created_at: doc.created_at,
      updated_at: doc.updated_at
    }));

    // Group by company (nested structure)
    const companiesData: CompanyData[] = companies.map(company => {
      const companyUsers = users.filter(u => u.company_id === company.id);
      const companyDocs = documents.filter(d => d.company_id === company.id);

      // Sort by ID for consistent ordering (important for hash-based comparisons in tests)
      companyUsers.sort((a, b) => a.id - b.id);
      companyDocs.sort((a, b) => a.id - b.id);

      return {
        id: company.id,
        name: company.name,
        display_name: company.display_name,
        subdomain: company.subdomain,
        created_at: company.created_at,
        updated_at: company.updated_at,
        users: companyUsers,
        documents: companyDocs
      };
    });

    return {
      version: currentVersion,
      companies: companiesData
    };
  } finally {
    await db.close();
  }
}

/**
 * Import data to a specific database file
 * Creates database if it doesn't exist
 * Does NOT validate - caller should validate before calling
 *
 * @param dbPath - Path to database file
 * @param initData - Data to import
 * @param companyIdsToImport - Optional: Only import these companies (surgical import)
 *                             If specified, deletes only these companies and imports new data
 *                             If not specified, replaces entire database
 */
export async function importToDatabase(dbPath: string, initData: InitData, companyIdsToImport?: number[]): Promise<void> {
  const dbType = getDbType();

  if (dbType === 'sqlite') {
    // SQLite: Ensure directory exists
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    // Create empty database if it doesn't exist
    if (!fs.existsSync(dbPath)) {
      await createEmptyDatabase(dbPath);
    }
  }
  // For PostgreSQL: Assume database exists (created by DBA)

  const db = dbType === 'sqlite'
    ? await createAdapter({ type: 'sqlite', sqlitePath: dbPath })
    : await createAdapter({ type: 'postgres', postgresConnectionString: process.env.POSTGRES_URL });

  try {
    // Wrap all imports in a transaction for atomicity
    await db.transaction(async (tx) => {
      // Determine if this is a surgical import (specific companies) or full replace
      const isSurgical = companyIdsToImport && companyIdsToImport.length > 0;

      if (isSurgical) {
        // SURGICAL IMPORT: Delete only specified companies, keep the rest
        const placeholders = companyIdsToImport!.map((_, i) => `$${i + 1}`).join(',');

        // Delete in reverse order of foreign keys
        await tx.query(`DELETE FROM files WHERE company_id IN (${placeholders})`, companyIdsToImport);
        await tx.query(`DELETE FROM users WHERE company_id IN (${placeholders})`, companyIdsToImport);
        await tx.query(`DELETE FROM companies WHERE id IN (${placeholders})`, companyIdsToImport);
      } else {
        // FULL REPLACE: Clear all existing data
        await tx.query('DELETE FROM files');
        await tx.query('DELETE FROM users');
        await tx.query('DELETE FROM companies');
      }

      // Import companies (nested structure)
      const companiesToImport = isSurgical
        ? (initData.companies as CompanyData[]).filter(c => companyIdsToImport!.includes(c.id))
        : (initData.companies as CompanyData[]);

      for (const companyData of companiesToImport) {
        // Import company
        await tx.query(
          'INSERT INTO companies (id, name, display_name, subdomain, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)',
          [
            companyData.id,
            companyData.name,
            companyData.display_name,
            companyData.subdomain || null,
            companyData.created_at,
            companyData.updated_at
          ]
        );

        // Import users for this company
        for (const user of companyData.users) {
          await tx.query(
            'INSERT INTO users (company_id, id, email, name, password_hash, home_folder, role, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
            [
              companyData.id,  // company_id first (composite key)
              user.id,
              user.email,
              user.name,
              user.password_hash || null,
              user.home_folder ?? '',  // Default to empty string (mode root) for relative paths
              user.role || 'viewer',
              user.created_at,
              user.updated_at
            ]
          );
        }

        // Import documents for this company
        for (const doc of companyData.documents) {
          await tx.query(
            'INSERT INTO files (company_id, id, name, path, type, content, file_references, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
            [
              companyData.id,  // company_id first (composite key)
              doc.id,
              doc.name,
              doc.path,
              doc.type,
              JSON.stringify(doc.content),
              JSON.stringify(doc.references || []),  // Phase 6: Import file_references column
              doc.created_at,
              doc.updated_at
            ]
          );
        }
      }

      // Set data version and schema version in configs table
      const { setDataVersion, setSchemaVersion } = require('./config-db');
      const { LATEST_SCHEMA_VERSION } = require('./constants');
      await setDataVersion(initData.version, tx);
      await setSchemaVersion(LATEST_SCHEMA_VERSION, tx);
    });
  } finally {
    await db.close();
  }
}

/**
 * Atomic import with validation and rollback
 * SQLite: Creates temporary database, validates, then swaps atomically
 * PostgreSQL: Uses transaction for atomicity (no temp database needed)
 *
 * @param initData - Data to import
 * @param targetDbPath - Target database path (default: DB_PATH)
 * @param companyIdsToImport - Optional: Only import these companies (surgical import)
 *                             If specified, performs surgical import keeping other companies
 *                             If not specified, replaces entire database
 * @throws Error if validation fails or import errors
 */
export async function atomicImport(
  initData: InitData,
  targetDbPath: string = DB_PATH,
  companyIdsToImport?: number[]
): Promise<void> {
  const isSurgical = companyIdsToImport && companyIdsToImport.length > 0;
  const dbType = getDbType();

  // SURGICAL IMPORT: Same for both databases (uses transactions)
  if (isSurgical) {
    console.log(`📦 Surgical import: Replacing companies [${companyIdsToImport!.join(', ')}]...`);
    await importToDatabase(targetDbPath, initData, companyIdsToImport);

    // Validate after import
    console.log('✅ Surgical import complete, validating...');
    const exportedData = await exportDatabase(targetDbPath);
    const { validateInitData } = await import('./validation');
    const validation = validateInitData(exportedData);

    if (!validation.valid) {
      console.error('❌ Validation failed after surgical import:');
      validation.errors.forEach(err => console.error(`  - ${err}`));
      throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
    }

    if (validation.warnings.length > 0) {
      console.warn('⚠️  Warnings:');
      validation.warnings.forEach(warn => console.warn(`  - ${warn}`));
    }

    console.log('✅ Surgical import and validation complete');
    return;
  }

  // FULL REPLACE: Different strategies for SQLite vs PostgreSQL
  if (dbType === 'sqlite') {
    await atomicImportSqlite(initData, targetDbPath);
  } else if (dbType === 'postgres') {
    await atomicImportPostgres(initData, targetDbPath);
  } else {
    throw new Error(`Unknown database type: ${dbType}`);
  }
}

/**
 * SQLite: Atomic import with temp file swap
 * Preserves existing file-based atomic swap behavior
 */
async function atomicImportSqlite(initData: InitData, targetDbPath: string): Promise<void> {
  const tempDbPath = targetDbPath + '.tmp';
  const backupDbPath = targetDbPath + '.backup';

  try {
    // Step 1: Import to temporary database (isolated)
    console.log('📦 Importing to temporary database...');
    await importToDatabase(tempDbPath, initData);

    // Step 2: Validate temporary database
    console.log('✅ Import to temp DB complete, validating...');
    const exportedData = await exportDatabase(tempDbPath);

    // Note: Caller should validate before calling atomicImport,
    // but we do a final check here as a safety measure
    const { validateInitData } = await import('./validation');
    const validation = validateInitData(exportedData);

    if (!validation.valid) {
      console.error('❌ Validation failed after import:');
      validation.errors.forEach(err => console.error(`  - ${err}`));
      throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
    }

    if (validation.warnings.length > 0) {
      console.warn('⚠️  Warnings:');
      validation.warnings.forEach(warn => console.warn(`  - ${warn}`));
    }

    // Step 2.5: Checkpoint temp DB WAL to consolidate
    console.log('🔄 Checkpointing temp DB WAL...');
    const checkpointTempDb = await createAdapter({ type: 'sqlite', sqlitePath: tempDbPath });
    await checkpointTempDb.optimize();
    await checkpointTempDb.close();
    console.log('✅ Temp DB WAL checkpoint complete');

    // Step 2.6: Checkpoint current DB WAL to flush to disk (if exists)
    if (fs.existsSync(targetDbPath)) {
      console.log('🔄 Checkpointing current DB WAL...');
      const checkpointCurrentDb = await createAdapter({ type: 'sqlite', sqlitePath: targetDbPath });
      await checkpointCurrentDb.optimize();
      await checkpointCurrentDb.close();
      console.log('✅ Current DB WAL checkpoint complete');
    }

    // Step 3: Atomic file swap
    console.log('🔄 Swapping databases...');

    // Backup existing database if it exists
    if (fs.existsSync(targetDbPath)) {
      // Remove old backup if exists
      if (fs.existsSync(backupDbPath)) {
        fs.unlinkSync(backupDbPath);
      }
      // Rename current to backup
      fs.renameSync(targetDbPath, backupDbPath);
    }

    try {
      // Rename temp to target (atomic operation)
      fs.renameSync(tempDbPath, targetDbPath);

      // Also move WAL and SHM files if they exist
      const tempWalPath = tempDbPath + '-wal';
      const tempShmPath = tempDbPath + '-shm';
      const targetWalPath = targetDbPath + '-wal';
      const targetShmPath = targetDbPath + '-shm';

      if (fs.existsSync(tempWalPath)) {
        if (fs.existsSync(targetWalPath)) fs.unlinkSync(targetWalPath);
        fs.renameSync(tempWalPath, targetWalPath);
      }
      if (fs.existsSync(tempShmPath)) {
        if (fs.existsSync(targetShmPath)) fs.unlinkSync(targetShmPath);
        fs.renameSync(tempShmPath, targetShmPath);
      }

      // Success! Remove backup
      if (fs.existsSync(backupDbPath)) {
        fs.unlinkSync(backupDbPath);
        // Also remove backup WAL/SHM files
        const backupWalPath = backupDbPath + '-wal';
        const backupShmPath = backupDbPath + '-shm';
        if (fs.existsSync(backupWalPath)) fs.unlinkSync(backupWalPath);
        if (fs.existsSync(backupShmPath)) fs.unlinkSync(backupShmPath);
      }

      console.log('✅ Database file swap complete');

      // Step 4: Close singleton adapter AFTER swap
      // Old connection now points to .backup file (harmless)
      // Next request will create new connection to new DB
      console.log('🔄 Closing singleton adapter...');
      const { resetAdapter } = await import('./adapter/factory');
      await resetAdapter();
      console.log('✅ Singleton adapter closed - new connections will use new database');

      console.log('✅ Database import complete');
    } catch (swapError) {
      // Rollback: restore backup
      if (fs.existsSync(backupDbPath)) {
        if (fs.existsSync(targetDbPath)) fs.unlinkSync(targetDbPath);
        fs.renameSync(backupDbPath, targetDbPath);
      }
      throw swapError;
    }
  } catch (error) {
    // Cleanup temp files on error
    if (fs.existsSync(tempDbPath)) {
      fs.unlinkSync(tempDbPath);
      const tempWalPath = tempDbPath + '-wal';
      const tempShmPath = tempDbPath + '-shm';
      if (fs.existsSync(tempWalPath)) fs.unlinkSync(tempWalPath);
      if (fs.existsSync(tempShmPath)) fs.unlinkSync(tempShmPath);
    }
    throw error;
  }
}

/**
 * PostgreSQL: Atomic import using transaction
 * No temp database needed - transaction provides atomicity
 */
async function atomicImportPostgres(initData: InitData, _targetDbPath: string): Promise<void> {
  console.log('📦 PostgreSQL: Importing with transaction (no temp database needed)...');

  // Validate BEFORE starting transaction (fail fast)
  const { validateInitData } = await import('./validation');
  const validation = validateInitData(initData);

  if (!validation.valid) {
    console.error('❌ Validation failed before import:');
    validation.errors.forEach(err => console.error(`  - ${err}`));
    throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
  }

  if (validation.warnings.length > 0) {
    console.warn('⚠️  Warnings:');
    validation.warnings.forEach(warn => console.warn(`  - ${warn}`));
  }

  // Ensure schema exists (idempotent - safe to call multiple times)
  console.log('🔧 Ensuring PostgreSQL schema exists...');
  const db = await createAdapter({
    type: 'postgres',
    postgresConnectionString: process.env.POSTGRES_URL
  });
  await db.initializeSchema();
  await db.close();
  console.log('✅ Schema ready');

  // Import directly to target (transaction provides atomicity)
  // If this fails, transaction rolls back automatically
  await importToDatabase(_targetDbPath, initData);

  console.log('✅ PostgreSQL import complete (transaction committed)');

  // Close singleton adapter to refresh connection
  console.log('🔄 Closing singleton adapter...');
  const { resetAdapter } = await import('./adapter/factory');
  await resetAdapter();
  console.log('✅ Singleton adapter closed - new connections will use refreshed database');
}

/**
 * Create a new company with admin user and default resources
 * Uses template-based approach for easier customization
 *
 * @param companyName - Name of the company (must be unique)
 * @param adminName - Full name of admin user
 * @param adminEmail - Email of admin user
 * @param adminPassword - Password for admin user (will be hashed)
 * @returns Object with companyId, userId, and adminEmail
 */
export async function createNewCompany(
  companyName: string,
  adminName: string,
  adminEmail: string,
  adminPassword: string,
  subdomain: string
): Promise<{ companyId: number; userId: number; adminEmail: string }> {
  // Get the next available company ID
  const nextCompanyId = await getNextCompanyId();

  // Hash password
  const passwordHash = await hashPassword(adminPassword);
  const now = new Date().toISOString();
  const defaultDbType = process.env.DEFAULT_DB_TYPE || 'duckdb';

  // Deep clone template to avoid mutating the imported object
  const templateContent = JSON.stringify(companyTemplate);

  // Do all text replacements first
  const processedTemplate = templateContent
    .replace(/"{{COMPANY_ID}}"/g, String(nextCompanyId))
    .replace(/\{\{COMPANY_NAME\}\}/g, companyName)
    .replace(/\{\{ADMIN_EMAIL\}\}/g, adminEmail)
    .replace(/\{\{ADMIN_NAME\}\}/g, adminName)
    .replace(/\{\{ADMIN_PASSWORD_HASH\}\}/g, passwordHash)
    .replace(/\{\{TIMESTAMP\}\}/g, now)
    .replace(/\{\{DEFAULT_DB_TYPE\}\}/g, defaultDbType)
    .replace(/"\{\{DEFAULT_STYLES\}\}"/g, JSON.stringify(DEFAULT_STYLES));

  // Parse to JSON, then set subdomain directly
  const initData: InitData = JSON.parse(processedTemplate);

  // Set subdomain on the company object directly (type-safe)
  if (initData.companies && initData.companies.length > 0) {
    initData.companies[0].subdomain = subdomain;
  }

  // Use surgical import to add this specific company without affecting others
  await importToDatabase(DB_PATH, initData, [nextCompanyId]);

  // Return the created company and user info
  return {
    companyId: nextCompanyId,
    userId: 1,    // Template always uses user id=1
    adminEmail
  };
}

/**
 * Get the next available company ID
 * Returns 1 if no companies exist, otherwise max(id) + 1
 */
export async function getNextCompanyId(): Promise<number> {
  const dbType = getDbType();
  const db = dbType === 'sqlite'
    ? await createAdapter({ type: 'sqlite', sqlitePath: DB_PATH })
    : await createAdapter({ type: 'postgres', postgresConnectionString: process.env.POSTGRES_URL });

  try {
    const result = await db.query<{ max_id: number | null }>(
      'SELECT MAX(id) as max_id FROM companies',
      []
    );
    const maxId = result.rows[0]?.max_id;
    return maxId ? maxId + 1 : 1;
  } finally {
    await db.close();
  }
}

/**
 * Filter InitData to only include selected companies
 * Used for selective import and per-company export
 */
export function filterDataByCompanies(
  initData: InitData,
  selectedCompanyIds: number[]
): InitData {
  const selectedIdSet = new Set(selectedCompanyIds);

  const filteredCompanies = (initData.companies as CompanyData[]).filter(
    company => selectedIdSet.has(company.id)
  );

  return {
    version: initData.version,
    companies: filteredCompanies
  };
}

/**
 * Company metadata for import preview
 */
export interface CompanyMetadata {
  id: number;
  name: string;
  display_name: string;
  subdomain: string | null;
  stats: {
    userCount: number;
    documentCount: number;
    documentsByType: Record<string, number>;
  };
}

/**
 * Extract per-company metadata for import preview
 * Returns stats about users and documents for each company
 */
export function extractCompanyMetadata(initData: InitData): CompanyMetadata[] {
  return (initData.companies as CompanyData[]).map(company => {
    // Count documents by type
    const documentsByType: Record<string, number> = {};
    company.documents.forEach(doc => {
      documentsByType[doc.type] = (documentsByType[doc.type] || 0) + 1;
    });

    return {
      id: company.id,
      name: company.name,
      display_name: company.display_name,
      subdomain: company.subdomain,
      stats: {
        userCount: company.users.length,
        documentCount: company.documents.length,
        documentsByType
      }
    };
  });
}
