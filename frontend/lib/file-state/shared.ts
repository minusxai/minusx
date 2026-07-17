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
 * Myers O(ND) shortest-edit-script over line arrays. Returns the changed lines as `-`/`+`
 * entries (deletions before additions per hunk). `maxD` bounds pathological inputs: past it,
 * the remainder is emitted as a full delete+add block (a true rewrite at that point anyway).
 */
function myersDiffLines(a: string[], b: string[], maxD = 2000): string[] {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, maxD);
  const offset = max;
  // V[k+offset] = furthest x on diagonal k after d steps; trace keeps a snapshot per d for backtracking.
  let v = new Array<number>(2 * max + 2).fill(0);
  const trace: number[][] = [];

  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice());
    const next = v.slice();
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[k - 1 + offset] < v[k + 1 + offset])) {
        x = v[k + 1 + offset]; // down: insertion from b
      } else {
        x = v[k - 1 + offset] + 1; // right: deletion from a
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      next[k + offset] = x;
      if (x >= n && y >= m) { found = d; }
    }
    v = next;
  }

  if (found < 0) {
    // Edit distance exceeds the cap — effectively a rewrite; emit everything.
    return [...a.map((l) => `-${l}`), ...b.map((l) => `+${l}`)];
  }

  // Backtrack from (n, m) through the D-path snapshots, collecting per-hunk -/+ lines.
  const out: string[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const prev = trace[d];
    const k = x - y;
    const down = k === -d || (k !== d && prev[k - 1 + offset] < prev[k + 1 + offset]);
    const prevK = down ? k + 1 : k - 1;
    const prevX = prev[prevK + offset];
    const prevY = prevX - prevK;
    // Walk back through the trailing snake (matched lines) of this step.
    while (x > (down ? prevX : prevX + 1) && y > (down ? prevY + 1 : prevY)) { x--; y--; }
    if (down) { y--; out.push(`+${b[y]}`); }
    else { x--; out.push(`-${a[x]}`); }
  }
  out.reverse();

  // Group each run of consecutive changes as deletions-then-additions (stable display order).
  const grouped: string[] = [];
  let hunkDels: string[] = [];
  let hunkAdds: string[] = [];
  const flush = () => { grouped.push(...hunkDels, ...hunkAdds); hunkDels = []; hunkAdds = []; };
  for (const line of out) {
    if (line.startsWith('-')) {
      if (hunkAdds.length > 0) flush(); // an addition run ended — new hunk
      hunkDels.push(line);
    } else {
      hunkAdds.push(line);
    }
  }
  flush();
  return grouped;
}

/**
 * Generate a line-level diff between two strings: only changed lines, prefixed `-` (old) /
 * `+` (new), deletions before additions per hunk — no context lines, no headers.
 *
 * Lines are ALIGNED (Myers shortest edit script), not compared positionally: inserting or
 * deleting one line yields a one-line diff, not the whole remainder of the file. This matters
 * beyond cosmetics — the diff is echoed to the LLM as its anchor for future oldMatch strings
 * and stored per edit in the conversation log, so a positional cascade turned one-line story
 * edits into 100KB+ payloads that compounded every turn (see generate-diff.test.ts).
 */
export function generateDiff(oldStr: string, newStr: string): string {
  if (oldStr === newStr) return '';
  const oldLines = oldStr.split('\n');
  const newLines = newStr.split('\n');

  // Trim the common prefix/suffix first — edits are localized, so Myers runs on a small middle.
  let start = 0;
  const maxStart = Math.min(oldLines.length, newLines.length);
  while (start < maxStart && oldLines[start] === newLines[start]) start++;
  let endOld = oldLines.length;
  let endNew = newLines.length;
  while (endOld > start && endNew > start && oldLines[endOld - 1] === newLines[endNew - 1]) { endOld--; endNew--; }

  return myersDiffLines(oldLines.slice(start, endOld), newLines.slice(start, endNew)).join('\n');
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
