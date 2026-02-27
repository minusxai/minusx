/**
 * Context Loader Utilities
 * Reusable functions for computing context schemas
 * Used by both context loader and file template generation
 */

import { DatabaseWithSchema, ContextVersion, DatabaseContext, DbFile, DocEntry } from '@/lib/types';
import { EffectiveUser } from '@/lib/auth/auth-helpers';
import { FilesAPI } from '@/lib/data/files.server';
import { filterSchemaByWhitelist } from '@/lib/sql/schema-filter';
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
 * Compute fullSchema and fullDocs from databases and docs arrays
 * Core schema computation logic shared by context loader and template generation
 *
 * @param databases - Array of database contexts (whitelist + childPaths)
 * @param contextPath - Full path to context file (e.g., /org/sales/context)
 * @param user - Effective user for permissions
 * @returns fullSchema (available schemas) and fullDocs (inherited documentation)
 */
export async function computeSchemaFromDatabases(
  databases: DatabaseContext[],
  contextPath: string,
  user: EffectiveUser
): Promise<{ fullSchema: DatabaseWithSchema[], fullDocs: DocEntry[] }> {
  // Extract path (directory containing context file) for childPaths filtering
  const path = contextPath.substring(0, contextPath.lastIndexOf('/')) || '/';
  // Detect if root (path depth 1)
  const pathSegments = contextPath.split('/').filter(Boolean);
  const isRoot = pathSegments.length === 2; // e.g., /org/context

  let fullSchema: DatabaseWithSchema[];
  let fullDocs: DocEntry[];

  if (isRoot) {
    // Root: Load all connections and merge schemas
    const databaseFolder = resolvePath(user.mode, '/database');
    const { data: connections } = await FilesAPI.getFiles(
      { paths: [databaseFolder], type: 'connection', depth: 1 },
      user
    );

    // Load full connection content (triggers connection loaders)
    const { data: loadedConnections } = await FilesAPI.loadFiles(
      connections.map(c => c.id),
      user
    );

    // Merge ALL connection schemas into fullSchema (unfiltered)
    // fullSchema represents what's AVAILABLE to whitelist, not what's whitelisted
    fullSchema = loadedConnections.map(conn => ({
      databaseName: conn.name,
      schemas: (conn.content as any)?.schema?.schemas || []
    }));

    fullDocs = [];
  } else {
    // Child: Find nearest ancestor context
    const { data: allContexts } = await FilesAPI.getFiles(
      { paths: ['/'], type: 'context', depth: -1 },
      user
    );

    const ancestorContext = findNearestAncestorContext(contextPath, allContexts);

    if (!ancestorContext) {
      // No ancestor found - treat as root
      fullSchema = [];
      fullDocs = [];
    } else {
      // Load ancestor context (triggers its loader recursively)
      // Parent's loader will compute fullSchema based on parent's published version for this user
      const { data: loadedAncestors } = await FilesAPI.loadFiles([ancestorContext.id], user);
      const ancestorContent = loadedAncestors[0].content as any;

      // Get parent's published version to access parent's whitelist (which has childPaths)
      const publishedVersionNum = getPublishedVersionForUserId(ancestorContent, user.userId);
      const publishedVersion = ancestorContent.versions?.find((v: ContextVersion) => v.version === publishedVersionNum);

      if (!publishedVersion) {
        fullSchema = [];
        fullDocs = [];
      } else {
        // Filter parent's fullSchema by PARENT's whitelist with childPaths checking
        fullSchema = publishedVersion.databases.map((parentDbContext: DatabaseContext) => {
          const parentDb = ancestorContent.fullSchema?.find(
            (fs: DatabaseWithSchema) => fs.databaseName === parentDbContext.databaseName
          );
          if (!parentDb) return null;

          // Filter by PARENT's whitelist (which has childPaths restrictions)
          const filteredSchema = filterSchemaByWhitelist(
            { schemas: parentDb.schemas, updated_at: parentDb.updated_at },
            parentDbContext.whitelist,  // Parent's whitelist (has childPaths!)
            path  // Child's path for childPaths checking
          );

          return {
            databaseName: parentDbContext.databaseName,
            schemas: filteredSchema.schemas
          };
        }).filter(Boolean) as DatabaseWithSchema[];

        // Accumulate parent's fullDocs + parent's own docs, both filtered by childPaths
        const parentFullDocs = filterDocsByChildPaths(ancestorContent.fullDocs || [], path);
        const parentOwnDocs = filterDocsByChildPaths(publishedVersion.docs || [], path);
        fullDocs = [...parentFullDocs, ...parentOwnDocs];
      }
    }
  }

  return { fullSchema, fullDocs };
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
