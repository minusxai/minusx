import { exportDatabase, atomicImport } from './import-export';
import { getDataVersion, setDataVersion } from './config-store';
import { applyMigrations, MIGRATIONS, RowMigration } from './migrations';
import { LATEST_DATA_VERSION } from './constants';
import { UserDB } from './user-db';
import { getModules } from '@/lib/modules/registry';
import { sqlArray } from './adapter/types';

const ROW_MIGRATION_BATCH_SIZE = 200;

/**
 * Apply a row migration by scanning only its target file types in keyset-paginated
 * batches and UPDATE-ing changed rows in place. Bounded memory: at most one batch
 * of rows is materialized at a time, so this scales to production-sized files
 * tables where the export-everything path OOMs. Timestamps are left untouched —
 * a migration is not a user edit. Safe to re-run after a crash: migrateContent
 * returns null for already-migrated rows.
 */
export async function runRowMigration(
  migration: RowMigration,
  batchSize: number = ROW_MIGRATION_BATCH_SIZE
): Promise<void> {
  const db = getModules().db;
  let lastId = 0;
  for (;;) {
    const result = await db.exec<{ id: number; type: string; content: unknown }>(
      `SELECT id, type, content FROM files WHERE type = ANY($1) AND id > $2 ORDER BY id LIMIT ${batchSize}`,
      [sqlArray(migration.types), lastId]
    );
    if (result.rows.length === 0) return;
    for (const row of result.rows) {
      const next = migration.migrateContent(row);
      if (next != null) {
        await db.exec('UPDATE files SET content = $1 WHERE id = $2', [next, row.id]);
      }
    }
    lastId = result.rows[result.rows.length - 1].id;
  }
}

/**
 * Run data migrations if the stored version is behind LATEST_DATA_VERSION.
 * Skips when the DB is empty (fresh install — registration will import at the latest version).
 * Safe to call on every server startup: it is a no-op when already up to date.
 *
 * When every pending migration declares a rowMigration, they run row-by-row
 * (bounded memory). Otherwise the whole-DB path runs: export → applyMigrations
 * → atomicImport (required for migrations that rewrite the cross-file graph,
 * e.g. V36's ID remap).
 */
export async function runMigrationsIfNeeded(): Promise<void> {
  const currentVersion = await getDataVersion();

  if (currentVersion >= LATEST_DATA_VERSION) return;

  // Fresh DB: no users means nothing to migrate — registration will handle it.
  const users = await UserDB.listAll();
  if (users.length === 0) return;

  console.log(`🔄 DB at version ${currentVersion}, migrating to ${LATEST_DATA_VERSION}...`);

  const pending = MIGRATIONS.filter(m => m.dataVersion != null && m.dataVersion > currentVersion);
  if (pending.length > 0 && pending.every(m => m.rowMigration)) {
    for (const migration of pending) {
      await runRowMigration(migration.rowMigration!);
      await setDataVersion(migration.dataVersion!);
    }
  } else {
    const data = await exportDatabase();
    const migrated = applyMigrations(data, currentVersion);
    migrated.version = LATEST_DATA_VERSION;
    await atomicImport(migrated);
  }

  console.log(`✅ Migration complete (v${currentVersion} → v${LATEST_DATA_VERSION})`);
}
