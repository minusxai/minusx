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
import { resolvePath, resolveHomeFolderSync } from '@/lib/mode/path-resolver';

export type WhitelistSchema = Array<{ schema: string; tables: Array<{ table: string }> }>;

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
 * @param user           - Effective user (supplies companyId and mode).
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

    const result = await FilesAPI.loadFile(nearest.id, user);
    const contextContent = result.data?.content as ContextContent | undefined;
    if (!contextContent) return null;

    const contextDir = nearest.path.substring(0, nearest.path.lastIndexOf('/')) || '/';
    const databases = getWhitelistedSchemaForUser(contextContent, user.userId, normalizedPath, contextDir);
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
