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
   * Useful for debugging and testing
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
