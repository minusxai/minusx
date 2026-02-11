#!/usr/bin/env tsx
/**
 * Utility to create an empty valid database file with schema
 * Can be used standalone or imported by other modules
 *
 * Usage:
 *   npm run create-empty-db
 *   OR import { createEmptyDatabase } from './scripts/create-empty-db'
 */
import fs from 'fs';
import path from 'path';
import { DB_PATH, DB_DIR, getDbType } from '../lib/database/db-config';
import { createAdapter } from '../lib/database/adapter/factory';
import { setDataVersion, setSchemaVersion } from '../lib/database/config-db';
import { LATEST_DATA_VERSION, LATEST_SCHEMA_VERSION } from '../lib/database/constants';

export async function createEmptyDatabase(dbPath: string = DB_PATH) {
  const dbType = getDbType();

  if (dbType === 'sqlite') {
    // Ensure directory exists for SQLite file-based database
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
  }

  // Create database adapter (respects DB_TYPE from environment)
  const db = dbType === 'sqlite'
    ? await createAdapter({ type: 'sqlite', sqlitePath: dbPath })
    : await createAdapter({ type: 'postgres', postgresConnectionString: process.env.POSTGRES_URL });

  // Initialize database-specific schema (includes tables, indexes, triggers)
  await db.initializeSchema();

  // Initialize version fields
  await setDataVersion(LATEST_DATA_VERSION, db);
  await setSchemaVersion(LATEST_SCHEMA_VERSION, db);

  await db.close();

  const location = dbType === 'sqlite' ? dbPath : process.env.POSTGRES_URL;
  console.log(`✅ Created empty database at ${location}`);
}

// Allow running as script
if (require.main === module) {
  createEmptyDatabase();
}
