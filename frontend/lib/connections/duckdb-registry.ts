import 'server-only';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';

export type DuckDbAccessMode = 'READ_WRITE' | 'READ_ONLY';

// Keyed by absolute resolved file path — one instance per file, process-wide.
// This prevents two DuckDBInstances from opening the same file (exclusive lock conflict).
const registry = new Map<string, DuckDBInstance>();
const initPromises = new Map<string, Promise<DuckDBInstance>>();

// Per-instance mutex: the @duckdb/node-api native bindings segfault when
// concurrent libuv worker threads run queries on the same instance
// (BitpackingScanState crash on ARM64 macOS). Serialize all access per file.
const locks = new Map<string, Promise<void>>();

export async function getOrCreateDuckDbInstance(
  absPath: string,
  accessMode: DuckDbAccessMode = 'READ_WRITE'
): Promise<DuckDBInstance> {
  if (registry.has(absPath)) return registry.get(absPath)!;
  if (initPromises.has(absPath)) return initPromises.get(absPath)!;

  const p = DuckDBInstance.create(absPath, { access_mode: accessMode, threads: '1' }).then(instance => {
    registry.set(absPath, instance);
    initPromises.delete(absPath);
    return instance;
  });
  initPromises.set(absPath, p);
  return p;
}

/**
 * Run a callback with a serialized DuckDB connection.
 * All operations on the same file are queued to prevent concurrent native
 * thread access that causes segfaults in the @duckdb/node-api bindings.
 */
export async function withDuckDbConnection<T>(
  absPath: string,
  accessMode: DuckDbAccessMode,
  fn: (conn: DuckDBConnection) => Promise<T>
): Promise<T> {
  const prev = locks.get(absPath) ?? Promise.resolve();
  let release: () => void;
  const next = new Promise<void>(resolve => { release = resolve; });
  locks.set(absPath, next);

  await prev;

  const instance = await getOrCreateDuckDbInstance(absPath, accessMode);
  const conn = await instance.connect();
  try {
    return await fn(conn);
  } finally {
    conn.closeSync();
    release!();
  }
}
