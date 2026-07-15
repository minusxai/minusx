import { getAdapter, resetAdapter } from '@/lib/database/adapter/factory';
import { IFileSystemDBModule } from '../types';
import { ITransactionContext, QueryResult } from '@/lib/database/adapter/types';
import { runWithAccess } from '@/lib/database/with-access';
import { runMigrationsIfNeeded } from '@/lib/database/run-migrations';

/**
 * PGLite-backed File System DB module.
 * Uses the shared adapter singleton from factory.ts so all code paths
 * (importToDatabase, UserDB, DocumentDB, etc.) read/write the same PGLite instance.
 */
export class DBModule implements IFileSystemDBModule {
  constructor(_dataDir?: string) {}

  async exec<T = unknown>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
    const adapter = await getAdapter();
    // Multi-statement DDL (no params + semicolons): use exec() which handles multiple commands.
    // Single statements and parameterized queries use query() for prepared-statement safety.
    if ((!params || params.length === 0) && sql.includes(';')) {
      await adapter.exec(sql);
      return { rows: [], rowCount: 0 } as QueryResult<T>;
    }
    return adapter.query<T>(sql, params as any[] | undefined);
  }

  async withAccess<T>(accessContextJson: string, fn: (tx: ITransactionContext) => Promise<T>): Promise<T> {
    const adapter = await getAdapter();
    return runWithAccess(adapter, accessContextJson, fn);
  }

  async init(): Promise<void> {
    await getAdapter();
  }

  async runMigrations(): Promise<void> {
    await runMigrationsIfNeeded();
  }

  async close(): Promise<void> {
    const adapter = await getAdapter();
    await adapter.close();
  }

  async reset(): Promise<void> {
    await resetAdapter();
  }

  async notify(channel: string, payload: string): Promise<void> {
    const adapter = await getAdapter();
    await adapter.notify(channel, payload);
  }

  async listen(channel: string, onNotify: (payload: string) => void): Promise<() => Promise<void>> {
    const adapter = await getAdapter();
    return adapter.listen(channel, onNotify);
  }
}
