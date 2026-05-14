/**
 * Process-lifetime handle store for V2 query results.
 * Handles are unique IDs referencing QueryResult data stored outside
 * the conversation context.
 */

import type { QueryResult } from '@/lib/connections/base';

export interface StoredHandle {
  id: string;
  result: QueryResult;
  createdAt: number;
}

// Process-wide Map<handleId, StoredHandle>
// Benchmark-only: handles are intentionally process-lifetime singletons,
// scoped to a single benchmark run. Each run starts fresh (clearHandles).
// eslint-disable-next-line no-restricted-syntax -- benchmark-only process singleton
const handleStore = new Map<string, StoredHandle>();

let handleCounter = 0;

/**
 * Generate a unique handle ID.
 */
export function generateHandleId(): string {
  handleCounter++;
  return `handle_${handleCounter}_${Date.now().toString(36)}`;
}

/**
 * Store a query result and return its handle ID.
 */
export function storeHandle(result: QueryResult): string {
  const id = generateHandleId();
  handleStore.set(id, {
    id,
    result,
    createdAt: Date.now(),
  });
  return id;
}

/**
 * Retrieve a stored handle by ID.
 */
export function getHandle(id: string): StoredHandle | undefined {
  return handleStore.get(id);
}

/**
 * Check if a handle exists.
 */
export function hasHandle(id: string): boolean {
  return handleStore.has(id);
}

/**
 * Get all stored handles.
 */
export function getAllHandles(): Map<string, StoredHandle> {
  return new Map(handleStore);
}

/**
 * Clear all handles (for testing).
 */
export function clearHandles(): void {
  handleStore.clear();
  handleCounter = 0;
}

/**
 * Get the number of stored handles.
 */
export function handleCount(): number {
  return handleStore.size;
}
