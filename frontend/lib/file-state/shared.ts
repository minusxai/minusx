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

/**
 * Deep merge two objects recursively.
 * Arrays and primitives are replaced (not merged).
 */
export function deepMerge<T>(target: T, source: Partial<T>): T {
  const result = { ...target };

  for (const key in source) {
    const sourceValue = source[key];
    const targetValue = result[key];

    if (sourceValue === undefined) continue;

    if (
      targetValue &&
      typeof targetValue === 'object' &&
      !Array.isArray(targetValue) &&
      sourceValue &&
      typeof sourceValue === 'object' &&
      !Array.isArray(sourceValue)
    ) {
      result[key] = deepMerge(targetValue, sourceValue) as any;
    } else {
      result[key] = sourceValue as any;
    }
  }

  return result;
}

/**
 * Generate a line-level unified diff between two strings.
 * Lines that differ are prefixed with `-` (old) or `+` (new).
 */
export function generateDiff(oldStr: string, newStr: string): string {
  const oldLines = oldStr.split('\n');
  const newLines = newStr.split('\n');

  const diffLines: string[] = [];
  const maxLines = Math.max(oldLines.length, newLines.length);

  for (let i = 0; i < maxLines; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];

    if (oldLine !== newLine) {
      if (oldLine !== undefined) {
        diffLines.push(`-${oldLine}`);
      }
      if (newLine !== undefined) {
        diffLines.push(`+${newLine}`);
      }
    }
  }

  return diffLines.join('\n');
}

/**
 * Generic Promise Manager for Deduplication
 *
 * Manages in-flight promises to prevent redundant execution of concurrent requests.
 * When multiple callers request the same operation (identified by key), they share
 * a single promise rather than executing multiple times.
 *
 * Use cases:
 * - File loading: Prevent duplicate API calls for same file ID
 * - Query execution: Prevent duplicate query executions
 * - Any async operation where deduplication is beneficial
 *
 * @example
 * const fileManager = new PromiseManager<FileData>();
 *
 * async function loadFile(id: number) {
 *   return fileManager.execute(`file-${id}`, async () => {
 *     const response = await fetch(`/api/files/${id}`);
 *     return response.json();
 *   });
 * }
 *
 * // Concurrent calls share the same promise
 * const [file1, file2] = await Promise.all([
 *   loadFile(123),  // Executes fetch
 *   loadFile(123)   // Waits for same promise (no duplicate fetch)
 * ]);
 */
export class PromiseManager<T> {
  private promises = new Map<string, Promise<T>>();

  /**
   * Execute function with deduplication.
   * If key already in-flight, return existing promise.
   * Otherwise, execute fn and cache promise.
   *
   * @param key - Unique identifier for this operation (e.g., "file-123", "query-abc")
   * @param fn - Async function to execute if not already in-flight
   * @returns Promise that resolves to result of fn
   */
  async execute(key: string, fn: () => Promise<T>): Promise<T> {
    // Check if promise already in-flight
    if (this.promises.has(key)) {
      return this.promises.get(key)!;
    }

    // Execute and cache promise
    const promise = fn().finally(() => {
      // Auto-cleanup: remove from cache when done
      this.promises.delete(key);
    });

    this.promises.set(key, promise);
    return promise;
  }

  /**
   * Clear all in-flight promises
   * Useful for testing and cleanup
   */
  clear(): void {
    this.promises.clear();
  }

  /**
   * Get count of in-flight promises
   * Useful for debugging
   */
  get size(): number {
    return this.promises.size;
  }

  /**
   * Check if a specific key is in-flight
   * Useful for debugging
   */
  has(key: string): boolean {
    return this.promises.has(key);
  }
}
