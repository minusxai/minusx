import { IDatabaseAdapter, DatabaseConfig } from './types';
import { getDbType } from '../db-config';
import { POSTGRES_URL } from '@/lib/config';

/**
 * The database adapter (and its single PGLite instance / Postgres Pool) is cached
 * on `global` — NOT a module-level variable — for two reasons:
 *
 * 1. Turbopack evaluates this module in separate bundles (instrumentation vs
 *    request handlers). A per-bundle `let` singleton would create MULTIPLE PGLite
 *    instances pointing at the SAME data directory, which corrupts PGLite's wire
 *    protocol (Postgres error 08P01 "invalid message format"). `global` is shared
 *    across bundles in a process, so there is exactly one instance.
 * 2. We cache the in-flight Promise (not just the resolved adapter) so a burst of
 *    concurrent first-callers (e.g. the parallel API requests on a page load) all
 *    await the SAME creation instead of each racing to create their own instance.
 *
 * (The Postgres adapter is internally concurrency-safe via its connection Pool —
 * this singleton just avoids spawning redundant Pools. PGLite is the one that
 * MUST be a single instance.)
 */
declare global {
   
  var __minusx_db_adapter__: Promise<IDatabaseAdapter> | undefined;
}

async function createAdapter(config?: DatabaseConfig): Promise<IDatabaseAdapter> {
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

export function getAdapter(): Promise<IDatabaseAdapter> {
  if (!global.__minusx_db_adapter__) {
    const dbType = getDbType();
    const promise = (async (): Promise<IDatabaseAdapter> => {
      if (dbType === 'pglite') {
        // eslint-disable-next-line no-restricted-syntax
        const { PGLITE_DATA_DIR } = await import('../db-config');
        return createAdapter({ type: 'pglite', pgDataDir: PGLITE_DATA_DIR });
      }
      return createAdapter({ type: 'postgres', postgresConnectionString: POSTGRES_URL });
    })();

    // If creation fails, drop the cached rejected promise so the next call retries
    // from scratch instead of permanently serving the failure.
    promise.catch(() => {
      if (global.__minusx_db_adapter__ === promise) global.__minusx_db_adapter__ = undefined;
    });

    global.__minusx_db_adapter__ = promise;
  }
  return global.__minusx_db_adapter__;
}

export async function resetAdapter(): Promise<void> {
  const promise = global.__minusx_db_adapter__;
  global.__minusx_db_adapter__ = undefined;
  if (promise) {
    try {
      await (await promise).close();
    } catch {
      /* ignore — adapter may already be closed */
    }
  }
}
