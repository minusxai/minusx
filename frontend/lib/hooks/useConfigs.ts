import { useEffect, useState } from 'react';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { getStore } from '@/store/store';
import { CompanyConfig } from '@/lib/branding/whitelabel';
import { selectConfig, selectConfigsLoaded, setConfigs } from '@/store/configsSlice';
import { fetchWithCache } from '@/lib/api/fetch-wrapper';

/**
 * Fetch the latest config from the server and update Redux.
 * Call this after saving config changes to reflect them immediately.
 */
export async function reloadConfigs(): Promise<void> {
  const response = await fetchWithCache<{ success: boolean; data: { config: CompanyConfig } }>(
    '/api/configs', { method: 'GET', skipCache: true }
  );
  if (response.data?.config) {
    getStore().dispatch(setConfigs({ config: response.data.config }));
  }
}

export interface UseConfigsOptions {
  skip?: boolean;
}

export function useConfigs(options: UseConfigsOptions = {}): {
  config: CompanyConfig;
  loading: boolean;
} {
  const { skip = false } = options;
  const dispatch = useAppDispatch();

  const config = useAppSelector(selectConfig);  // Always valid (never null)
  const configsLoaded = useAppSelector(selectConfigsLoaded);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (skip || configsLoaded) {
      return;
    }

    // Fetch configs from API if not SSR'd (rare)
    const fetchConfigs = async () => {
      setLoading(true);
      try {
        await reloadConfigs();
      } catch (error) {
        console.error('[useConfigs] Error fetching configs:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchConfigs();
  }, [skip, configsLoaded, dispatch]);

  return {
    config,  // Always valid, no fallback needed
    loading,
  };
}
