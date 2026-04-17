import 'server-only';
import * as fs from 'fs';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';

export type DuckDbAccessMode = 'READ_WRITE' | 'READ_ONLY';

// Keyed by absolute resolved file path — one instance per file, process-wide.
// This prevents two DuckDBInstances from opening the same file (exclusive lock conflict).
// eslint-disable-next-line no-restricted-syntax -- server-only; keyed by absolute file path (unique per company by directory layout)
const registry = new Map<string, DuckDBInstance>();
// eslint-disable-next-line no-restricted-syntax -- server-only; keyed by absolute file path (unique per company by directory layout)
const initPromises = new Map<string, Promise<DuckDBInstance>>();

async function applySecuritySettings(instance: DuckDBInstance, absPath: string): Promise<void> {
  // enable_external_access is instance-level — set once at creation, persists across connections.
  // allowed_paths must be set BEFORE disabling external access.
  const conn = await instance.connect();
  try {
    await conn.run(`SET allowed_paths = ['${absPath.replace(/'/g, "''")}']`);
    await conn.run('SET enable_external_access = false');
  } finally {
    conn.closeSync();
  }
}

async function createInstance(absPath: string, accessMode: DuckDbAccessMode): Promise<DuckDBInstance> {
  try {
    const instance = await DuckDBInstance.create(absPath, { access_mode: accessMode });
    await applySecuritySettings(instance, absPath);
    return instance;
  } catch (err: any) {
    // DuckDB WAL replay failures leave the DB unopenable. The WAL only contains
    // schema migrations (ALTER TABLE ADD COLUMN) that will be re-applied on next
    // initSchema run, so deleting it is safe — at worst a few analytics events
    // from the last uncheckpointed session are lost.
    const isWalError = err?.message?.includes('.wal') || err?.message?.includes('replaying WAL');
    const walPath = `${absPath}.wal`;
    if (isWalError && fs.existsSync(walPath)) {
      console.warn(`[duckdb-registry] Corrupt WAL detected for ${absPath}, deleting and retrying`, err.message);
      fs.unlinkSync(walPath);
      const instance = await DuckDBInstance.create(absPath, { access_mode: accessMode });
      await applySecuritySettings(instance, absPath);
      return instance;
    }
    throw err;
  }
}

export async function getOrCreateDuckDbInstance(
  absPath: string,
  accessMode: DuckDbAccessMode = 'READ_WRITE'
): Promise<DuckDBInstance> {
  if (registry.has(absPath)) return registry.get(absPath)!;
  if (initPromises.has(absPath)) return initPromises.get(absPath)!;

  const p = createInstance(absPath, accessMode).then(instance => {
    registry.set(absPath, instance);
    initPromises.delete(absPath);
    return instance;
  }).catch(err => {
    // Remove the failed promise so the next call retries from scratch
    initPromises.delete(absPath);
    throw err;
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
