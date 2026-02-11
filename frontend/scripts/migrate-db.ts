#!/usr/bin/env tsx

/**
 * Database migration runner
 * Applies data format and schema migrations automatically
 *
 * Usage:
 *   npm run migrate-db           # Run migrations if needed
 *   npm run migrate-db -- -f     # Force empty migration even if up to date
 */

// Load environment variables from .env file
import 'dotenv/config';

import fs from 'fs';
import { DB_PATH, getDbType } from '../lib/database/db-config';
import { getDataVersion, getSchemaVersion, setDataVersion, setSchemaVersion } from '../lib/database/config-db';
import { exportDatabase, atomicImport } from '../lib/database/import-export';
import { applyMigrations, needsSchemaMigration, getTargetVersions, MIGRATIONS } from '../lib/database/migrations';
import { createAdapter } from '../lib/database/adapter/factory';

async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  const force = args.includes('-f') || args.includes('--force');

  const dbType = getDbType();

  // Check if database exists (SQLite only)
  if (dbType === 'sqlite' && !fs.existsSync(DB_PATH)) {
    console.log('📦 No database found, skipping migrations');
    process.exit(0);
  }

  // Open database and check versions
  const db = dbType === 'sqlite'
    ? await createAdapter({ type: 'sqlite', sqlitePath: DB_PATH })
    : await createAdapter({ type: 'postgres', postgresConnectionString: process.env.POSTGRES_URL });
  const currentDataVersion = await getDataVersion(db);
  const currentSchemaVersion = await getSchemaVersion(db);
  const { dataVersion: targetDataVersion, schemaVersion: targetSchemaVersion } = getTargetVersions();

  console.log(`📊 Current versions: data=${currentDataVersion}, schema=${currentSchemaVersion}`);
  console.log(`📊 Target versions: data=${targetDataVersion}, schema=${targetSchemaVersion}`);

  // Check if migrations are needed
  const needsDataMigration = currentDataVersion < targetDataVersion;
  const needsSchemaRecreation = needsSchemaMigration(currentSchemaVersion);

  if (!needsDataMigration && !needsSchemaRecreation && !force) {
    console.log('✅ Database is up to date');
    await db.close();
    process.exit(0);
  }

  if (force && !needsDataMigration && !needsSchemaRecreation) {
    console.log('🔄 Forcing empty migration (export/import) for data refresh...');
  }

  // Export current data
  console.log('📦 Exporting current database...');
  const exportedData = await exportDatabase(DB_PATH);
  await db.close();

  // Apply data migrations
  console.log('🔄 Applying migrations...');
  const migratedData = applyMigrations(exportedData, currentDataVersion);

  // Show applied migrations
  MIGRATIONS.forEach(m => {
    if (m.dataVersion && m.dataVersion > currentDataVersion && m.dataVersion <= targetDataVersion) {
      console.log(`  ✓ ${m.description} (data v${m.dataVersion})`);
    }
    if (m.schemaVersion && m.schemaVersion > currentSchemaVersion && m.schemaVersion <= targetSchemaVersion) {
      console.log(`  ✓ ${m.description} (schema v${m.schemaVersion})`);
    }
  });

  // Re-import with atomic swap (this recreates DB if schema changed)
  console.log('📥 Re-importing with new schema...');
  await atomicImport(migratedData, DB_PATH);

  // Update version markers
  const newDb = dbType === 'sqlite'
    ? await createAdapter({ type: 'sqlite', sqlitePath: DB_PATH })
    : await createAdapter({ type: 'postgres', postgresConnectionString: process.env.POSTGRES_URL });
  await setDataVersion(targetDataVersion, newDb);
  await setSchemaVersion(targetSchemaVersion, newDb);
  await newDb.close();

  // Success message
  if (force && !needsDataMigration && !needsSchemaRecreation) {
    console.log('✅ Empty migration complete (data exported and re-imported)');
  } else {
    console.log('✅ Migrations complete');
  }
}

main().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
