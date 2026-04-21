import { exportDatabase, atomicImport } from './import-export';
import { getDataVersion } from './config-db';
import { applyMigrations } from './migrations';
import { LATEST_DATA_VERSION } from './constants';
import { UserDB } from './user-db';

/**
 * Run data migrations if the stored version is behind LATEST_DATA_VERSION.
 * Skips when the DB is empty (fresh install — registration will import at the latest version).
 * Safe to call on every server startup: it is a no-op when already up to date.
 */
export async function runMigrationsIfNeeded(): Promise<void> {
  const currentVersion = await getDataVersion();

  if (currentVersion >= LATEST_DATA_VERSION) return;

  // Fresh DB: no users means nothing to migrate — registration will handle it.
  const users = await UserDB.listAll();
  if (users.length === 0) return;

  console.log(`🔄 DB at version ${currentVersion}, migrating to ${LATEST_DATA_VERSION}...`);

  const data = await exportDatabase();
  const migrated = applyMigrations(data, currentVersion);
  migrated.version = LATEST_DATA_VERSION;
  await atomicImport(migrated);

  console.log(`✅ Migration complete (v${currentVersion} → v${LATEST_DATA_VERSION})`);
}
