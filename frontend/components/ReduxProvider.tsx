'use client';

import { Provider } from 'react-redux';
import { makeStore } from '@/store/store';
import { useRef } from 'react';

interface ReduxProviderProps {
  children: React.ReactNode;
  preloadedState?: any;  // SSR preloaded state
}

// Export a ref to the client store so file-state.ts can use it
// This ensures editFile updates the SAME store that components subscribe to
export const clientStoreRef: { current: ReturnType<typeof makeStore> | null } = { current: null };

export default function ReduxProvider({ children, preloadedState }: ReduxProviderProps) {
  // Create store once with preloadedState (lazy initialization)
  const storeRef = useRef<ReturnType<typeof makeStore> | null>(null);
  if (!storeRef.current) {
    storeRef.current = makeStore(preloadedState);
    // Update the shared ref so file-state.ts can access it
    clientStoreRef.current = storeRef.current;
  }

  return (
    <Provider store={storeRef.current}>
      {children}
    </Provider>
  );
}
