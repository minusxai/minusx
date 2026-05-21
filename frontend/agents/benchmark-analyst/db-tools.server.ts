// Production DB tools. Extends `Base*` variants from `./db-tools` to plug
// in the server-side `runQuery` / `loadConnectionSchema` chokepoints.
//
// Server-only: `runQuery` transitively imports `ConnectionsAPI` →
// `python-backend.server` → `auth-helpers` → `next-auth`, none of which
// load in a plain Node CLI process. The benchmark CLI imports
// `./db-tools` (Base classes only) and never reaches this file.

import 'server-only';
import type { TSchema } from 'typebox';
import type { Tool } from '@/orchestrator/llm';
import { runQuery } from '@/lib/connections/run-query';
import { loadConnectionSchema } from '@/lib/connections/load-schema';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { QueryResult, SchemaEntry } from '@/lib/connections/base';
import {
  BaseExecuteQuery,
  BaseSearchDBSchema,
  ExecuteQueryParamsNoTimeout,
  EXECUTE_QUERY_DESCRIPTION,
} from './db-tools';

/**
 * Production ExecuteQuery variant. Overrides `_initialiseConnectors` to a
 * no-op (production context carries no embedded connector configs) and
 * routes the fallback through `runQuery`, which goes via
 * `ConnectionsAPI.getRawByName` + `getNodeConnector` — the standard
 * production seam.
 *
 * Overrides `static schema` with the no-`timeout` variant: the production
 * path (`_executeFallback` → `runQuery`) does not yet honour the query
 * timeout, so the param + its description are hidden here rather than
 * advertising a capability the production tool doesn't deliver. Wiring
 * the timeout through the production path is tracked in Tasks.md; restore
 * the full schema once that lands. `schema.name` is unchanged, so the LLM
 * still sees one consistent tool name.
 */
export class ExecuteQuery extends BaseExecuteQuery {
  static override readonly schema: Tool<TSchema> = {
    name: 'ExecuteQuery',
    description: EXECUTE_QUERY_DESCRIPTION,
    parameters: ExecuteQueryParamsNoTimeout,
  };

  protected override async _initialiseConnectors(): Promise<void> {
    // No-op: production context.connections is metadata-only (no `config`).
    // Query execution goes through `runQuery` via the fallback hook below.
  }

  protected override async _executeFallback(
    connectionId: string,
    query: string,
    params: Record<string, string | number>,
  ): Promise<QueryResult> {
    const user = (this.context as { effectiveUser?: EffectiveUser }).effectiveUser;
    if (!user) {
      throw new Error(
        'ExecuteQuery: missing effectiveUser on agent context — cannot resolve connection. This is a server bug; please report.',
      );
    }
    return runQuery(connectionId, query, params, user);
  }
}

/**
 * Production SearchDBSchema variant. Overrides `_initialiseConnectors` to
 * a no-op and routes the schema fallback through `loadConnectionSchema`,
 * which reads the cached schema from the connection file via FilesAPI.
 * Inherits `static schema` (and therefore `schema.name`) from
 * `BaseSearchDBSchema`.
 */
export class SearchDBSchema extends BaseSearchDBSchema {
  protected override async _initialiseConnectors(): Promise<void> {
    // No-op: production never uses embedded connectors.
  }

  protected override async _loadSchemaFallback(connection: string): Promise<SchemaEntry[]> {
    const user = (this.context as { effectiveUser?: EffectiveUser }).effectiveUser;
    if (!user) return [];
    return loadConnectionSchema(connection, user);
  }
}
