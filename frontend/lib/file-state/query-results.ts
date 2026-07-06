/**
 * getQueryResult - Execute query with TTL caching, promise deduplication, and a
 * concurrency-capped semaphore.
 *
 * Split out of file-state.ts (query-execution concern). Consumed by file-read.ts
 * (readFiles auto-execute) and file-edit.ts (replaceFileState auto-execute), and
 * directly by many UI containers / tools via the file-state.ts barrel.
 */

import { getStore } from '@/store/store';
import { selectQueryResult, setQueryResult, setQueryError, selectIsQueryFresh, setQueryLoading } from '@/store/queryResultsSlice';
import { runOrDefer } from '@/lib/navigation/nav-progress';
import { selectMaxConcurrentQueries, selectQueryTimeoutMs } from '@/store/configsSlice';
import { Semaphore } from '@/lib/utils/semaphore';
import { CACHE_TTL } from '@/lib/constants/cache';
import { captureError } from '@/lib/messaging/capture-error';
import { getQueryHash } from '@/lib/utils/query-hash';
import { decodeJsonl } from '@/lib/query-cache/jsonl';
import type { QueryResult } from '@/lib/types';
import type {
  QueryExecutionParams,
  GetQueryResultOptions,
} from '@/lib/file-state/file-state-interface';
import { PromiseManager } from '@/lib/file-state/shared';

// ============================================================================
// Get Query Result
// ============================================================================

/**
 * Global promise manager for in-flight queries
 * Prevents duplicate concurrent queries
 */
const queryPromiseManager = new PromiseManager<QueryResult>();

// Caps concurrent /api/query calls across the tab. Limit is read from the
// store on each acquire (hydrated from the MAX_CONCURRENT_QUERIES runtime env),
// defaulting to 10 if configs aren't loaded yet or the store shape is partial.
const DEFAULT_MAX_CONCURRENT_QUERIES = 10;
const querySemaphore = new Semaphore(() => {
  try {
    return selectMaxConcurrentQueries(getStore().getState()) ?? DEFAULT_MAX_CONCURRENT_QUERIES;
  } catch {
    return DEFAULT_MAX_CONCURRENT_QUERIES;
  }
});

// Wall-clock cap (ms) for a single /api/query fetch, from the runtime QUERY_TIMEOUT_MS
// env (hydrated into configsSlice). Bounds hung queries so a stuck embed can't freeze
// the chat run — or hold a querySemaphore slot — forever. 0 disables the cap.
const DEFAULT_QUERY_TIMEOUT_MS = 120_000;
function getQueryTimeoutMs(): number {
  try {
    const v = selectQueryTimeoutMs(getStore().getState());
    return typeof v === 'number' ? v : DEFAULT_QUERY_TIMEOUT_MS;
  } catch {
    return DEFAULT_QUERY_TIMEOUT_MS;
  }
}

/**
 * getQueryResult - Execute query with TTL caching and promise deduplication
 *
 * Behavior:
 * 1. Check Redux cache - return immediately if fresh (within TTL)
 * 2. Check promise store - return existing promise if already running
 * 3. Execute query - store promise, update Redux on completion
 * 4. Cleanup - remove from promise store when done
 *
 * Features:
 * - TTL-based caching (default: 10 hours)
 * - Promise deduplication (same query = same promise)
 * - Redux cache integration
 * - Automatic loading state management
 *
 * @param params - Query execution parameters (query, params, database)
 * @param options - Options (ttl, skip)
 * @returns Promise<QueryResult>
 *
 * Example:
 * ```typescript
 * const result = await getQueryResult({
 *   query: 'SELECT * FROM users WHERE id = :userId',
 *   params: { userId: 123 },
 *   database: 'default_db'
 * });
 * console.log(result.rows); // Query results
 * ```
 */
export async function getQueryResult(
  params: QueryExecutionParams,
  options: GetQueryResultOptions = {}
): Promise<QueryResult> {
  const { query, params: queryParams, database, references, parameterTypes, filePath, fileId, fileVersion, cachePolicy } = params;
  const { ttl = CACHE_TTL.QUERY, skip = false, forceLoad = false } = options;

  if (skip) {
    throw new Error('Cannot execute query with skip=true');
  }

  const state = getStore().getState();

  // Import query utilities

  const queryId = getQueryHash(query, queryParams, database);

  // Step 1: Check Redux cache first (with TTL check)
  const isFresh = selectIsQueryFresh(state, query, queryParams, database, ttl);
  const cached = selectQueryResult(state, query, queryParams, database);

  if (isFresh && !forceLoad) {
    if (cached?.data) return Promise.resolve(cached.data);
    // Cached error within TTL — re-throw without re-fetching to prevent retry loop
    if (cached?.error) throw new Error(cached.error);
  }

  // Step 2: Execute with deduplication via PromiseManager
  return queryPromiseManager.execute(queryId, async () => {
    // Import Redux actions

    // Set loading state immediately — before acquiring a semaphore slot — so
    // cards queued behind the in-flight cap still show "loading", not stale.
    getStore().dispatch(setQueryLoading({ query, params: queryParams, database, loading: true }));

    // Cap concurrent /api/query calls so a dashboard's parallel card queries
    // don't overwhelm the server. Limit is the runtime-configured value.
    return querySemaphore.run(async () => {
    // undefined if fetch() itself rejected (network failure); set otherwise.
    let responseStatus: number | undefined;
    // Bound the fetch: an internal timeout controller plus the caller's optional signal
    // (e.g. the conversation's Stop). Whichever aborts first cancels the request — so a
    // stuck query surfaces as an error and frees its semaphore slot instead of hanging.
    const controller = new AbortController();
    const timeoutMs = getQueryTimeoutMs();
    let timedOut = false;
    const timer = timeoutMs > 0
      ? setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs)
      : undefined;
    const external = options.signal;
    const onExternalAbort = () => controller.abort();
    if (external) {
      if (external.aborted) controller.abort();
      else external.addEventListener('abort', onExternalAbort, { once: true });
    }
    try {
      const response = await fetch('/api/query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          connection_name: database,
          parameters: queryParams,
          references: references || [],
          ...(parameterTypes && { parameterTypes }),
          ...(filePath && { filePath }),
          ...(fileId !== undefined && { fileId }),
          ...(fileVersion !== undefined && { fileVersion }),
          ...(cachePolicy && { cachePolicy }),
          // "Run query" / retry (forceLoad) forces a fresh server execution + cache refresh.
          ...(forceLoad && { forceRefresh: true })
        }),
        signal: controller.signal,
      });
      responseStatus = response.status;

      if (!response.ok) {
        const errorData = await response.json();
        // API returns { success: false, error: { code, message, details } }
        const errorMessage = errorData.error?.message || errorData.error || `Query execution failed: ${response.statusText}`;
        throw new Error(errorMessage);
      }

      // /api/query streams a JSONL body (header line + one row per line). Decode
      // it into the QueryResult shape (columns/types/rows/finalQuery). cachedAt
      // rides in the X-Cached-At header.
      const body = await response.text();
      const decoded = decodeJsonl(body);
      const cachedAtHeader = response.headers.get('X-Cached-At');
      const result: QueryResult & { cachedAt?: number } = {
        ...decoded,
        ...(cachedAtHeader ? { cachedAt: Number(cachedAtHeader) } : {}),
      };

      // Update Redux cache with result (clears loading state). Deferred while a
      // navigation is in flight — these urgent updates otherwise preempt and
      // restart the router transition (clicking a dashboard tile while its
      // queries stream results felt dead until the dashboard settled).
      runOrDefer(() => getStore().dispatch(setQueryResult({
        query,
        params: queryParams,
        database,
        data: result
      })));

      return result;
    } catch (error) {
      // An aborted fetch throws a generic AbortError — translate it into a meaningful
      // message so the UI/agent see "timed out" vs "cancelled", not a cryptic DOMException.
      const aborted = controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError');
      const normalized = aborted
        ? new Error(timedOut ? `Query timed out after ${Math.round(timeoutMs / 1000)}s` : 'Query cancelled')
        : error;
      console.error('[getQueryResult] Query execution failed:', normalized);

      // Store error in Redux (deferred during navigation — see setQueryResult above)
      const errorMessage = normalized instanceof Error ? normalized.message : 'Unknown error';
      runOrDefer(() => getStore().dispatch(setQueryError({
        query,
        params: queryParams,
        database,
        error: errorMessage
      })));

      // Report network/5xx failures + timeouts (invisible server-side); skip 4xx SQL errors
      // and user cancellations (not real failures).
      if (!(aborted && !timedOut) && (responseStatus === undefined || responseStatus >= 500)) {
        void captureError('query:network', normalized, {
          connection: database,
          status: responseStatus,
          ...(timedOut ? { timedOut: true } : {}),
          ...(fileId !== undefined && { fileId }),
          ...(filePath && { filePath }),
        });
      }

      throw normalized;
    } finally {
      if (timer) clearTimeout(timer);
      external?.removeEventListener('abort', onExternalAbort);
    }
    });
  });
}
