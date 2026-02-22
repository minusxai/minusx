'use client';

import { Suspense, useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useAppDispatch } from '@/store/hooks';
import { setNavigation } from '@/store/navigationSlice';

/**
 * NavigationSyncInner — the inner component that reads the router.
 * Must be wrapped in <Suspense> because useSearchParams() opts out of SSR.
 */
function NavigationSyncInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const dispatch = useAppDispatch();

  useEffect(() => {
    const params: Record<string, string> = {};
    searchParams.forEach((v, k) => {
      params[k] = v;
    });
    dispatch(setNavigation({ pathname, searchParams: params }));
  }, [pathname, searchParams, dispatch]);

  return null;
}

/**
 * NavigationSync — single coupling point between Next.js router and Redux.
 *
 * Reads usePathname() + useSearchParams() and dispatches setNavigation on change.
 * Everything else (file loading, virtual file creation, app state derivation)
 * happens in navigationListener + selectAppState — zero React/Next.js dependency.
 *
 * In tests / headless contexts: never mount this component; dispatch setNavigation directly.
 *
 * Place once inside <Providers>, alongside <ColorModeSync /> and <DataLoader />.
 */
export function NavigationSync() {
  return (
    <Suspense fallback={null}>
      <NavigationSyncInner />
    </Suspense>
  );
}
