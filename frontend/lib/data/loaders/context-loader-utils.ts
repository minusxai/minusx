/**
 * Context Loader Utilities
 * Reusable functions for computing context schemas
 * Used by both context loader and file template generation
 */

import { DatabaseWithSchema, ContextVersion, DatabaseContext, DbFile, DocEntry, Whitelist } from '@/lib/types';
import { EffectiveUser } from '@/lib/auth/auth-helpers';
import { FilesAPI } from '@/lib/data/files.server';
import { filterSchemaByWhitelist, applyWhitelistToConnections } from '@/lib/sql/schema-filter';
import { resolvePath } from '@/lib/mode/path-resolver';
import { getPublishedVersionForUser as getPublishedVersionForUserId } from '@/lib/context/context-utils';

/**
 * Filter doc entries by childPaths for a specific child path
 * Similar to filterSchemaByWhitelist but for docs
 */
function filterDocsByChildPaths(docs: DocEntry[], currentPath: string): DocEntry[] {
  return docs.filter(docEntry => {
    // If childPaths is undefined/null, apply to all children (backward compatible)
    // If childPaths is [] (empty array), apply to NO children (only this folder)
    if (!docEntry.childPaths) {
      return true;
    }
    if (docEntry.childPaths.length === 0) {
      return false;
    }

    // Check if currentPath matches any childPaths (exact or nested)
    return docEntry.childPaths.some(childPath =>
      currentPath === childPath || currentPath.startsWith(childPath + '/')
    );
  });
}

/**
 * Compute fullSchema and fullDocs from a Whitelist value and the context path.
 *
 * This is the new entry-point for the context loader (replaces computeSchemaFromDatabases).
 * It handles both the new Whitelist tree format ('*' | WhitelistNode[]).
 *
 * Flow:
 *   Root context (pathSegments.length === 2, e.g. /org/context):
 *     - Load all available connections
 *     - Apply own whitelist to produce fullSchema
 *
 *   Child context (pathSegments.length > 2):
 *     - Load nearest ancestor context (triggers its loader recursively)
 *     - Apply ancestor's published-version whitelist WITH child's contextDir
 *       to ancestor's fullSchema → "parent offering" (respects childPaths)
 *     - Apply own whitelist to the parent offering → fullSchema
 *
 * @param whitelist   - The context's own whitelist ('*' or node array)
 * @param contextPath - Full path to context file (e.g., /org/sales/context)
 * @param user        - Effective user for permissions
 */
export async function computeSchemaFromWhitelist(
  whitelist: Whitelist,
  contextPath: string,
  user: EffectiveUser
): Promise<{ fullSchema: DatabaseWithSchema[], fullDocs: DocEntry[] }> {
  const contextDir = contextPath.substring(0, contextPath.lastIndexOf('/')) || '/';
  const pathSegments = contextPath.split('/').filter(Boolean);
  const isRoot = pathSegments.length === 2; // e.g., /org/context

  if (isRoot) {
    // Root: Load all connections and apply own whitelist
    const allConnections = await loadAllConnectionsAsSchema(user);

    // Apply own whitelist (no currentPath for root — childPaths has no effect at root level)
    const fullSchema = applyWhitelistToConnections(allConnections, whitelist);
    return { fullSchema, fullDocs: [] };
  }

  // Child: Find nearest ancestor context
  const { data: allContexts } = await FilesAPI.getFiles(
    { paths: ['/'], type: 'context', depth: -1 },
    user
  );

  const ancestorContext = findNearestAncestorContext(contextPath, allContexts);

  if (!ancestorContext) {
    // No ancestor found — nothing to inherit
    return { fullSchema: [], fullDocs: [] };
  }

  // Load ancestor (triggers its own loader recursively)
  const { data: loadedAncestors } = await FilesAPI.loadFiles([ancestorContext.id], user);
  const ancestorContent = loadedAncestors[0].content as any;

  // Get ancestor's published version to access its whitelist (with childPaths)
  const publishedVersionNum = getPublishedVersionForUserId(ancestorContent, user.userId);
  const publishedVersion = ancestorContent.versions?.find(
    (v: ContextVersion) => v.version === publishedVersionNum
  );

  if (!publishedVersion) {
    return { fullSchema: [], fullDocs: [] };
  }

  // The ancestor's fullSchema is what the ancestor exposes (already filtered by its own whitelist).
  // Apply the ancestor's whitelist WITH currentPath = this context's directory to filter
  // by childPaths restrictions (tables/schemas restricted to specific sub-paths).
  const ancestorFullSchema: DatabaseWithSchema[] = ancestorContent.fullSchema || [];
  const parentOffering = applyWhitelistToConnections(
    ancestorFullSchema,
    publishedVersion.whitelist,
    contextDir
  );

  // Apply own whitelist to the parent's offering
  const fullSchema = applyWhitelistToConnections(parentOffering, whitelist);

  // Accumulate parent's fullDocs + parent's own docs, both filtered by childPaths
  const parentFullDocs = filterDocsByChildPaths(ancestorContent.fullDocs || [], contextDir);
  const parentOwnDocs = filterDocsByChildPaths(publishedVersion.docs || [], contextDir);
  const fullDocs = [...parentFullDocs, ...parentOwnDocs];

  return { fullSchema, fullDocs };
}

/**
 * Load all available connections and return as DatabaseWithSchema[].
 */
async function loadAllConnectionsAsSchema(user: EffectiveUser): Promise<DatabaseWithSchema[]> {
  const databaseFolder = resolvePath(user.mode, '/database');
  const { data: connections } = await FilesAPI.getFiles(
    { paths: [databaseFolder], type: 'connection', depth: 1 },
    user
  );

  const { data: loadedConnections } = await FilesAPI.loadFiles(
    connections.map(c => c.id),
    user
  );

  return loadedConnections.map(conn => ({
    databaseName: conn.name,
    schemas: (conn.content as any)?.schema?.schemas || [],
    updated_at: (conn.content as any)?.schema?.updated_at,
  }));
}

/**
 * Find nearest ancestor context by walking up the directory tree
 * @param currentPath - Full path to current context file
 * @param allContexts - Array of all context file metadata in the system
 * @returns Nearest ancestor context file metadata or null if none found
 */
export function findNearestAncestorContext(currentPath: string, allContexts: any[]): any | null {
  const segments = currentPath.split('/').filter(Boolean);
  segments.pop(); // Remove current file name

  while (segments.length > 0) {
    segments.pop();
    const ancestorDir = '/' + segments.join('/');

    const found = allContexts.find(c => {
      if (c.type !== 'context') return false;

      const relativePath = c.path.substring(ancestorDir.length);
      if (!relativePath.startsWith('/')) return false;

      const remainingSegments = relativePath.split('/').filter(Boolean);
      return remainingSegments.length === 1;
    });

    if (found) {
      return found;
    }
  }

  return null;
}
