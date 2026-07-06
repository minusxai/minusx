/**
 * Server-side whitelist resolver.
 *
 * Resolves the applicable context for a given file path and extracts the
 * whitelisted schema for a specific connection.  Mirrors the client-side
 * selectContextFromPath selector (directory-based ancestor matching,
 * deepest-first) so both GUI and server-side code enforce the same rules.
 */

import 'server-only';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { ContextContent } from '@/lib/types';
import { FilesAPI } from '@/lib/data/files.server';
import { getWhitelistedSchemaForUser } from '@/lib/sql/schema-filter';
import { getPublishedVersion } from '@/lib/context/context-utils';
import { resolvePath, resolveHomeFolderSync } from '@/lib/mode/path-resolver';

export type WhitelistSchema = Array<{ schema: string; tables: Array<{ table: string }> }>;

/**
 * Flatten a resolved whitelist into the flat {schema, table, columns} shape
 * expected by the QUERY_EXECUTED analytics event's `schemaContext` field.
 * `columns` is always empty — the whitelist only tracks table-level grants.
 */
export function whitelistToSchemaContext(
  whitelist: WhitelistSchema,
): Array<{ schema: string; table: string; columns: string[] }> {
  return whitelist.flatMap((w) => w.tables.map((t) => ({ schema: w.schema, table: t.table, columns: [] })));
}

/**
 * Resolve the whitelist for `lookupPath` + `connectionName` server-side.
 *
 * Finds the nearest ancestor context file for `lookupPath` (same algorithm as
 * the client-side `selectContextFromPath` Redux selector), then returns the
 * whitelisted schema entries for `connectionName`.
 *
 * Returns `null` when no context applies — callers should allow the query
 * through with no restriction.  Never throws: errors are silently swallowed
 * so a context lookup failure never blocks query execution.
 *
 * @param lookupPath   - Absolute path used to find the nearest context.
 *                       Pass the question's file path for GUI queries, or the
 *                       user's effective home folder for MCP / server-initiated
 *                       queries where no specific file is known.
 * @param connectionName - Database connection name to look up in the context.
 * @param user           - Effective user (supplies mode and home folder).
 */
export async function getWhitelistForPath(
  lookupPath: string,
  connectionName: string,
  user: EffectiveUser
): Promise<WhitelistSchema | null> {
  try {
    const modePath = resolvePath(user.mode, '/');
    const { data: contextFiles } = await FilesAPI.getFiles(
      { type: 'context', paths: [modePath], depth: -1 },
      user
    );
    if (!contextFiles.length) return null;

    const normalizedPath = lookupPath.endsWith('/') && lookupPath !== '/' ? lookupPath.slice(0, -1) : lookupPath;

    // Mirror selectContextFromPath: match by directory, deepest first
    const matching = contextFiles
      .filter(ctx => {
        const contextDir = ctx.path.substring(0, ctx.path.lastIndexOf('/')) || '/';
        if (contextDir === '/') return normalizedPath.startsWith('/') && normalizedPath !== '/';
        return normalizedPath.startsWith(contextDir + '/') || normalizedPath === contextDir;
      })
      .sort((a, b) => {
        const da = (a.path.match(/\//g) || []).length;
        const db = (b.path.match(/\//g) || []).length;
        return db - da;
      });

    const nearest = matching[0];
    if (!nearest) return null;

    // A chain of '*' whitelists all the way to the root means "expose
    // everything" — return null (unrestricted) rather than enumerating through
    // the cached connection schema, which can lag behind reality (e.g. a sheet
    // imported seconds ago whose schema refresh is still in flight).
    const { data: chainFiles } = await FilesAPI.loadFiles(matching.map((c) => c.id), user);
    const allWildcard = chainFiles.length === matching.length && chainFiles.every((f) => {
      const c = f.content as ContextContent | undefined;
      if (!c?.versions) return false;
      const published = c.versions.find((v) => v.version === getPublishedVersion(c));
      return published?.whitelist === '*';
    });
    if (allWildcard) return null;

    const contextContent = chainFiles.find((f) => f.id === nearest.id)?.content as ContextContent | undefined;
    if (!contextContent) return null;

    // childPaths filtering already happened at load time inside the context loader,
    // so this resolves the published whitelist directly.
    const databases = getWhitelistedSchemaForUser(contextContent, user.userId);
    const dbEntry = databases.find(d => d.databaseName === connectionName);
    if (!dbEntry || !dbEntry.schemas.length) return null;

    return dbEntry.schemas;
  } catch {
    return null; // On any error, allow through — don't block execution over a lookup failure
  }
}

/**
 * Convenience wrapper for MCP / server-initiated queries where there is no
 * specific file path.  Uses the user's effective home folder as the lookup
 * path, matching the same context that `buildServerAgentArgs` would select.
 */
export async function getWhitelistForUser(
  connectionName: string,
  user: EffectiveUser
): Promise<WhitelistSchema | null> {
  const homeFolder = resolveHomeFolderSync(user.mode, user.home_folder || '');
  return getWhitelistForPath(homeFolder, connectionName, user);
}
