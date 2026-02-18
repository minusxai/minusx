'use client';

import { Provider } from 'react-redux';
import { getOrCreateStore } from '@/store/store';
import { useRef } from 'react';

interface ReduxProviderProps {
  children: React.ReactNode;
  preloadedState?: any;  // SSR preloaded state
}

export default function ReduxProvider({ children, preloadedState }: ReduxProviderProps) {
  // Create store once with preloadedState on first mount
  // Subsequent mounts reuse the same store (singleton pattern)
  const storeRef = useRef(getOrCreateStore(preloadedState));

  return (
    <Provider store={storeRef.current}>
      {children}
    </Provider>
  );
}
