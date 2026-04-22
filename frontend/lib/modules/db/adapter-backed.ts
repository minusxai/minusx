import { getAdapter } from '@/lib/database/adapter/factory';
import { IFileSystemDBModule } from '../types';
import { runMigrationsIfNeeded } from '@/lib/database/run-migrations';

/**
 * Adapter-backed DB Module — wraps the Postgres adapter singleton with the IFileSystemDBModule interface.
 * Uses getAdapter() on every call so it transparently survives adapter resets (e.g. post-migration).
 */
export class AdapterBackedDBModule implements IFileSystemDBModule {
  async exec<T = unknown>(sql: string, params?: unknown[]) {
    const adapter = await getAdapter();
    return adapter.query<T>(sql, params as any[]);
  }

  async init(): Promise<void> {
    const adapter = await getAdapter();
    await adapter.initializeSchema?.();
  }

  async runMigrations(): Promise<void> {
    await runMigrationsIfNeeded();
  }

  async close(): Promise<void> {
    const adapter = await getAdapter();
    await adapter.close();
  }
}
