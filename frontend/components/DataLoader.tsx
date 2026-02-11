'use client';

import { useEffect, useMemo } from 'react';
import { useAppSelector } from '@/store/hooks';
import { useConfigs } from '@/lib/hooks/useConfigs';
import { useConnections } from '@/lib/hooks/useConnections';
import { useContexts } from '@/lib/hooks/useContexts';

/**
 * DataLoader Component
 *
 * Invisible component that triggers client-side loading of core resources:
 * - Configs (company branding, settings)
 * - Contexts (all context metadata + home context fully loaded)
 * - Connections (all connections with schemas)
 *
 * Runs once on mount, checks if data is already present in Redux.
 * If missing, triggers parallel fetch using custom hooks.
 *
 * This component has no UI - it's pure data orchestration.
 */
export function DataLoader() {
  const user = useAppSelector(state => state.auth.user);
  const configsLoaded = useAppSelector(state => state.configs.loadedAt !== null);

  // Check if any connection/context is loaded (optimized to avoid Object.values on every render)
  const files = useAppSelector(state => state.files.files);
  const connectionsLoaded = useMemo(
    () => Object.values(files).some(f => f.type === 'connection' && f.content !== null),
    [files]
  );
  const contextsLoaded = useMemo(
    () => Object.values(files).some(f => f.type === 'context'),
    [files]
  );

  // All resources have client-side fallback
  const skipConfigs = !user || configsLoaded;
  const skipConnections = !user || connectionsLoaded;
  const skipContexts = !user || contextsLoaded;

  // Hooks will automatically fetch if skip=false
  useConfigs({ skip: skipConfigs });
  useConnections({ skip: skipConnections });
  useContexts({ skip: skipContexts });

  // Log loading status
  useEffect(() => {
    if (!user) {
      console.log('[DataLoader] No user, skipping data load');
      return;
    }

    if (!skipConfigs || !skipConnections || !skipContexts) {
      console.log('[DataLoader] Client-side data loading triggered:', {
        configsNeeded: !skipConfigs,
        connectionsNeeded: !skipConnections,
        contextsNeeded: !skipContexts
      });
    }
  }, [user, skipConfigs, skipConnections, skipContexts]);

  return null; // No UI
}
