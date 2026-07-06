/**
 * Tiny helpers shared across the file-state split (lib/file-state/*.ts) that
 * are NOT stateful singletons — safe to import from multiple sibling modules.
 *
 * Stateful singletons (filePromises, criteriaInflight, queryPromiseManager,
 * querySemaphore) intentionally stay colocated with their sole consumer file
 * instead of living here, so there is exactly one instance of each.
 */

// djb2-style hash used for deterministic edit IDs and path placeholder keys
export function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}
