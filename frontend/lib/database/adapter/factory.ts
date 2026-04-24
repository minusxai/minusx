import { IDatabaseAdapter, DatabaseConfig } from './types';
import { getDbType } from '../db-config';
import { POSTGRES_URL } from '@/lib/config';

let currentAdapter: IDatabaseAdapter | null = null;

export async function createAdapter(config?: DatabaseConfig): Promise<IDatabaseAdapter> {
  const dbType = config?.type || getDbType();

  if (dbType === 'postgres') {
    // eslint-disable-next-line no-restricted-syntax
    const { PostgresAdapter } = await import('./postgres-adapter');
    return new PostgresAdapter(config?.postgresConnectionString);
  } else if (dbType === 'pglite') {
    // eslint-disable-next-line no-restricted-syntax
    const { PgliteAdapter } = await import('./pglite-adapter');
    const adapter = new PgliteAdapter(config?.pgDataDir);
    await adapter.initializeSchema();
    return adapter;
  } else {
    throw new Error(`Unknown database type: ${dbType}`);
  }
}

export async function getAdapter(): Promise<IDatabaseAdapter> {
  if (!currentAdapter) {
    const dbType = getDbType();

    if (dbType === 'postgres') {
      currentAdapter = await createAdapter({
        type: 'postgres',
        postgresConnectionString: POSTGRES_URL
      });
    } else if (dbType === 'pglite') {
      // eslint-disable-next-line no-restricted-syntax
      const { PGLITE_DATA_DIR } = await import('../db-config');
      currentAdapter = await createAdapter({ type: 'pglite', pgDataDir: PGLITE_DATA_DIR });
    } else {
      throw new Error(`Unknown database type: ${dbType}`);
    }
  }

  if (!currentAdapter) {
    throw new Error('Failed to initialize database adapter');
  }

  return currentAdapter;
}

export async function resetAdapter(): Promise<void> {
  if (currentAdapter) {
    await currentAdapter.close();
    currentAdapter = null;
  }
}
