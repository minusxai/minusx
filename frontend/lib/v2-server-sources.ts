// Production wiring for the v=2 orchestrator's SqlExecutor and SchemaSource
// singletons. Tools in `agents/benchmark-analyst/db-tools.ts` call
// `getSqlExecutor()` / `getSchemaSource()` — tests register their own
// (in-memory / NodeConnector-backed) implementations; production wires them
// here so v=2 rides the same execution path as v=1.

import 'server-only';
import { runQuery } from '@/lib/connections/run-query';
import { FilesAPI } from '@/lib/data/files.server';
import { connectionLoader } from '@/lib/data/loaders/connection-loader';
import { resolvePath } from '@/lib/mode/path-resolver';
import {
  setSqlExecutor,
  setSchemaSource,
  type SqlExecutor,
  type SchemaSource,
  type SchemaHit,
} from '@/agents/benchmark-analyst/sources';
import type { AgentContext } from '@/orchestrator/types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

/** Structural read of `effectiveUser` off the agent context. */
function getUserFromCtx(ctx: AgentContext | undefined): EffectiveUser | undefined {
  return (ctx as { effectiveUser?: EffectiveUser } | undefined)?.effectiveUser;
}

/** Structural read of `mode` off the agent context (defaults to 'org'). */
function getModeFromCtx(ctx: AgentContext | undefined): 'org' | 'tutorial' {
  const m = (ctx as { mode?: string } | undefined)?.mode;
  return m === 'tutorial' ? 'tutorial' : 'org';
}

let _wired = false;

/**
 * Idempotent. Call from any v=2 server-init path; subsequent calls are
 * no-ops so it's safe to invoke at module load from multiple route handlers.
 */
export function setupV2ServerSources(): void {
  if (_wired) return;
  _wired = true;

  // ── SqlExecutor ─────────────────────────────────────────────────────────
  // Reuses the same `runQuery` helper that /api/query calls: identical
  // Node-connector / Python-backend fallback and caching semantics.
  const executor: SqlExecutor = {
    async execute(sql, connection, ctx) {
      const user = getUserFromCtx(ctx);
      if (!user) {
        return {
          rows: [],
          error: 'ExecuteQuery: missing effectiveUser on agent context — cannot resolve connection. This is a server bug; please report.',
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

  // ── SchemaSource ─────────────────────────────────────────────────────────
  // Loads the connection file (cached schema) and flattens to SchemaHit[].
  // Whitelist filtering is left to SearchDBSchema.run() — same result, avoids
  // coupling the source to agent context internals.
  const schemaSource: SchemaSource = {
    async search(query, connection, ctx) {
      const user = getUserFromCtx(ctx);
      if (!user) return [];

      const mode = getModeFromCtx(ctx);
      try {
        const connectionPath = resolvePath(mode, `/database/${connection}`);
        const connectionFile = await FilesAPI.loadFileByPath(connectionPath, user);
        const loadedConnection = await connectionLoader(connectionFile.data, user);
        const content = loadedConnection.content as {
          schema?: { schemas: Array<{ schema: string; tables: Array<{ table: string; columns?: Array<{ name: string; type: string }> }> }> };
        };
        const schemas = content.schema?.schemas ?? [];

        // Flatten nested schemas → individual SchemaHit entries.
        // SearchDBSchema.run() does keyword / JSONPath filtering post-load when
        // a query is present (matches v=1 semantics for unwhitelisted agents).
        // We return all tables here so the agent can filter or search as needed.
        const hits: SchemaHit[] = schemas.flatMap((s) =>
          s.tables.map((t) => ({
            table: t.table,
            // Keep schema name on each hit so the whitelist filter in
            // db-tools can match qualified `schema.table` entries.
            ...(s.schema ? { schema: s.schema } : {}),
            columns: (t.columns ?? []).map((c) => ({ name: c.name, type: c.type })),
          })),
        );

        return hits;
      } catch {
        return [];
      }
    },
  };
  setSchemaSource(schemaSource);
}
