import { registerModules, getModules } from '@/lib/modules/registry';
import { getDbType, PGLITE_DATA_DIR } from '@/lib/database/db-config';
import { DBModule } from '@/lib/modules/db';
import { AdapterBackedDBModule } from '@/lib/modules/db/adapter-backed';
import { AuthModule } from '@/lib/modules/auth';
import { ObjectStoreModule } from '@/lib/modules/object-store';
import { InMemoryCacheModule } from '@/lib/modules/cache';
import { NamespaceModule } from '@/lib/modules/namespace';
import type { IAuthModule, IFileSystemDBModule, INamespaceModule, IObjectStoreModule, ICacheModule } from '@/lib/modules/types';

export interface ModuleOverrides {
  auth?: IAuthModule;
  db?: IFileSystemDBModule;
  store?: IObjectStoreModule;
  cache?: ICacheModule;
  namespace?: INamespaceModule;
}

export async function registerWithModules(overrides: ModuleOverrides = {}): Promise<void> {
  let db = overrides.db;

  if (!db) {
    const dbType = getDbType();
    if (dbType === 'pglite') {
      db = new DBModule(PGLITE_DATA_DIR);
    } else {
      db = new AdapterBackedDBModule();
    }
  }

  registerModules({
    auth: overrides.auth ?? new AuthModule(),
    db,
    store: overrides.store ?? new ObjectStoreModule(),
    cache: overrides.cache ?? new InMemoryCacheModule(),
    namespace: overrides.namespace ?? new NamespaceModule(),
  });

  await getModules().db.init();
  await getModules().db.runMigrations?.();
}
