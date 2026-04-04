import type { QuestionReference, QuestionContent, QueryResult } from '@/lib/types';
import { successResponse, ApiErrors, handleApiError } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';
import { NextRequest } from 'next/server';
import { CTEfyQuery, ResolvedReference } from '@/lib/sql/query-composer';
import { FilesAPI } from '@/lib/data/files.server';
import { runQuery } from '@/lib/connections/run-query';
import { removeNoneParamConditions } from '@/lib/sql/ir-transforms';
import { pythonBackendFetch } from '@/lib/api/python-backend-client';
import { getQueryHash } from '@/lib/utils/query-hash';
import { appEventRegistry, AppEvents } from '@/lib/app-event-registry';

/**
 * Transform a query+params pair so that None (null) parameter values are handled:
 * 1. Try to remove filter conditions (WHERE/HAVING) for None params via IR round-trip.
 * 2. Substitute any remaining :param_name occurrences with NULL.
 * 3. Strip None params from the returned params dict.
 */
async function applyNoneParams(
  query: string,
  params: Record<string, string | number | null>
): Promise<{ sql: string; params: Record<string, string | number> }> {
  const noneSet = new Set(Object.keys(params).filter((k) => params[k] === null || params[k] === ''));
  const effectiveParams = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== null)
  ) as Record<string, string | number>;

  if (noneSet.size === 0) return { sql: query, params: effectiveParams };

  // Try IR-based filter removal via Python backend
  try {
    const irRes = await pythonBackendFetch('/api/sql-to-ir', {
      method: 'POST',
      body: JSON.stringify({ sql: query }),
    });
    if (irRes.ok) {
      const irData = await irRes.json();
      if (irData.success && irData.ir) {
        const transformed = removeNoneParamConditions(irData.ir, noneSet);
        const sqlRes = await pythonBackendFetch('/api/ir-to-sql', {
          method: 'POST',
          body: JSON.stringify({ ir: transformed }),
        });
        if (sqlRes.ok) {
          const sqlData = await sqlRes.json();
          if (sqlData.success && sqlData.sql) {
            query = sqlData.sql;
          }
        }
      }
    }
  } catch { /* fall through to NULL substitution */ }

  // Substitute any remaining :param_name references with NULL (non-filter uses, fallback)
  for (const p of noneSet) {
    query = query.replace(new RegExp(`:${p}\\b`, 'g'), 'NULL');
  }
  return { sql: query, params: effectiveParams };
}

// ---- Server-side query result cache (shared across sessions per process) ----
const QUERY_CACHE_TTL_MS = 60_000; // 60 seconds, hardcoded

interface CacheEntry { result: QueryResult; cachedAt: number; }
// eslint-disable-next-line no-restricted-syntax -- tenant-isolated: keys are `${companyId}:${mode}:${queryHash}`
const queryCache = new Map<string, CacheEntry>();
// eslint-disable-next-line no-restricted-syntax -- tenant-isolated: keys are `${companyId}:${mode}:${queryHash}`
const queryInflight = new Map<string, Promise<QueryResult>>();

// Evict stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [k, e] of queryCache) {
    if (now - e.cachedAt > QUERY_CACHE_TTL_MS) queryCache.delete(k);
  }
}, 5 * 60 * 1000);

// Route segment config: optimize for API routes
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = withAuth(async (request: NextRequest, user) => {
  const startTime = Date.now();
  console.log('[QUERY API] Start POST /api/query');
  try {
    const parseStart = Date.now();
    const body = await request.json();
    console.log(`[QUERY API] JSON parse took ${Date.now() - parseStart}ms`);
    const { database_name, query, parameters, references, parameterTypes } = body;

    // Convert parameters to Record<string, string | number | null> for backend
    // Handle both array format (QuestionParameter[]) and object format (Record<string, any>)
    // null values represent "None" — the param is explicitly skipped
    const paramValues: Record<string, string | number | null> = {};
    if (Array.isArray(parameters)) {
      // Array format: legacy, no-op (parameters are now just schema definitions)
    } else if (typeof parameters === 'object' && parameters !== null) {
      // Object format: {param1: 'val1', param2: null, ...}
      Object.assign(paramValues, parameters);
    }

    // Compute hash on raw inputs (matches client-side Redux hash key)
    const queryHash = getQueryHash(query, paramValues, database_name);
    // Server cache key includes company+mode to prevent cross-tenant hits
    const serverCacheKey = `${user.companyId}:${user.mode}:${queryHash}`;

    // Cache hit — return immediately
    const cached = queryCache.get(serverCacheKey);
    if (cached && Date.now() - cached.cachedAt < QUERY_CACHE_TTL_MS) {
      appEventRegistry.publish(AppEvents.QUERY_EXECUTED, {
        queryHash, databaseName: database_name, durationMs: 0,
        rowCount: cached.result.rows.length, wasCacheHit: true,
        companyId: user.companyId, userEmail: user.email,
      });
      console.log(`[QUERY API] Cache hit. Total request time: ${Date.now() - startTime}ms`);
      return successResponse({ ...cached.result, cachedAt: cached.cachedAt });
    }

    // Thundering herd: join in-flight promise for same hash
    const existingInflight = queryInflight.get(serverCacheKey);
    if (existingInflight) {
      const result = await existingInflight;
      return successResponse(result);
    }

    // Execute query (wrapped in a promise so concurrent identical requests share it)
    const execPromise = (async () => {
      // Handle composed questions (CTE construction)
      let finalQuery = query;
      if (references && Array.isArray(references) && references.length > 0) {
        console.log(`[QUERY API] Constructing CTEs for ${references.length} references`);
        const cteStart = Date.now();

        // Load referenced questions from DB
        const resolvedRefs: ResolvedReference[] = await Promise.all(
          (references as QuestionReference[]).map(async (ref) => {
            const result = await FilesAPI.loadFile(ref.id, user);
            return {
              id: ref.id,
              alias: ref.alias,
              query: (result.data.content as QuestionContent).query
            };
          })
        );

        // Use extracted function to build CTEs
        finalQuery = CTEfyQuery(query, resolvedRefs);
        console.log(`[QUERY API] CTE construction took ${Date.now() - cteStart}ms`);
      }

      // Apply None params: remove filter conditions or substitute with NULL
      const { sql: resolvedQuery, params: resolvedParams } = await applyNoneParams(finalQuery, paramValues);

      const queryStart = Date.now();
      const result = await runQuery(database_name, resolvedQuery, resolvedParams, user, parameterTypes);
      const durationMs = Date.now() - queryStart;

      // Populate server-side cache
      const cachedAt = Date.now();
      queryCache.set(serverCacheKey, { result, cachedAt });

      // Publish analytics event (fire-and-forget via registry)
      appEventRegistry.publish(AppEvents.QUERY_EXECUTED, {
        queryHash, databaseName: database_name, durationMs,
        rowCount: result.rows.length, wasCacheHit: false,
        companyId: user.companyId, userEmail: user.email,
      });

      return { ...result, cachedAt };
    })();

    queryInflight.set(serverCacheKey, execPromise);
    try {
      const result = await execPromise;
      console.log(`[QUERY API] Total request time: ${Date.now() - startTime}ms`);
      return successResponse(result);
    } finally {
      queryInflight.delete(serverCacheKey);
    }
  } catch (error) {
    console.error(`[QUERY API] Error after ${Date.now() - startTime}ms:`, error);
    return handleApiError(error);
  }
});
