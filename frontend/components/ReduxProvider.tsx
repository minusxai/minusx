'use client';

import { Provider } from 'react-redux';
import { makeStore } from '@/store/store';
import { useRef } from 'react';

interface ReduxProviderProps {
  children: React.ReactNode;
  preloadedState?: any;  // SSR preloaded state
}

export default function ReduxProvider({ children, preloadedState }: ReduxProviderProps) {
  // Create store once with preloadedState (lazy initialization)
  const storeRef = useRef<ReturnType<typeof makeStore> | null>(null);
  if (!storeRef.current) {
    storeRef.current = makeStore(preloadedState);
  }

  return (
    <Provider store={storeRef.current}>
      {children}
    </Provider>
  );
}
