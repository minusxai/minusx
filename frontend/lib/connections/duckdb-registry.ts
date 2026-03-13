import 'server-only';
import { DuckDBInstance } from '@duckdb/node-api';

// Keyed by absolute resolved file path — one instance per file, process-wide.
// This prevents two DuckDBInstances from opening the same file (exclusive lock conflict).
const registry = new Map<string, DuckDBInstance>();
const initPromises = new Map<string, Promise<DuckDBInstance>>();

export async function getOrCreateDuckDbInstance(absPath: string): Promise<DuckDBInstance> {
  if (registry.has(absPath)) return registry.get(absPath)!;
  if (initPromises.has(absPath)) return initPromises.get(absPath)!;

  const p = DuckDBInstance.create(absPath).then(instance => {
    registry.set(absPath, instance);
    initPromises.delete(absPath);
    return instance;
  });
  initPromises.set(absPath, p);
  return p;
}
