/**
 * The governed query seam — the ONE place that decides whether a piece of
 * user- or agent-authored SQL may run, and what it actually executes as.
 *
 * Access control at query time used to be a courtesy each surface
 * re-implemented: the browser route validated the table whitelist and inlined
 * views, MCP validated but never inlined, and the agent's ExecuteQuery did
 * neither. They drifted, silently and repeatedly — a table withheld from a
 * workspace still returned rows through the agent's tool while the browser
 * answered 403 for the same SQL. Concealment is not enforcement: not showing a
 * table to a model is no protection once the model names it anyway.
 *
 * So the composition lives here and every executing surface calls it. The ORDER
 * is load-bearing and is the order `/api/query` established:
 *
 *   1. resolve the whitelist for the anchor   (null ⇒ genuinely unrestricted)
 *   2. validate the query the CALLER WROTE    (before any rewriting)
 *   3. resolve the dialect
 *   4. inline `_views.*` as CTEs              (only when mentioned)
 *
 * Validation precedes inlining because a view is authorized as ITSELF — it
 * appears in the whitelisted schema, so a curated view may expose an aggregate
 * over tables the reader cannot query directly, and the view's own SQL is
 * validated where it is AUTHORED (the context save gate). Validating the
 * inlined text instead would reject exactly the case views exist for.
 *
 * Inlining precedes execution AND caching so cache keys are computed over the
 * RESOLVED SQL: editing a view's body changes the key and invalidates stale
 * results for free, and an agent query and a UI query of the same view share
 * one entry.
 *
 * Callers must not re-implement any step. `eslint.config.mjs` restricts direct
 * `run-query` imports to this module and a short list of callers that execute
 * already-validated SQL (semantic probes, view column snapshots, guest replay).
 */
import 'server-only';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import { connectionTypeToDialect } from '@/lib/types';
import { ConnectionsAPI } from '@/lib/data/connections.server';
import { validateQueryTables } from '@/lib/sql/validate-query-tables';
import {
  getWhitelistForPath,
  whitelistToSchemaContext,
  type WhitelistSchema,
} from '@/lib/sql/whitelist-resolver.server';
import { getViewsForPath } from '@/lib/views/views.server';
import { mentionsViews, resolveViewsInSql } from '@/lib/views/resolve';
import { resolveHomeFolderSync } from '@/lib/mode/path-resolver';

/**
 * Which context governs this query.
 *
 * Required rather than inferred, because the two surfaces genuinely differ and
 * the difference used to be accidental: a question file is governed by the
 * nearest context to ITS PATH (so a query saved into a locked-down team folder
 * runs under that folder's rules), while free-form chat has no file and is
 * governed by the user's home folder. Making it a parameter turns "which rules
 * apply?" into a visible decision at every call site.
 */
export type QueryAnchor =
  | { kind: 'file'; path: string }
  | { kind: 'homeFolder' };

/** SQL that reaches outside the anchor's whitelist. Carries the offending names. */
export class WhitelistViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WhitelistViolationError';
  }
}

export interface GovernedQuery {
  /** The SQL to execute — view references inlined; byte-identical when none. */
  executedQuery: string;
  /** Dialect resolved for the connection (duckdb when it cannot be determined). */
  dialect: string;
  /**
   * Flattened whitelist for analytics/telemetry (`QUERY_EXECUTED.schemaContext`).
   * `null` when the workspace is unrestricted.
   */
  schemaContext: Array<{ schema: string; table: string; columns: string[] }> | null;
}

/** The anchor's lookup path. `homeFolder` mirrors what `buildServerAgentArgs` selects. */
function anchorPath(anchor: QueryAnchor, user: EffectiveUser): string {
  return anchor.kind === 'file'
    ? anchor.path
    : resolveHomeFolderSync(user.mode, user.home_folder || '');
}

/** Connection dialect; duckdb when the connection cannot be read. */
export async function dialectForConnection(
  connectionName: string,
  mode: EffectiveUser['mode'],
): Promise<string> {
  try {
    const { type } = await ConnectionsAPI.getRawByName(connectionName, mode);
    return type ? connectionTypeToDialect(type) : 'duckdb';
  } catch {
    return 'duckdb';
  }
}

/**
 * Authorize and rewrite one query for execution.
 *
 * @throws WhitelistViolationError when the SQL reads outside the anchor's whitelist
 * @throws ViewResolutionError     when a `_views.*` reference is unknown or cyclic
 */
export async function resolveQueryForExecution(opts: {
  sql: string;
  connectionName: string;
  user: EffectiveUser;
  anchor: QueryAnchor;
  /**
   * Pre-resolved whitelist, when the caller already fetched it (the query route
   * needs it for its analytics payload). Skips one context resolution; pass
   * nothing to have the seam resolve it.
   */
  whitelist?: WhitelistSchema | null;
}): Promise<GovernedQuery> {
  const { sql, connectionName, user, anchor } = opts;
  const lookupPath = anchorPath(anchor, user);

  // 1. Whitelist. `null` means unrestricted — a chain of `*` up to the root, or
  //    no context at all. `getWhitelistForPath` never throws: a lookup failure
  //    must not block execution.
  const whitelist = opts.whitelist !== undefined
    ? opts.whitelist
    : await getWhitelistForPath(lookupPath, connectionName, user);

  // 2. Validate what the caller WROTE, before any rewriting.
  if (whitelist) {
    const violation = await validateQueryTables(sql, whitelist, user);
    if (violation) throw new WhitelistViolationError(violation);
  }

  // 3 + 4. Dialect and view inlining — both only when views are actually
  //        mentioned, so ordinary SQL keeps its exact text and cache key and is
  //        never handed to the parser.
  if (!mentionsViews(sql)) {
    return {
      executedQuery: sql,
      dialect: await dialectForConnection(connectionName, user.mode),
      schemaContext: whitelist ? whitelistToSchemaContext(whitelist) : null,
    };
  }

  const dialect = await dialectForConnection(connectionName, user.mode);
  const views = await getViewsForPath(lookupPath, connectionName, user);
  return {
    executedQuery: await resolveViewsInSql(sql, dialect, views),
    dialect,
    schemaContext: whitelist ? whitelistToSchemaContext(whitelist) : null,
  };
}
