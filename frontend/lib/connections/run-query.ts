import 'server-only';
import { ConnectionsAPI } from '@/lib/data/connections.server';
import { resolveConnectionSecrets } from '@/lib/secrets/connection-secrets.server';
import { getNodeConnector } from '@/lib/connections';
import { enforceQueryLimit } from '@/lib/sql/limit-enforcer';
import { connectionTypeToDialect } from '@/lib/types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import { drainQueryStream, queryResultToStream, type QueryResult, type QueryStream } from './base';

export type { QueryResult, QueryStream };

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
  return drainQueryStream(await runQueryStream(databaseName, query, params, user));
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
    ? connector.queryStream(cappedQuery, params)
    : queryResultToStream(await connector.query(cappedQuery, params));
}
