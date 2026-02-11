#!/usr/bin/env tsx
/**
 * Validate database data from stdin
 *
 * This script checks the data for:
 * - File content structure (all files must have 'name' field)
 * - Invalid file references (dashboards → questions)
 * - Companies without admin users
 * - Companies without database connections
 * - Duplicate IDs, paths, etc.
 *
 * Usage:
 *   npm run export-db | npm run validate-db
 *   cat lib/database/init-data.json | npm run validate-db
 *
 * Exit codes:
 *   0 - Data is valid (warnings are OK)
 *   1 - Data has validation errors
 */

import { validateInitData } from '../lib/database/validation';
import { InitData } from '../lib/database/import-export';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  console.log('🔍 Validating data from stdin...\n');

  // Read JSON from stdin
  console.log('📖 Reading JSON input...');
  const input = await readStdin();

  if (!input.trim()) {
    console.error('❌ Error: No input provided');
    console.error('   Usage: npm run export-db | npm run validate-db');
    process.exit(1);
  }

  let data: InitData;
  try {
    data = JSON.parse(input);
  } catch (error: any) {
    console.error(`❌ Error parsing JSON: ${error.message}`);
    process.exit(1);
  }

  // Count from nested structure
  const companiesCount = data.companies.length;

  const usersCount = (data.companies as import('../lib/database/import-export').CompanyData[]).reduce((sum, c) => sum + c.users.length, 0);

  const documentsCount = (data.companies as import('../lib/database/import-export').CompanyData[]).reduce((sum, c) => sum + c.documents.length, 0);

  console.log(`✅ Loaded ${companiesCount} companies, ${usersCount} users, ${documentsCount} documents\n`);

  // Validate
  console.log('🔍 Running validation checks...\n');
  const validation = validateInitData(data);

  // Report results
  if (validation.errors.length > 0) {
    console.error('❌ Validation FAILED - Errors found:\n');
    validation.errors.forEach(err => console.error(`  - ${err}`));
    console.error('');
  } else {
    console.log('✅ Validation PASSED - No errors found\n');
  }

  if (validation.warnings.length > 0) {
    console.warn('⚠️  Warnings:\n');
    validation.warnings.forEach(warn => console.warn(`  - ${warn}`));
    console.warn('');
  }

  // Summary
  console.log('='.repeat(60));
  if (validation.valid) {
    console.log('✅ Data is valid!');
    console.log(`   Companies: ${companiesCount}`);
    console.log(`   Users: ${usersCount}`);
    console.log(`   Documents: ${documentsCount}`);
    if (validation.warnings.length > 0) {
      console.log(`   Warnings: ${validation.warnings.length} (non-critical)`);
    }
  } else {
    console.log('❌ Data has validation errors!');
    console.log(`   Errors: ${validation.errors.length}`);
    console.log(`   Warnings: ${validation.warnings.length}`);
    console.log('');
    console.log('   Fix these errors before importing.');
  }
  console.log('='.repeat(60));

  // Exit with appropriate code
  process.exit(validation.valid ? 0 : 1);
}

main();
