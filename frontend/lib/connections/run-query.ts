import 'server-only';
import { ConnectionsAPI } from '@/lib/data/connections.server';
import { resolveConnectionSecrets } from '@/lib/secrets/connection-secrets.server';
import { getNodeConnector } from '@/lib/connections';
import { enforceQueryLimit } from '@/lib/sql/limit-enforcer';
import { connectionTypeToDialect } from '@/lib/types';
import { QUERY_SERVER_TIMEOUT_MS } from '@/lib/config';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import { drainQueryStream, drainQueryStreamBounded, queryResultToStream, type QueryResult, type QueryStream, type BoundedDrainOptions, type BoundedQueryResult } from './base';

export type { QueryResult, QueryStream };

/** Race a materialization against the server wall-clock bound (shared by runQuery + runQueryBounded). */
function withServerTimeout<T>(work: Promise<T>): Promise<T> {
  if (QUERY_SERVER_TIMEOUT_MS <= 0) return work;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(
        `Query timed out after ${Math.round(QUERY_SERVER_TIMEOUT_MS / 1000)}s (server bound; tune via QUERY_SERVER_TIMEOUT_MS). `
        + 'The query may still be running on the warehouse.',
      )),
      QUERY_SERVER_TIMEOUT_MS,
    );
  });
  return Promise.race([work, deadline]).finally(() => {
    clearTimeout(timer);
    work.catch(() => { /* abandoned after timeout — swallow so it never surfaces as unhandled */ });
  });
}

/**
 * Execute a SQL query against a named connection.
 *
 * Every supported connection type has a Node.js connector in
 * `getNodeConnector` (DuckDB, SQLite, Postgres, BigQuery, Athena, CSV,
 * Google Sheets, Mongo, internal_db). Unknown connection names or types
 * throw.
 *
 * @param databaseName - Connection name (matches the `name` field in connection config)
 * @param query        - SQL query string
 * @param params       - Parameter values (substituted for :param placeholders)
 * @param user - Effective user (supplies mode for path resolution)
 */
export async function runQuery(
  databaseName: string,
  query: string,
  params: Record<string, string | number>,
  user: EffectiveUser,
): Promise<QueryResult> {
  // Materialized convenience — drains the streaming path. Every execution flows
  // through runQueryStream, so streaming-capable connectors stream even here.
  //
  // Wall-clock bound (QUERY_SERVER_TIMEOUT_MS, 0 disables): this is the single materializing
  // seam for /api/query misses, server tools (ExecuteQuery), and headless ReadFiles — callers the
  // browser's 120s guard can't protect. A stuck warehouse query otherwise hangs them all
  // indefinitely. The connector's work is abandoned, not cancelled (connectors lack a uniform
  // cancel API) — the point is unblocking the caller and its semaphore/turn.
  return withServerTimeout((async () => drainQueryStream(await runQueryStream(databaseName, query, params, user)))());
}

/**
 * Like {@link runQuery} but materializes only up to a row/byte budget, then stops pulling (the
 * pull-based stream stops the connector cursor too). For agent/file-read consumers that truncate to
 * a character budget anyway — bounds peak RAM to the budget instead of the full (or uncapped) result,
 * which is what makes reading a many-question dashboard safe. Same connection resolution, row cap,
 * and wall-clock timeout as runQuery.
 */
export async function runQueryBounded(
  databaseName: string,
  query: string,
  params: Record<string, string | number>,
  user: EffectiveUser,
  budget: BoundedDrainOptions,
): Promise<BoundedQueryResult> {
  return withServerTimeout((async () => drainQueryStreamBounded(await runQueryStream(databaseName, query, params, user), budget))());
}

/**
 * Execute a SQL query and STREAM the result. The streaming-first server seam:
 * the cache-write/response path consumes this and pipes batches straight to the
 * object store + client without materializing. Shares connection resolution +
 * row-cap enforcement with {@link runQuery}.
 */
export async function runQueryStream(
  databaseName: string,
  query: string,
  params: Record<string, string | number>,
  user: EffectiveUser,
  /** Declared logical param types ('text'|'number'|'date'), keyed by name — advisory; see queryStream. */
  paramTypes?: Record<string, string>,
): Promise<QueryStream> {
  // Use getRawByName so credentials (e.g. service_account_json) are included.
  const rawConn = await ConnectionsAPI.getRawByName(databaseName, user.mode).catch(() => null);
  if (!rawConn) {
    throw new Error(`Connection not found: ${databaseName}`);
  }

  const { type } = rawConn;
  if (type === 'internal_db' && user.mode !== 'internals') {
    throw new Error('internal_db connections are only available in internals mode');
  }

  // File Architecture v2: the stored config holds @SECRETS/… refs — resolve them to real
  // credentials here, server-side, right before handing config to the connector. Resolved
  // values never leave the server (not returned, not logged, not in markup).
  const config = await resolveConnectionSecrets(rawConn.config);

  const connector = getNodeConnector(databaseName, type, config);
  if (!connector) {
    throw new Error(`No connector available for type: ${type}`);
  }

  // Single seam for row-cap enforcement: every server-side execution (v1 chat
  // ExecuteQuery, /api/query, v2 chat orchestrator) flows through here, so
  // applying enforceQueryLimit at this point covers them all uniformly.
  // enforceQueryLimit is a no-op on parse failure and on non-SELECT statements
  // (ATTACH, INSERT, DDL, …), so this is safe for the full set of inputs.
  const dialect = connectionTypeToDialect(type);
  const cappedQuery = await enforceQueryLimit(query, { dialect });

  // Real connectors all inherit NodeConnector.queryStream; a minimal connector
  // (or a test mock) implementing only query() is wrapped as a one-shot stream.
  return typeof connector.queryStream === 'function'
    ? connector.queryStream(cappedQuery, params, undefined, paramTypes)
    : queryResultToStream(await connector.query(cappedQuery, params));
}
