// Production wiring for the v=2 orchestrator's `SqlExecutor` singleton.
// `agents/benchmark-analyst/db-tools.ts:ExecuteSQL` calls `getSqlExecutor()`
// which returns whatever was last registered via `setSqlExecutor`. Tests and
// benchmarks register their own (in-memory or NodeConnector-backed)
// implementations; **production must wire one too** or v=2 ExecuteSQL throws
// "SqlExecutor not set".
//
// The implementation here re-uses the same `runQuery` helper that
// `/api/query` calls, so v=1 and v=2 ride identical execution semantics
// (Node connectors → Python backend fallback, identical caching behavior
// at the `/api/query` layer). User context flows through the tool's
// `AgentContext` (cast to `{ effectiveUser?: EffectiveUser }`) — pi-ai's
// orchestrator passes the agent's context to every tool's `run()`.

import 'server-only';
import { runQuery } from '@/lib/connections/run-query';
import { setSqlExecutor, type SqlExecutor } from '@/agents/benchmark-analyst/sources';
import type { AgentContext } from '@/orchestrator/types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

/** Structural read of `effectiveUser` off the agent context — avoids
 *  importing `RemoteAnalystContext` to keep this module light. */
function getUserFromCtx(ctx: AgentContext | undefined): EffectiveUser | undefined {
  return (ctx as { effectiveUser?: EffectiveUser } | undefined)?.effectiveUser;
}

let _wired = false;

/**
 * Idempotent. Call from any v=2 server-init path; subsequent calls are
 * no-ops so it's safe to invoke at module load from multiple route
 * handlers.
 */
export function setupV2ServerSources(): void {
  if (_wired) return;
  _wired = true;

  const executor: SqlExecutor = {
    async execute(sql, connection, ctx) {
      const user = getUserFromCtx(ctx);
      if (!user) {
        return {
          rows: [],
          error: 'ExecuteSQL: missing effectiveUser on agent context — cannot resolve connection. This is a server bug; please report.',
        };
      }
      const start = Date.now();
      try {
        const result = await runQuery(connection, sql, {}, user);
        return {
          rows: result.rows,
          columns: result.columns,
          types: result.types,
          finalQuery: result.finalQuery,
          executionMs: Date.now() - start,
        };
      } catch (err) {
        return {
          rows: [],
          error: err instanceof Error ? err.message : String(err),
          executionMs: Date.now() - start,
        };
      }
    },
  };

  setSqlExecutor(executor);
}
