import 'server-only';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';

export type DuckDbAccessMode = 'READ_WRITE' | 'READ_ONLY';

// Keyed by absolute resolved file path — one instance per file, process-wide.
// This prevents two DuckDBInstances from opening the same file (exclusive lock conflict).
const registry = new Map<string, DuckDBInstance>();
const initPromises = new Map<string, Promise<DuckDBInstance>>();

export async function getOrCreateDuckDbInstance(
  absPath: string,
  accessMode: DuckDbAccessMode = 'READ_WRITE'
): Promise<DuckDBInstance> {
  if (registry.has(absPath)) return registry.get(absPath)!;
  if (initPromises.has(absPath)) return initPromises.get(absPath)!;

  const p = DuckDBInstance.create(absPath, { access_mode: accessMode }).then(instance => {
    registry.set(absPath, instance);
    initPromises.delete(absPath);
    return instance;
  });
  initPromises.set(absPath, p);
  return p;
}

/**
 * Run a callback with a short-lived DuckDB connection.
 * Handles connect + closeSync automatically.
 */
export async function withDuckDbConnection<T>(
  absPath: string,
  accessMode: DuckDbAccessMode,
  fn: (conn: DuckDBConnection) => Promise<T>
): Promise<T> {
  const instance = await getOrCreateDuckDbInstance(absPath, accessMode);
  const conn = await instance.connect();
  try {
    return await fn(conn);
  } finally {
    conn.closeSync();
  }
}
