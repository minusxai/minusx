import { useMemo } from 'react';
import { useAppSelector } from '@/store/hooks';
import { selectContextFromPath } from '@/store/filesSlice';
import { useFile } from './file-state-hooks';
import { useConnections } from './useConnections';
import { ContextContent, ContextInfo } from '@/lib/types';
import { getWhitelistedSchemaForUser, getDocumentationForUser, filterSchemaByWhitelist } from '@/lib/sql/schema-filter';
import { getPublishedVersion } from '@/lib/context/context-utils';

/**
 * useContext Hook
 *
 * Loads context information for a given path, with automatic fallback to connections.
 * Composes core useFiles hook for loading.
 *
 * Behavior:
 * 1. Find context file for path (using selectContextFromPath)
 * 2. Load context content if found (using useFiles)
 * 3. If context exists: return whitelisted schemas + docs
 * 4. If no context: return all connection schemas + no docs
 * 5. Handle loading states throughout
 *
 * @param path - File path to find context for (e.g., '/org/sales')
 * @param version - Optional version number to use (defaults to published version)
 * @returns ContextInfo with databases, documentation, loading states
 *
 * Example:
 * ```tsx
 * function MyComponent({ filePath }: { filePath: string }) {
 *   const { databases, documentation, loading, hasContext } = useContext(filePath);
 *
 *   if (loading) return <Spinner />;
 *   return <SchemaView databases={databases} docs={documentation} />;
 * }
 *
 * // Override with specific version (admin testing)
 * const contextInfo = useContext(filePath, 3);
 * ```
 */
export function useContext(path: string, version?: number): ContextInfo {
  // 1. Find context file for this path (selector finds nearest ancestor)
  const contextFile = useAppSelector(state => selectContextFromPath(state, path));

  // 2. Load context content if we have a context file
  //    useFile handles caching, loading states, and triggering fetches
  const loadedContext = useFile(contextFile?.id, { skip: !contextFile })?.fileState;
  const contextLoading = contextFile ? (!loadedContext || loadedContext.loading) : false;

  // 3. Get connections for fallback (when no context exists)
  //    useConnections handles loading, caching, and ensures connections are available
  const { connections: connectionsMap, loading: connectionsLoading } = useConnections({
    skip: !!contextFile
  });

  // 4. Get current user for published version resolution
  const currentUser = useAppSelector(state => state.auth.user);

  // 5. Derive context info (domain logic)
  const contextInfo = useMemo((): ContextInfo => {
    const contextContent = loadedContext?.content as ContextContent | undefined;

    // If context exists and is loaded, filter by version
    if (contextContent && loadedContext && currentUser) {
      // Determine which version to use (default to published version)
      const targetVersion = version !== undefined
        ? version
        : getPublishedVersion(contextContent);

      // If version override is provided, extract schema/docs from that version directly
      if (version !== undefined && contextContent.versions) {
        const versionContent = contextContent.versions.find(v => v.version === version);

        // If version not found, fall back to published
        const effectiveVersionContent = versionContent ||
          contextContent.versions.find(v => v.version === contextContent.published.all);

        if (effectiveVersionContent) {
          // Filter fullSchema by this version's whitelist (reuse existing helper)
          const databases = effectiveVersionContent.databases.map(dbContext => {
            const availableDb = contextContent.fullSchema?.find(
              fs => fs.databaseName === dbContext.databaseName
            );
            if (!availableDb) return null;

            const filteredSchema = filterSchemaByWhitelist(
              { schemas: availableDb.schemas, updated_at: availableDb.updated_at || new Date().toISOString() },
              dbContext.whitelist
            );

            return {
              databaseName: dbContext.databaseName,
              schemas: filteredSchema.schemas
            };
          }).filter(Boolean) as Array<{ databaseName: string; schemas: any[] }>;

          // Combine inherited docs (fullDocs) + own docs from this version
          const inheritedDocStrings = (contextContent.fullDocs || []).map(doc =>
            typeof doc === 'string' ? doc : doc.content
          );
          const ownDocStrings = (effectiveVersionContent.docs || []).map(doc =>
            typeof doc === 'string' ? doc : doc.content
          );
          const allDocStrings = [...inheritedDocStrings, ...ownDocStrings].filter(Boolean);
          const documentation = allDocStrings.length > 0 ? allDocStrings.join('\n\n---\n\n') : undefined;

          return {
            contextId: loadedContext.id,
            databases,
            documentation,
            hasContext: true,
            contextLoading: contextLoading
          };
        }
      }

      // Default behavior: use published version (via existing helpers)
      const databases = getWhitelistedSchemaForUser(contextContent, currentUser.id);
      const documentation = getDocumentationForUser(contextContent, currentUser.id);

      return {
        contextId: loadedContext.id,
        databases,
        documentation,
        hasContext: true,
        contextLoading: contextLoading
      };
    }

    // Fallback to all connections (no context exists OR context not loaded yet)
    const connections = Object.values(connectionsMap);
    const databases = connections.length > 0
      ? connections.map(conn => ({
          databaseName: conn.metadata.name,
          schemas: conn.schema?.schemas || []
        }))
      : [];

    return {
      contextId: undefined,
      databases,
      documentation: undefined,
      hasContext: false,
      contextLoading: contextLoading || connectionsLoading
    };
  }, [loadedContext, connectionsMap, contextLoading, connectionsLoading, currentUser, version]);

  return contextInfo;
}
