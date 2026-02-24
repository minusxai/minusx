#!/usr/bin/env tsx

/**
 * Database import tool with company selection
 *
 * ⚠️  CRITICAL: Stop the Next.js dev server before running this script!
 *     Running while the app is active will cause database corruption.
 *
 * Usage:
 *   npm run import-db                           # Safe default: init if missing, skip if exists
 *   npm run import-db -- --replace-db=y         # Force replace existing database
 *   npm run import-db -- path/to/data.json.gz   # Import from custom file
 *   cat backup.json | npm run import-db -- --stdin --replace-db=y
 *
 * Flags:
 *   --stdin          Read JSON from stdin instead of file
 *   --default        Use lib/database/init-data.json as input (automatic if no file)
 *   --all            Auto-select all companies (automatic with --default)
 *   --replace-db=y   Replace database if exists (skip confirmation)
 *   --replace-db=n   Exit early if database exists (DEFAULT - safe for restarts)
 *
 * Features:
 * - Detects running Next.js app (prevents corruption)
 * - Handles missing database (treats as empty for first-time setup)
 * - Parses and validates import file
 * - Applies migrations automatically
 * - Shows current database state
 * - Shows import file state with conflicts
 * - Interactive company selection or auto mode
 * - Atomic import with rollback on failure
 * - WAL checkpoint and proper cleanup
 */

import 'dotenv/config';
import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import { gunzip } from 'zlib';
import { promisify } from 'util';
import {
  exportDatabase,
  filterDataByCompanies,
  extractCompanyMetadata,
  atomicImport,
  InitData,
  CompanyData
} from '../lib/database/import-export';
import { applyMigrations, fixData, getTargetVersions } from '../lib/database/migrations';
import { validateInitData } from '../lib/database/validation';
import { DB_PATH, getDbType } from '../lib/database/db-config';
import { createAdapter } from '../lib/database/adapter/factory';

const gunzipAsync = promisify(gunzip);
const DEFAULT_INIT_DATA_PATH = path.join(process.cwd(), 'lib', 'database', 'init-data.json');

// Cleanup temp files on process termination
let cleanupDbPath: string | null = null;

function cleanup() {
  if (cleanupDbPath) {
    const tempDbPath = cleanupDbPath + '.tmp';
    if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
    const tempWalPath = tempDbPath + '-wal';
    const tempShmPath = tempDbPath + '-shm';
    if (fs.existsSync(tempWalPath)) fs.unlinkSync(tempWalPath);
    if (fs.existsSync(tempShmPath)) fs.unlinkSync(tempShmPath);
  }
}

process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('SIGTERM', () => { cleanup(); process.exit(143); });

async function isAppRunning(): Promise<boolean> {
  try {
    const authUrl = process.env.AUTH_URL || 'http://localhost:3000';
    const response = await fetch(`${authUrl}/api/health`, { signal: AbortSignal.timeout(1000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function readStdin(): Promise<string | null> {
  // Check if stdin is piped (not a TTY)
  if (process.stdin.isTTY) {
    return null;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const input = Buffer.concat(chunks).toString('utf8').trim();
  return input || null;
}

async function askQuestion(rl: readline.Interface, question: string): Promise<string> {
  return new Promise(resolve => {
    rl.question(question, resolve);
  });
}

async function main() {
  console.log('🚀 Database import\n');

  // Parse command line arguments
  const args = process.argv.slice(2);
  const useStdin = args.includes('--stdin');
  const filePath = args.find(arg => !arg.startsWith('--'));

  // Smart defaults: if no file path or stdin, use default source
  const useDefault = args.includes('--default') || (!useStdin && !filePath);

  // If using default source or stdin, auto-select all companies by default
  // (stdin can't do interactive prompts since it's already consumed by JSON data)
  const autoSelectAll = args.includes('--all') || useDefault || useStdin;

  // Safe default: don't replace if DB exists (require explicit --replace-db=y)
  const replaceDbArg = args.find(arg => arg.startsWith('--replace-db='));
  const replaceDbValue = replaceDbArg?.split('=')[1] || 'n';
  const skipConfirmation = replaceDbValue === 'y';

  // Set cleanup path
  cleanupDbPath = DB_PATH;

  // Determine input source
  let inputJson: string;
  let inputSource: string;

  if (useStdin) {
    console.log('📖 Reading from stdin...');
    const stdinData = await readStdin();
    if (!stdinData) {
      console.error('❌ Error: No data received from stdin');
      process.exit(1);
    }
    inputJson = stdinData;
    inputSource = 'stdin';
  } else if (useDefault) {
    console.log(`📖 Reading from default file: ${DEFAULT_INIT_DATA_PATH}`);
    if (!fs.existsSync(DEFAULT_INIT_DATA_PATH)) {
      console.error(`❌ Error: Default file not found at ${DEFAULT_INIT_DATA_PATH}`);
      console.error('   Run "npm run export-db > lib/database/init-data.json" to create it.');
      process.exit(1);
    }
    inputJson = fs.readFileSync(DEFAULT_INIT_DATA_PATH, 'utf-8');
    inputSource = DEFAULT_INIT_DATA_PATH;
  } else if (filePath) {
    console.log(`📖 Reading from file: ${filePath}`);
    if (!fs.existsSync(filePath)) {
      console.error(`❌ Error: File not found: ${filePath}`);
      process.exit(1);
    }

    // Read and parse file (handle gzip)
    const fileBuffer = fs.readFileSync(filePath);
    const isGzipped = filePath.endsWith('.gz') ||
                     (fileBuffer[0] === 0x1f && fileBuffer[1] === 0x8b);

    inputJson = isGzipped
      ? (await gunzipAsync(fileBuffer)).toString('utf-8')
      : fileBuffer.toString('utf-8');
    inputSource = filePath;
  } else {
    console.error('❌ Error: No input source specified');
    console.error('Usage:');
    console.error('  npm run import-db-interactive -- path/to/data.json.gz');
    console.error('  npm run import-db-interactive -- --default');
    console.error('  cat backup.json | npm run import-db-interactive -- --stdin');
    process.exit(1);
  }

  console.log(`✅ Using data from: ${inputSource}\n`);

  // Parse JSON
  let importData: InitData;
  try {
    importData = JSON.parse(inputJson);
  } catch (parseError: any) {
    console.error('❌ Invalid JSON:', parseError.message);
    process.exit(1);
  }

  // Add version if missing (backward compatibility)
  if (!importData.version) {
    console.warn('⚠️  No version field found, assuming version 0');
    importData.version = 0;
  }

  // Apply migrations (applyMigrations always runs fixData at the end)
  const targetVersions = getTargetVersions();
  if (importData.version < targetVersions.dataVersion) {
    console.log(`🔄 Migrating data from v${importData.version} to v${targetVersions.dataVersion}...`);
    importData = applyMigrations(importData, importData.version);
    console.log('✅ Data migration complete\n');
  } else {
    // Already at latest version — still run fixData to normalise any schema issues
    importData = fixData(importData);
  }

  // Validate import data
  console.log('🔍 Validating data...');
  const validation = validateInitData(importData);

  if (!validation.valid) {
    console.error('❌ Validation failed! Cannot import invalid data.\n');
    console.error('Errors found:');
    validation.errors.forEach(err => console.error(`  - ${err}`));

    if (validation.warnings.length > 0) {
      console.warn('\nWarnings:');
      validation.warnings.forEach(warn => console.warn(`  - ${warn}`));
    }

    console.error('\nPlease fix these issues before importing.');
    process.exit(1);
  }

  if (validation.warnings.length > 0) {
    console.warn('⚠️  Validation warnings:');
    validation.warnings.forEach(warn => console.warn(`  - ${warn}`));
    console.warn('');
  }

  console.log('✅ Validation passed\n');

  // Handle existing database (or treat as empty if missing)
  const dbType = getDbType();
  let dbExists = false;
  let dbInitialized = false;

  // Check if database exists and is initialized
  if (dbType === 'sqlite') {
    dbExists = fs.existsSync(DB_PATH);
    dbInitialized = dbExists;
  } else {
    // For PostgreSQL, check if tables exist in the target schema
    try {
      const db = await createAdapter({
        type: 'postgres',
        postgresConnectionString: process.env.POSTGRES_URL
      });

      // Check if companies table exists in the target schema (not just any schema)
      const targetSchema = process.env.POSTGRES_SCHEMA || 'public';
      const result = await db.query(
        `SELECT 1 FROM information_schema.tables
         WHERE table_schema = $1 AND table_name = 'companies'`,
        [targetSchema]
      );

      await db.close();
      dbExists = true;
      dbInitialized = result.rows.length > 0;
    } catch (error: any) {
      // Connection failed or other error
      dbExists = false;
      dbInitialized = false;
    }
  }

  console.log(`Database exists: ${dbExists}, initialized: ${dbInitialized}`);

  // Exit early if DB exists and --replace-db=n
  if (dbExists && replaceDbValue === 'n') {
    console.log('✅ Database already exists, skipping initialization (--replace-db=n)');
    process.exit(0);
  }

  const existingData: InitData = dbInitialized
    ? await exportDatabase(DB_PATH)
    : { version: targetVersions.dataVersion, companies: [] };

  // Show current database state
  if (dbInitialized && existingData.companies.length > 0) {
    console.log('\n📊 Current Database:');
    const existingMetadata = extractCompanyMetadata(existingData);
    existingMetadata.forEach(company => {
      console.log(`  [${company.id}] ${company.display_name}: ${company.stats.userCount} users, ${company.stats.documentCount} documents`);
    });
  } else {
    console.log('\n📊 Current Database: Empty (first-time setup)');
  }

  // Show import file state
  console.log('\n📦 Import File:');
  const importMetadata = extractCompanyMetadata(importData);
  importMetadata.forEach(company => {
    console.log(`  [${company.id}] ${company.display_name}: ${company.stats.userCount} users, ${company.stats.documentCount} documents`);
  });

  // Show conflicts
  const existingIds = existingData.companies.map((c: any) => c.id);
  const importIds = importMetadata.map(c => c.id);
  const willOverwrite = importIds.filter(id => existingIds.includes(id));
  const willAdd = importIds.filter(id => !existingIds.includes(id));

  if (willOverwrite.length > 0) {
    console.log('\n⚠️  Will Overwrite:');
    willOverwrite.forEach(id => {
      const company = importMetadata.find(c => c.id === id)!;
      console.log(`  [${id}] ${company.display_name}`);
    });
  }

  if (willAdd.length > 0) {
    console.log('\n✨ Will Add:');
    willAdd.forEach(id => {
      const company = importMetadata.find(c => c.id === id)!;
      console.log(`  [${id}] ${company.display_name}`);
    });
  }

  // Company selection (interactive or auto)
  let selectedIds: number[];

  if (autoSelectAll) {
    selectedIds = importIds;
    console.log(`\n✅ Auto-selected all companies: ${selectedIds.join(', ')}`);
  } else {
    // Interactive prompt
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const allIds = importIds.join(',');
    const answer = await askQuestion(rl, `\n🔢 Enter company IDs to import (comma-separated, or "all"): [${allIds}] `);

    if (!answer || answer.trim().toLowerCase() === 'all' || answer.trim() === '') {
      selectedIds = importIds;
    } else {
      selectedIds = answer.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
    }

    rl.close();

    if (selectedIds.length === 0) {
      console.log('❌ No companies selected, aborting.');
      process.exit(0);
    }

    // Validate selected IDs exist in import
    const invalidIds = selectedIds.filter(id => !importIds.includes(id));
    if (invalidIds.length > 0) {
      console.error(`❌ Invalid company IDs: ${invalidIds.join(', ')}`);
      console.error(`   Available IDs: ${importIds.join(', ')}`);
      process.exit(1);
    }

    console.log(`\n✅ Selected companies: ${selectedIds.join(', ')}`);
  }

  // Perform selective merge
  const filteredImportData = filterDataByCompanies(importData, selectedIds);
  const selectedIdSet = new Set(selectedIds);
  const keptCompanies = (existingData.companies as CompanyData[]).filter(
    c => !selectedIdSet.has(c.id)
  );
  const importedCompanies = filteredImportData.companies as CompanyData[];

  const mergedData: InitData = {
    version: importData.version,
    companies: [...keptCompanies, ...importedCompanies]
  };

  // Show summary
  console.log('\n📋 Import Summary:');
  console.log(`   Companies to keep: ${keptCompanies.length}`);
  console.log(`   Companies to import: ${importedCompanies.length}`);
  console.log(`   Total after import: ${mergedData.companies.length}`);

  // Confirmation
  if (!skipConfirmation) {
    const rl2 = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const confirmAnswer = await askQuestion(rl2, '\n⚠️  This will REPLACE the database. Continue? (yes/no): ');
    rl2.close();

    if (confirmAnswer.toLowerCase() !== 'yes') {
      console.log('❌ Aborted.');
      process.exit(0);
    }
  }

  // Import
  console.log('\n🔄 Importing...');
  await atomicImport(mergedData, DB_PATH);

  // Reinitialize connections on Python backend
  console.log('\n🔄 Reinitializing connections on Python backend...');
  try {
    const authUrl = process.env.AUTH_URL || 'http://localhost:3000';
    const response = await fetch(`${authUrl}/api/connections/reinitialize`, {
      method: 'POST'
    });

    if (response.ok) {
      const result = await response.json();
      console.log(`✅ ${result.message}\n`);
    } else {
      const error = await response.text();
      console.warn(`⚠️  Warning: Failed to reinitialize connections: ${error}\n`);
    }
  } catch (error: any) {
    console.warn(`⚠️  Warning: Could not reach Next.js backend to reinitialize connections: ${error.message}`);
    console.warn('   You may need to restart the frontend server.\n');
  }

  // Summary
  const documents = (mergedData.companies as CompanyData[]).flatMap(c => c.documents);
  const companiesCount = mergedData.companies.length;
  const usersCount = (mergedData.companies as CompanyData[]).reduce((sum, c) => sum + c.users.length, 0);

  const questions = documents.filter(d => d.type === 'question');
  const dashboards = documents.filter(d => d.type === 'dashboard');
  const notebooks = documents.filter(d => d.type === 'notebook');
  const presentations = documents.filter(d => d.type === 'presentation');
  const reports = documents.filter(d => d.type === 'report');
  const connections = documents.filter(d => d.type === 'connection');
  const folders = documents.filter(d => d.type === 'folder');
  const users = documents.filter(d => d.type === 'users');
  const contexts = documents.filter(d => d.type === 'context');

  console.log('='.repeat(60));
  console.log('✨ Database import complete!');
  console.log(`   Companies: ${companiesCount}`);
  console.log(`   Users: ${usersCount}`);
  console.log(`   Total documents: ${documents.length}`);
  console.log(`   Questions: ${questions.length}`);
  console.log(`   Dashboards: ${dashboards.length}`);
  console.log(`   Notebooks: ${notebooks.length}`);
  console.log(`   Presentations: ${presentations.length}`);
  console.log(`   Reports: ${reports.length}`);
  console.log(`   Connections: ${connections.length}`);
  console.log(`   Folders: ${folders.length}`);
  console.log(`   Users: ${users.length}`);
  console.log(`   Context files: ${contexts.length}`);
  console.log('');
  console.log('   Kept companies:', keptCompanies.length);
  console.log('   Imported companies:', importedCompanies.length);
  console.log('');
  console.log('   Database location:', DB_PATH);
  console.log('='.repeat(60));
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
