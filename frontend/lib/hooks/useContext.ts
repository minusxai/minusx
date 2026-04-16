import { useMemo } from 'react';
import { useAppSelector } from '@/store/hooks';
import { selectContextFromPath } from '@/store/filesSlice';
import { useFile } from './file-state-hooks';
import { useConnections } from './useConnections';
import { ContextContent, ContextInfo } from '@/lib/types';
import { getWhitelistedSchemaForUser, getDocumentationForUser, applyWhitelistToConnections } from '@/lib/sql/schema-filter';
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
export function useContext(path: string, version?: number, isFolderScope?: boolean): ContextInfo {
  // 1. Find context file for this path (selector finds nearest ancestor)
  const contextFile = useAppSelector(state => selectContextFromPath(state, path));

  // 2. Load context content if we have a context file
  //    useFile handles caching, loading states, and triggering fetches
  const loadedContext = useFile(contextFile?.id, { skip: !contextFile })?.fileState;
  const contextLoading = contextFile ? (!loadedContext || loadedContext.loading) : false;

  // 3. Always load connections — used as fallback when context is absent, loading, or has no databases.
  //    Connections are TTL-cached (10hr) and already in Redux after first load, so this is cheap.
  const { connections: connectionsMap, loading: connectionsLoading } = useConnections();

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
          // Apply this version's whitelist to fullSchema
          // Note: fullSchema contains the published version's schema; version override
          // applies the requested version's whitelist on top of that.
          const databases = applyWhitelistToConnections(
            contextContent.fullSchema || [],
            effectiveVersionContent.whitelist
          );

          // Combine inherited docs (fullDocs) + own docs from this version, excluding drafts
          const inheritedDocStrings = (contextContent.fullDocs || [])
            .filter(doc => typeof doc === 'string' || doc.draft !== true)
            .map(doc => typeof doc === 'string' ? doc : doc.content);
          const ownDocStrings = (effectiveVersionContent.docs || [])
            .filter(doc => typeof doc === 'string' || doc.draft !== true)
            .map(doc => typeof doc === 'string' ? doc : doc.content);
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
      // Both files and folders apply childPaths scoping.
      // Files use their parent directory as the scope path.
      const contextDir = contextFile?.path.substring(0, contextFile.path.lastIndexOf('/')) || '/';
      const scopePath = isFolderScope
        ? path
        : path.substring(0, path.lastIndexOf('/')) || '/';
      const databases = getWhitelistedSchemaForUser(contextContent, currentUser.id, scopePath, contextDir);
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
  }, [loadedContext, connectionsMap, contextLoading, connectionsLoading, currentUser, version, path, isFolderScope, contextFile]);

  return contextInfo;
}
