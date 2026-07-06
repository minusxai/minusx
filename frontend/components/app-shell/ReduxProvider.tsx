'use client';

import { Provider } from 'react-redux';
import { getOrCreateStore } from '@/store/store';
import { E2E_MODE } from '@/lib/constants';
import { useEffect, useRef } from 'react';

interface ReduxProviderProps {
  children: React.ReactNode;
  preloadedState?: any;  // SSR preloaded state
  e2eEnabled?: boolean;  // QA runtime opt-in (?e2e=<secret>) — exposes store on a prod build
}

export default function ReduxProvider({ children, preloadedState, e2eEnabled }: ReduxProviderProps) {
  // Create store once with preloadedState on first mount
  // Subsequent mounts reuse the same store (singleton pattern)
  const storeRef = useRef(getOrCreateStore(preloadedState));

  // Expose the store so Playwright can read state via `window.__MX_STORE__.getState()`.
  // Enabled by the build-time E2E flag (local/CI) OR the runtime QA opt-in (prod via
  // ?e2e=<secret>). Reads only — dispatch mutates client state, which server auth still guards.
  useEffect(() => {
    if (E2E_MODE || e2eEnabled) {
      (window as unknown as { __MX_STORE__?: unknown }).__MX_STORE__ = storeRef.current;
    }
  }, [e2eEnabled]);

  return (
    // eslint-disable-next-line react-hooks/refs
    <Provider store={storeRef.current}>
      {children}
    </Provider>
  );
}
