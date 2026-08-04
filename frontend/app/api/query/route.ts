import type { QueryStream } from '@/lib/connections/base';
import { handleApiError, ApiErrors } from '@/lib/http/api-responses';
import { withAuth } from '@/lib/http/with-auth';
import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'stream';
import { runQueryStream } from '@/lib/connections/run-query';
import { applyNoneParams } from '@/lib/sql/none-params';
import { getQueryHash } from '@/lib/utils/query-hash';
import { appEventRegistry, AppEvents } from '@/lib/app-event-registry';
import {
  resolveQueryForExecution, dialectForConnection, WhitelistViolationError,
} from '@/lib/sql/governed-query.server';
import { getModules } from '@/lib/modules/registry';
import { getCachedJsonlStream } from '@/lib/query-cache/execute.server';
import { resolveCachePolicy } from '@/lib/query-cache/policy.server';
import { assertGuestQueryAllowed, sanitizeGuestParams, GuestQueryDeniedError } from '@/lib/query-cache/guest-query.server';
import { getViewsForPath } from '@/lib/views/views.server';
import { resolvePath } from '@/lib/mode/path-resolver';
import { mentionsViews, resolveViewsInSql, ViewResolutionError } from '@/lib/views/resolve';

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
      filePath, fileId, fileVersion, cachePolicy: bodyPolicy, forceRefresh: bodyForceRefresh,
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

    // ── Governance: whitelist validation + view inlining (BEFORE any cache) ────
    // One shared seam (`lib/sql/governed-query.server.ts`) that every executing
    // surface calls, so the browser, the agent's ExecuteQuery and MCP cannot
    // drift apart on what is allowed — they have, repeatedly.
    //
    // Validation happens before the cache is trusted because the cache key is
    // (mode, query, params) and does NOT include filePath: without this a user
    // could replay a query authorized under one filePath's whitelist from
    // another where it is now denied.
    //
    // A question's queries are governed by ITS OWN path — the nearest context to
    // the file, not the caller's home folder — which is what makes a locked-down
    // team folder actually lock its questions down. With no filePath there is
    // nothing to anchor to and the query runs ungoverned (unchanged behaviour).
    let schemaContext: Array<{ schema: string; table: string; columns: string[] }> | null = null;
    let executedQuery = query;
    // Resolved once and reused — the seam already looked it up, and this route is
    // deliberately kept to one connection read (see query-route-no-profiling).
    let queryDialect: string | undefined;
    if (filePath) {
      try {
        const governed = await resolveQueryForExecution({
          sql: query, connectionName, user, anchor: { kind: 'file', path: filePath },
        });
        executedQuery = governed.executedQuery;
        schemaContext = governed.schemaContext;
        queryDialect = governed.dialect;
      } catch (err) {
        if (err instanceof WhitelistViolationError) {
          return NextResponse.json(
            { success: false, error: { code: 'FORBIDDEN_TABLES', message: err.message } },
            { status: 403 },
          );
        }
        if (err instanceof ViewResolutionError) return ApiErrors.badRequest(err.message);
        throw err;
      }
    } else if (mentionsViews(query)) {
      // No anchor to govern by, but a `_views` reference still has to be inlined
      // or it reaches the warehouse as a table that does not exist there.
      try {
        queryDialect = await dialectForConnection(connectionName, user.mode);
        const views = await getViewsForPath(resolvePath(user.mode, '/'), connectionName, user);
        executedQuery = await resolveViewsInSql(query, queryDialect, views);
      } catch (err) {
        if (err instanceof ViewResolutionError) return ApiErrors.badRequest(err.message);
        throw err;
      }
    }

    // Only for the ungoverned, view-free path — every other branch already has it.
    queryDialect ??= await dialectForConnection(connectionName, user.mode);

    // ── The execution thunk (runs only on miss / expired / background revalidate) ──
    const execute = async (): Promise<QueryStream> => {
      const { sql: noneResolvedQuery, params: resolvedParams } = await applyNoneParams(executedQuery, paramValues, queryDialect);

      // Stream the result — the executor pipes it through to the object store +
      // client without materializing on the server.
      return runQueryStream(connectionName, noneResolvedQuery, resolvedParams, user, paramTypes);
    };

    // ── SWR + lease + blob, streamed as JSONL ──────────────────────────────────
    // forceRefresh ("Run query") re-executes + refreshes the cache. NOT honored for
    // guests — public shares must stay cache-served so they can't hammer the warehouse.
    const forceRefresh = bodyForceRefresh === true && !user.guest;
    const { stream, meta } = await getCachedJsonlStream({
      mode, connectionName, query: executedQuery, params: paramValues, policy, execute, forceRefresh,
      parameterTypes: paramTypes,
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
