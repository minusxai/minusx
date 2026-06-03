import type { QuestionReference, QuestionContent, QueryResult } from '@/lib/types';
import { connectionTypeToDialect } from '@/lib/types';
import { handleApiError } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';
import { NextRequest, NextResponse } from 'next/server';
import { CTEfyQuery, ResolvedReference } from '@/lib/sql/query-composer';
import { FilesAPI } from '@/lib/data/files.server';
import { ConnectionsAPI } from '@/lib/data/connections.server';
import { runQuery } from '@/lib/connections/run-query';
import { removeNoneParamConditions } from '@/lib/sql/ir-transforms';
import { parseSqlToIrLocal } from '@/lib/sql/sql-to-ir';
import { irToSqlLocal } from '@/lib/sql/ir-to-sql';
import { getQueryHash } from '@/lib/utils/query-hash';
import { appEventRegistry, AppEvents } from '@/lib/app-event-registry';
import { validateQueryTables } from '@/lib/sql/validate-query-tables';
import { getWhitelistForPath, WhitelistSchema } from '@/lib/sql/whitelist-resolver.server';
import { getModules } from '@/lib/modules/registry';

/**
 * Transform a query+params pair so that None (null) parameter values are handled:
 * 1. Try to remove filter conditions (WHERE/HAVING) for None params via IR round-trip.
 * 2. Substitute any remaining :param_name occurrences with NULL.
 * 3. Strip None params from the returned params dict.
 */
async function applyNoneParams(
  query: string,
  params: Record<string, string | number | null>,
  dialect: string
): Promise<{ sql: string; params: Record<string, string | number> }> {
  const noneSet = new Set(Object.keys(params).filter((k) => params[k] === null));
  const effectiveParams = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== null)
  ) as Record<string, string | number>;

  if (noneSet.size === 0) return { sql: query, params: effectiveParams };

  // Try IR-based filter removal locally via WASM (only for simple queries, not UNION)
  try {
    const ir = await parseSqlToIrLocal(query, dialect);
    if (ir.type !== 'compound') {
      const transformed = removeNoneParamConditions(ir as import('@/lib/sql/ir-types').QueryIR, noneSet);
      query = irToSqlLocal(transformed, dialect);
    }
  } catch { /* fall through to NULL substitution */ }

  // Substitute any remaining :param_name references with NULL (non-filter uses, fallback)
  for (const p of noneSet) {
    query = query.replace(new RegExp(`:${p}\\b`, 'g'), 'NULL');
  }
  return { sql: query, params: effectiveParams };
}

function whitelistToSchemaContext(whitelist: WhitelistSchema): Array<{ schema: string; table: string; columns: string[] }> {
  return whitelist.flatMap(w => w.tables.map(t => ({ schema: w.schema, table: t.table, columns: [] })));
}

// ---- Server-side query result cache (shared across sessions per process) ----
const QUERY_CACHE_TTL_MS = 60_000; // 60 seconds, hardcoded

interface CacheEntry { result: QueryResult; cachedAt: number; finalQuery: string; }
// eslint-disable-next-line no-restricted-syntax -- keys are `${getUserKey(user)}:${queryHash}`
const queryCache = new Map<string, CacheEntry>();
// eslint-disable-next-line no-restricted-syntax -- keys are `${getUserKey(user)}:${queryHash}`
const queryInflight = new Map<string, Promise<QueryResult & { _finalQuery: string }>>();

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
  try {
    const body = await request.json();
    const { connection_name, query, parameters, references, filePath, fileId, fileVersion } = body;

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
    const queryHash = getQueryHash(query, paramValues, connection_name);
    // User-scoped namespace prevents the cache from serving one user's result to another.
    const serverCacheKey = `${await getModules().auth.getUserKey(user)}:${queryHash}`;

    // Whitelist validation runs BEFORE the cache lookup. The cache is keyed by
    // (user, query, params) and does not include filePath; if validation came
    // after the cache hit, a user could replay a query that succeeded under one
    // filePath's whitelist from another filePath where it would now be denied,
    // or keep hitting cached results after an admin revoked the whitelist.
    // Validate first, then trust the cache only for authorized queries.
    let schemaContext: Array<{ schema: string; table: string; columns: string[] }> | null = null;
    if (filePath) {
      const whitelist = await getWhitelistForPath(filePath, connection_name, user);
      if (whitelist) {
        schemaContext = whitelistToSchemaContext(whitelist);
        const validationError = await validateQueryTables(query, whitelist, user);
        if (validationError) {
          return NextResponse.json(
            { success: false, error: { code: 'FORBIDDEN_TABLES', message: validationError } },
            { status: 403 }
          );
        }
      }
    }

    // Cache hit — return immediately (whitelist already validated above)
    const cached = queryCache.get(serverCacheKey);
    if (cached && Date.now() - cached.cachedAt < QUERY_CACHE_TTL_MS) {
      appEventRegistry.publish(AppEvents.QUERY_EXECUTED, {
        queryHash, fileId: fileId ?? null, fileVersion: fileVersion ?? null, query, params: paramValues as Record<string, unknown>,
        databaseName: connection_name, durationMs: 0,
        rowCount: cached.result.rows.length, colCount: cached.result.columns.length,
        wasCacheHit: true, mode: user.mode, userId: user.userId, userEmail: user.email,
      });
      return NextResponse.json({ success: true, data: { ...cached.result, cachedAt: cached.cachedAt }, finalQuery: cached.finalQuery });
    }

    // Thundering herd: join in-flight promise for same hash
    const existingInflight = queryInflight.get(serverCacheKey);
    if (existingInflight) {
      const { _finalQuery: rq, ...rest } = await existingInflight;
      return NextResponse.json({ success: true, data: rest, finalQuery: rq });
    }

    // Execute query (wrapped in a promise so concurrent identical requests share it)
    const execPromise = (async () => {
      // Handle composed questions (CTE construction)
      let composedQuery = query;
      if (references && Array.isArray(references) && references.length > 0) {
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
        composedQuery = CTEfyQuery(query, resolvedRefs);
      }

      // Derive dialect from connection type for IR-based None param removal.
      // Use the lightweight getRawByName (single getByPath, no loader) rather
      // than FilesAPI.loadFile — loadFile on a connection runs the
      // connectionLoader, which can trigger a full schema profiling refresh on
      // a stale/missing cache. On a dashboard firing N parallel queries that
      // refresh storm serializes the DB and surfaces as "Failed to fetch".
      let queryDialect = 'duckdb';
      try {
        const { type } = await ConnectionsAPI.getRawByName(connection_name, user.mode);
        if (type) queryDialect = connectionTypeToDialect(type);
      } catch { /* dialect defaults to duckdb */ }

      // Apply None params: remove filter conditions or substitute with NULL
      const { sql: noneResolvedQuery, params: resolvedParams } = await applyNoneParams(composedQuery, paramValues, queryDialect);

      const queryStart = Date.now();
      const result = await runQuery(connection_name, noneResolvedQuery, resolvedParams, user);
      const durationMs = Date.now() - queryStart;

      const displayQuery = result.finalQuery ?? noneResolvedQuery;

      // Populate server-side cache
      const cachedAt = Date.now();
      queryCache.set(serverCacheKey, { result, cachedAt, finalQuery: displayQuery });

      // Publish analytics event (fire-and-forget via registry)
      appEventRegistry.publish(AppEvents.QUERY_EXECUTED, {
        queryHash, fileId: fileId ?? null, fileVersion: fileVersion ?? null, query, params: paramValues as Record<string, unknown>,
        schemaContext: schemaContext ?? undefined,
        databaseName: connection_name, durationMs,
        rowCount: result.rows.length, colCount: result.columns.length,
        wasCacheHit: false, mode: user.mode, userId: user.userId, userEmail: user.email,
      });

      return { ...result, cachedAt, _finalQuery: displayQuery };
    })();

    queryInflight.set(serverCacheKey, execPromise);
    try {
      const { _finalQuery: rq, ...rest } = await execPromise;
      return NextResponse.json({ success: true, data: rest, finalQuery: rq });
    } catch (execError) {
      appEventRegistry.publish(AppEvents.QUERY_EXECUTED, {
        queryHash, fileId: fileId ?? null, fileVersion: fileVersion ?? null, query, params: paramValues as Record<string, unknown>,
        schemaContext: schemaContext ?? undefined,
        databaseName: connection_name, durationMs: Date.now() - startTime,
        rowCount: 0, colCount: 0, wasCacheHit: false,
        error: execError instanceof Error ? execError.message : String(execError),
        mode: user.mode, userId: user.userId, userEmail: user.email,
      });
      throw execError;
    } finally {
      queryInflight.delete(serverCacheKey);
    }
  } catch (error) {
    console.error(`[QUERY API] Error after ${Date.now() - startTime}ms:`, error);
    return handleApiError(error);
  }
});
