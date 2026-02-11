import { IDatabaseAdapter, DatabaseConfig } from './types';
import { getDbType } from '../db-config';

let currentAdapter: IDatabaseAdapter | null = null;

/**
 * Create database adapter based on configuration
 * Uses DB_TYPE constant (from environment variable) to determine adapter
 * Falls back to SQLite if not specified
 */
export async function createAdapter(config?: DatabaseConfig): Promise<IDatabaseAdapter> {
  const dbType = config?.type || getDbType();

  if (dbType === 'sqlite') {
    const { SqliteAdapter } = await import('./sqlite-adapter');
    return new SqliteAdapter(config?.sqlitePath);
  } else if (dbType === 'postgres') {
    const { PostgresAdapter } = await import('./postgres-adapter');
    return new PostgresAdapter(config?.postgresConnectionString);
  } else {
    throw new Error(`Unknown database type: ${dbType}`);
  }
}

/**
 * Get or create singleton adapter
 * Used by most application code
 * Respects DB_TYPE environment variable
 */
export async function getAdapter(): Promise<IDatabaseAdapter> {
  if (!currentAdapter) {
    const dbType = getDbType();

    if (dbType === 'sqlite') {
      // Import DB_PATH to ensure we use the mocked value in tests
      const { DB_PATH } = await import('../db-config');
      currentAdapter = await createAdapter({ type: 'sqlite', sqlitePath: DB_PATH });
    } else if (dbType === 'postgres') {
      currentAdapter = await createAdapter({
        type: 'postgres',
        postgresConnectionString: process.env.POSTGRES_URL
      });
    } else {
      throw new Error(`Unknown database type: ${dbType}`);
    }
  }

  if (!currentAdapter) {
    throw new Error('Failed to initialize database adapter');
  }

  return currentAdapter;
}

/**
 * Reset adapter (for testing)
 */
export async function resetAdapter(): Promise<void> {
  if (currentAdapter) {
    await currentAdapter.close();
    currentAdapter = null;
  }
}
