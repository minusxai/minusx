'use client';

import { Provider } from 'react-redux';
import { getOrCreateStore } from '@/store/store';
import { E2E_MODE } from '@/lib/constants';
import { useEffect, useRef } from 'react';

interface ReduxProviderProps {
  children: React.ReactNode;
  preloadedState?: any;  // SSR preloaded state
}

export default function ReduxProvider({ children, preloadedState }: ReduxProviderProps) {
  // Create store once with preloadedState on first mount
  // Subsequent mounts reuse the same store (singleton pattern)
  const storeRef = useRef(getOrCreateStore(preloadedState));

  // E2E only: expose the store so Playwright can read state via
  // `window.__MX_STORE__.getState()`. Reads are safe (dispatch only mutates
  // client state, which server auth still guards); gated so it never ships to prod.
  useEffect(() => {
    if (E2E_MODE) {
      (window as unknown as { __MX_STORE__?: unknown }).__MX_STORE__ = storeRef.current;
    }
  }, []);

  return (
    // eslint-disable-next-line react-hooks/refs
    <Provider store={storeRef.current}>
      {children}
    </Provider>
  );
}
