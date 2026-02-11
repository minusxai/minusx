#!/usr/bin/env tsx
/**
 * Export SQLite database to JSON (stdout)
 *
 * This script exports companies, users, and documents from the database.
 * Outputs JSON to stdout, diagnostics to stderr.
 *
 * Usage:
 *   npm run export-db > output.json
 *   npm run export-db > lib/database/init-data.json
 *   npm run export-db | npm run validate-db
 */
import { exportDatabase } from '../lib/database/import-export';
import { validateInitData } from '../lib/database/validation';
import { DB_PATH } from '../lib/database/db-config';

async function main() {
  console.error('📦 Exporting database...\n');

  // Export database using reusable module
  const output = await exportDatabase(DB_PATH);

  // Validate exported data (warn if invalid, but allow export)
  console.error('🔍 Validating exported data...');
  const validation = validateInitData(output);

  if (!validation.valid) {
    console.error('⚠️  WARNING: Exported data has validation errors:');
    validation.errors.forEach(err => console.error(`  - ${err}`));
    console.error('   Continuing with export anyway. Fix these issues before importing.\n');
  }

  if (validation.warnings.length > 0) {
    console.error('⚠️  Warnings:');
    validation.warnings.forEach(warn => console.error(`  - ${warn}`));
    console.error('');
  }

  if (validation.valid) {
    console.error('✅ Validation passed\n');
  }

  console.error('='.repeat(60));
  console.error('✨ Export complete!');

  // Count from nested structure
  const companiesCount = output.companies.length;
  let usersCount = 0;
  let documentsCount = 0;

  for (const companyData of output.companies as import('../lib/database/import-export').CompanyData[]) {
    usersCount += companyData.users.length;
    documentsCount += companyData.documents.length;
  }

  console.error(`   Companies: ${companiesCount}`);
  console.error(`   Users: ${usersCount}`);
  console.error(`   Documents: ${documentsCount}`);

  if (!validation.valid) {
    console.error(`   ⚠️  Validation: FAILED (${validation.errors.length} errors)`);
  } else {
    console.error(`   ✅ Validation: PASSED`);
  }
  console.error('='.repeat(60));

  // Output JSON to stdout
  console.log(JSON.stringify(output, null, 2));
}

main();
