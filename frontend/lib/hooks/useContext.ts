import { useEffect, useMemo, useState } from 'react';
import { useAppSelector } from '@/store/hooks';
import { selectContextFromPath } from '@/store/filesSlice';
import { useFile } from './file-state-hooks';
import { useConnections } from './useConnections';
import { ContextContent, ContextInfo, SkillMention } from '@/lib/types';
import { getWhitelistedSchemaForUser, resolveContextDocs } from '@/lib/sql/schema-filter';
import { mergeSkillsByName } from '@/lib/context/context-utils';

let cachedSystemSkills: SkillMention[] | null = null;
let systemSkillsRequest: Promise<SkillMention[]> | null = null;

function loadSystemSkills(): Promise<SkillMention[]> {
  if (cachedSystemSkills) {
    return Promise.resolve(cachedSystemSkills);
  }
  if (!systemSkillsRequest) {
    systemSkillsRequest = fetch('/api/skills/system')
      .then(res => res.ok ? res.json() : null)
      .then(json => {
        const skills: SkillMention[] = json?.success && Array.isArray(json.data)
          ? json.data.map((skill: { name: string; description?: string }) => ({
              type: 'skill' as const,
              source: 'system' as const,
              name: skill.name,
              description: skill.description,
            }))
          : [];
        cachedSystemSkills = skills;
        return skills;
      })
      .catch(() => {
        cachedSystemSkills = [];
        return [];
      });
  }
  return systemSkillsRequest;
}

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
 * @returns ContextInfo with databases, resolved context docs, loading states
 *
 * Example:
 * ```tsx
 * function MyComponent({ filePath }: { filePath: string }) {
 *   const { databases, contextDocs, loading, hasContext } = useContext(filePath);
 *
 *   if (loading) return <Spinner />;
 *   return <SchemaView databases={databases} docs={contextDocs} />;
 * }
 *
 * // Override with specific version (admin testing)
 * const contextInfo = useContext(filePath, 3);
 * ```
 */
export function useContext(path: string, version?: number, isFolderScope?: boolean): ContextInfo {
  const [systemSkills, setSystemSkills] = useState<SkillMention[]>(cachedSystemSkills || []);

  useEffect(() => {
    let cancelled = false;
    loadSystemSkills().then(skills => {
      if (!cancelled) {
        setSystemSkills(skills);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
    const toAvailableSkills = (skills: NonNullable<ContextContent['skills']>): SkillMention[] => [
      ...skills
        .filter(skill => skill.enabled)
        .map(skill => ({
          type: 'skill' as const,
          source: 'user' as const,
          name: skill.name,
          description: skill.description,
          content: skill.content,
        })),
      ...systemSkills,
    ];

    // If context exists and is loaded, resolve via the SHARED resolvers — the same
    // resolveContextDocs / getWhitelistedSchemaForUser the server uses to build the
    // agent prompt — so the docs sidebar and the agent always agree. `version`
    // selects an admin-tested version; undefined uses the user's published version.
    if (contextContent && loadedContext && currentUser) {
      const databases = getWhitelistedSchemaForUser(contextContent, currentUser.id, version);
      const resolvedDocs = resolveContextDocs(contextContent, currentUser.id, version);
      const skills = mergeSkillsByName(contextContent.fullSkills || [], contextContent.skills || []);

      return {
        contextId: loadedContext.id,
        databases,
        contextDocs: resolvedDocs,
        skills,
        availableSkills: toAvailableSkills(skills),
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
      contextDocs: undefined,
      skills: [],
      availableSkills: systemSkills,
      hasContext: false,
      contextLoading: contextLoading || connectionsLoading
    };
  }, [loadedContext, connectionsMap, contextLoading, connectionsLoading, currentUser, version, path, isFolderScope, contextFile, systemSkills]);

  return contextInfo;
}
