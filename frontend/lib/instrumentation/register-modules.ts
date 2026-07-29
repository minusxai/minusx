import { registerModules, getModules } from '@/lib/modules/registry';
import { getDbType, PGLITE_DATA_DIR } from '@/lib/database/db-config';
import { DBModule } from '@/lib/modules/db';
import { AdapterBackedDBModule } from '@/lib/modules/db/adapter-backed';
import { AuthModule } from '@/lib/modules/auth';
import { ObjectStoreModule } from '@/lib/modules/object-store';
import { InMemoryCacheModule } from '@/lib/modules/cache';
import { NamespaceModule } from '@/lib/modules/namespace';
import { logTaggedRejection } from '@/lib/messaging/unhandled-rejection-logger';
import { BOOT_WARM_CHAT } from '@/lib/config';
import type { IAuthModule, IFileSystemDBModule, INamespaceModule, IObjectStoreModule, ICacheModule } from '@/lib/modules/types';

export interface ModuleOverrides {
  auth?: IAuthModule;
  db?: IFileSystemDBModule;
  store?: IObjectStoreModule;
  cache?: ICacheModule;
  namespace?: INamespaceModule;
}

export async function registerWithModules(
  overrides: ModuleOverrides = {},
): Promise<void> {
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

  await runBootTasks();
}

/**
 * Boot side-effects that belong to the app, not to any one deployment.
 *
 * These used to live in instrumentation.ts AFTER a branch that returned early for
 * custom module stacks — so a deployment with its own stack had to re-implement each
 * one verbatim, and silently missed any that were added later. Running them here means
 * registering modules is enough.
 *
 * All are best-effort: none may block or fail boot.
 */
async function runBootTasks(): Promise<void> {
  // Orchestrator-tagged unhandled rejections go to the conversation's errors[] so the
  // failure shows up in chat history. Untagged ones are left to Sentry.
  process.on('unhandledRejection', (reason) => {
    void logTaggedRejection(reason);
  });

  // Warm the heavy chat runtime so the first chat request does not pay the module-load
  // and JIT cost on a cold process. Non-blocking — the server serves immediately.
  if (BOOT_WARM_CHAT !== 'false') {
    void (async () => {
      try {
        const t0 = Date.now();
        // Deliberately dynamic: deferring this import IS the point — it pulls in the
        // orchestrator, every agent/tool and pi-ai, which is the bulk of the cold-start
        // cost we are moving off the first request.
        // eslint-disable-next-line no-restricted-syntax
        await import('@/lib/chat/orchestration-core.server');
        console.log(`[boot-warm] chat runtime warmed in ${Date.now() - t0}ms`);
      } catch (e) {
        console.warn('[boot-warm] chat runtime warm skipped (non-fatal):', e);
      }
    })();
  }
}
