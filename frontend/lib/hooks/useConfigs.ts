import { useEffect, useState } from 'react';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { CompanyConfig } from '@/lib/branding/whitelabel';
import { selectConfig, selectConfigsLoaded, setConfigs } from '@/store/configsSlice';
import { fetchWithCache } from '@/lib/api/fetch-wrapper';
import { API } from '@/lib/api/declarations';

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
        const data = await fetchWithCache('/api/configs', {
          method: 'GET',
          cacheStrategy: API.configs.get.cache,
        });
        dispatch(setConfigs({ config: data.config }));
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
