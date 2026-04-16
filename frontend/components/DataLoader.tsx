'use client';

import { useEffect } from 'react';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { useConfigs } from '@/lib/hooks/useConfigs';
import { useConnections } from '@/lib/hooks/useConnections';
import { useContexts } from '@/lib/hooks/useContexts';
import { setBulkUiFlags } from '@/store/uiSlice';
import { selectConnectionsContentLoaded, selectContextsContentLoaded } from '@/store/filesSlice';

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
  const dispatch = useAppDispatch();
  const user = useAppSelector(state => state.auth.user);

  // Restore persisted UI flags after hydration — single dispatch avoids 3 separate re-render cycles
  useEffect(() => {
    try {
      const flags: { showDebug?: boolean; showJson?: boolean; showAdvanced?: boolean; allowChatQueue?: boolean; queueStrategy?: 'end-of-turn' | 'mid-turn'; showSuggestedQuestions?: boolean; showTrustScore?: boolean } = {};
      const debug = localStorage.getItem('showDebug');
      if (debug !== null) flags.showDebug = debug === 'true';
      const json = localStorage.getItem('showJson');
      if (json !== null) flags.showJson = json === 'true';
      const advanced = localStorage.getItem('showAdvanced');
      if (advanced !== null) flags.showAdvanced = advanced === 'true';
      const suggestedQuestions = localStorage.getItem('showSuggestedQuestions');
      if (suggestedQuestions !== null) flags.showSuggestedQuestions = suggestedQuestions === 'true';
      const trustScore = localStorage.getItem('showTrustScore');
      if (trustScore !== null) flags.showTrustScore = trustScore === 'true';
      const allowChatQueue = localStorage.getItem('allowChatQueue');
      if (allowChatQueue !== null) flags.allowChatQueue = allowChatQueue === 'true';
      const qs = localStorage.getItem('queueStrategy');
      if (qs === 'end-of-turn' || qs === 'mid-turn') flags.queueStrategy = qs;
      if (Object.keys(flags).length > 0) dispatch(setBulkUiFlags(flags));
    } catch { /* ignore */ }
  }, []);
  const configsLoaded = useAppSelector(state => state.configs.loadedAt !== null);

  // Boolean selectors: return primitives so DataLoader only re-renders when the value actually flips
  const connectionsLoaded = useAppSelector(selectConnectionsContentLoaded);
  const contextsLoaded = useAppSelector(selectContextsContentLoaded);

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
