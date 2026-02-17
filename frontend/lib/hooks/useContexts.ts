import { useMemo } from 'react';
import { useAppSelector } from '@/store/hooks';
import { useFiles } from './useFiles';
import { useFilesByCriteria } from './useFilesByCriteria';
import { resolveHomeFolderSync } from '@/lib/mode/path-resolver';
import type { DbFile } from '@/lib/types';
import type { LoadError } from '@/lib/types/errors';

/**
 * Options for useContexts hook
 */
export interface UseContextsOptions {
  ttl?: number;      // Time-to-live in ms
  skip?: boolean;    // Skip loading (for conditional use)
}

/**
 * Return type for useContexts hook
 */
export interface UseContextsReturn {
  contexts: DbFile[];     // All context metadata (partial load)
  homeContext: DbFile | undefined;  // Home context (fully loaded)
  loading: boolean;
  error: Error | LoadError | null;
}

/**
 * useContexts Hook
 *
 * Loads all contexts in user's home folder and descendants.
 * Returns:
 * - All contexts as metadata (partial: true, fast)
 * - Home folder context fully loaded (partial: false, with fullSchema/fullDocs)
 *
 * This replaces SSR loading of contexts from layout.tsx
 *
 * @param options - Hook options (ttl, skip)
 * @returns {contexts, homeContext, loading, reload}
 */
export function useContexts(options: UseContextsOptions = {}): UseContextsReturn {
  const { ttl, skip = false } = options;
  const user = useAppSelector(state => state.auth.user);

  // Calculate home folder path
  const homeFolder = user
    ? resolveHomeFolderSync(user.mode, user.home_folder || '')
    : '/org';

  // Memoize criteria to prevent unnecessary re-fetches
  const criteria = useMemo(
    () => ({ type: 'context' as const, paths: [homeFolder], depth: -1 }),
    [homeFolder]
  );

  // Load all context metadata (partial)
  const { files: allContexts, loading: metadataLoading, error: metadataError } = useFilesByCriteria({
    criteria,
    ttl,
    skip,
    partial: true  // Metadata only, fast
  });

  // Find home folder context (direct child of homeFolder)
  const homeContextMeta = useMemo(() => {
    return allContexts.find(c => {
      const relativePath = c.path.substring(homeFolder.length);
      if (!relativePath.startsWith('/')) return false;

      const remainingSegments = relativePath.split('/').filter(Boolean);
      return remainingSegments.length === 1; // Direct child
    });
  }, [allContexts, homeFolder]);

  // Fully load home context (triggers context loader for fullSchema/fullDocs)
  const { files: homeContextFiles, loading: homeContextLoading, error: homeContextError } = useFiles({
    ids: homeContextMeta ? [homeContextMeta.id] : [],
    skip: !homeContextMeta,
    ttl
  });

  return {
    contexts: allContexts,
    homeContext: homeContextFiles[0],
    loading: metadataLoading || homeContextLoading,
    error: metadataError || homeContextError
  };
}
