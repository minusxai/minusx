import type { QuestionReference, QuestionContent } from '@/lib/types';
import type { QueryStream } from '@/lib/connections/base';
import { connectionTypeToDialect } from '@/lib/types';
import { handleApiError, ApiErrors } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';
import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'stream';
import { CTEfyQuery, ResolvedReference } from '@/lib/sql/query-composer';
import { FilesAPI } from '@/lib/data/files.server';
import { ConnectionsAPI } from '@/lib/data/connections.server';
import { runQueryStream } from '@/lib/connections/run-query';
import { applyNoneParams } from '@/lib/sql/none-params';
import { getQueryHash } from '@/lib/utils/query-hash';
import { appEventRegistry, AppEvents } from '@/lib/app-event-registry';
import { validateQueryTables } from '@/lib/sql/validate-query-tables';
import { getWhitelistForPath, WhitelistSchema } from '@/lib/sql/whitelist-resolver.server';
import { getModules } from '@/lib/modules/registry';
import { getCachedJsonlStream } from '@/lib/query-cache/execute.server';
import { resolveCachePolicy } from '@/lib/query-cache/policy.server';
import { assertGuestQueryAllowed, sanitizeGuestParams, GuestQueryDeniedError } from '@/lib/query-cache/guest-query.server';

function whitelistToSchemaContext(whitelist: WhitelistSchema): Array<{ schema: string; table: string; columns: string[] }> {
  return whitelist.flatMap(w => w.tables.map(t => ({ schema: w.schema, table: t.table, columns: [] })));
}

type ParamMap = Record<string, string | number | null>;

// Route segment config: optimize for API routes
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = withAuth(async (request: NextRequest, user) => {
  const startTime = Date.now();
  try {
    const body = await request.json();
    const {
      connection_name: bodyConnection, query: bodyQuery, parameters, parameterTypes,
      references, filePath, fileId, fileVersion, cachePolicy: bodyPolicy, forceRefresh: bodyForceRefresh,
    } = body;
    // Declared param types ('text'|'number'|'date'), keyed by name — advisory, used
    // by connectors that need explicit typing (BigQuery: bind a `date` param as DATE).
    const paramTypes: Record<string, string> | undefined =
      parameterTypes && typeof parameterTypes === 'object' ? parameterTypes : undefined;

    // Parameter values (object form). null = explicit None.
    const bodyParams: ParamMap = {};
    if (typeof parameters === 'object' && parameters !== null && !Array.isArray(parameters)) {
      Object.assign(bodyParams, parameters);
    }

    const connectionName: string = bodyConnection;
    const query: string = bodyQuery;
    let paramValues: ParamMap = bodyParams;
    const policy = resolveCachePolicy(bodyPolicy);

    if (typeof query !== 'string' || query.length === 0) {
      return ApiErrors.validationError('query is required');
    }

    // ── Guest guard ────────────────────────────────────────────────────────────
    // Anonymous public-share viewers may NOT run arbitrary SQL. The submitted
    // (query, connection) must be one embedded in the page they're viewing
    // (filePath); params are sanitized to bind-safe primitives. This is the
    // boundary that closes the "anon user queries the DB directly" hole.
    if (user.guest) {
      if (!filePath) {
        return ApiErrors.forbidden('Guests must execute within a shared page.');
      }
      try {
        await assertGuestQueryAllowed(filePath, query, connectionName, user);
      } catch (err) {
        if (err instanceof GuestQueryDeniedError) return ApiErrors.forbidden(err.message);
        return ApiErrors.forbidden('You do not have access to this query.');
      }
      paramValues = sanitizeGuestParams(bodyParams);
    }

    const queryHash = getQueryHash(query, paramValues as Record<string, unknown>, connectionName);
    const mode = await getModules().auth.getUserKey(user);

    // ── Whitelist validation (BEFORE serving any cache) ────────────────────────
    // Keyed by (mode, query, params) — does NOT include filePath. Validate before
    // trusting the cache so a user can't replay a query authorized under one
    // filePath's whitelist from another where it's now denied.
    let schemaContext: Array<{ schema: string; table: string; columns: string[] }> | null = null;
    if (filePath) {
      const whitelist = await getWhitelistForPath(filePath, connectionName, user);
      if (whitelist) {
        schemaContext = whitelistToSchemaContext(whitelist);
        const validationError = await validateQueryTables(query, whitelist, user);
        if (validationError) {
          return NextResponse.json(
            { success: false, error: { code: 'FORBIDDEN_TABLES', message: validationError } },
            { status: 403 },
          );
        }
      }
    }

    // ── The execution thunk (runs only on miss / expired / background revalidate) ──
    const execute = async (): Promise<QueryStream> => {
      let composedQuery = query;
      if (Array.isArray(references) && references.length > 0) {
        const resolvedRefs: ResolvedReference[] = await Promise.all(
          (references as QuestionReference[]).map(async (ref) => {
            const result = await FilesAPI.loadFile(ref.id, user);
            return { id: ref.id, alias: ref.alias, query: (result.data.content as QuestionContent).query };
          }),
        );
        composedQuery = CTEfyQuery(query, resolvedRefs);
      }

      // Derive dialect via getRawByName (no schema-profiling loader on the hot path).
      let queryDialect = 'duckdb';
      try {
        const { type } = await ConnectionsAPI.getRawByName(connectionName, user.mode);
        if (type) queryDialect = connectionTypeToDialect(type);
      } catch { /* default duckdb */ }

      const { sql: noneResolvedQuery, params: resolvedParams } = await applyNoneParams(composedQuery, paramValues, queryDialect);

      // Stream the result — the executor pipes it through to the object store +
      // client without materializing on the server.
      return runQueryStream(connectionName, noneResolvedQuery, resolvedParams, user, paramTypes);
    };

    // ── SWR + lease + blob, streamed as JSONL ──────────────────────────────────
    // forceRefresh ("Run query") re-executes + refreshes the cache. NOT honored for
    // guests — public shares must stay cache-served so they can't hammer the warehouse.
    const forceRefresh = bodyForceRefresh === true && !user.guest;
    const refsForKey = Array.isArray(references)
      ? (references as QuestionReference[]).map((r) => ({ id: r.id, alias: r.alias }))
      : undefined;
    const { stream, meta } = await getCachedJsonlStream({
      mode, connectionName, query, params: paramValues, policy, execute, forceRefresh,
      parameterTypes: paramTypes, references: refsForKey,
    });

    // One analytics event per request, from the executor's meta (covers hit + miss).
    appEventRegistry.publish(AppEvents.QUERY_EXECUTED, {
      queryHash, fileId: fileId ?? null, fileVersion: fileVersion ?? null, query,
      params: paramValues as Record<string, unknown>, schemaContext: schemaContext ?? undefined,
      databaseName: connectionName, durationMs: Date.now() - startTime,
      rowCount: meta.rowCount, colCount: meta.colCount,
      wasCacheHit: meta.fromCache, mode: user.mode, userId: user.userId, userEmail: user.email,
    });

    // Plain JSONL body (header line + one row per line). Nginx still owns wire
    // gzip; we set no Content-Encoding. Metadata rides in headers.
    return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
      status: 200,
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Cache': meta.fromCache ? 'hit' : 'miss',
        'X-Cached-At': String(meta.cachedAt),
        'X-Row-Count': String(meta.rowCount),
      },
    });
  } catch (error) {
    // Query EXECUTION failures (bad SQL, missing table, warehouse perms) are the
    // query's problem → 400, not 500. The client shows the message and (correctly)
    // does NOT page the team via capture-error for 4xx.
    const message = error instanceof Error ? error.message : String(error);
    appEventRegistry.publish(AppEvents.QUERY_EXECUTED, {
      queryHash: '', fileId: null, fileVersion: null, query: '', params: {},
      databaseName: '', durationMs: Date.now() - startTime,
      rowCount: 0, colCount: 0, wasCacheHit: false, error: message,
      mode: user.mode, userId: user.userId, userEmail: user.email,
    });
    if (error instanceof Error) {
      return ApiErrors.badRequest(message);
    }
    return handleApiError(error);
  }
});
