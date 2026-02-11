/**
 * Custom useRouter hook that automatically preserves `as_user` and `mode` parameters
 *
 * This hook wraps Next.js's useRouter and ensures that both impersonation
 * and mode parameters are preserved across client-side navigation.
 */

'use client';

import { useRouter as useNextRouter } from 'next/navigation';
import { useCallback } from 'react';
import { preserveParams } from './url-utils';

/**
 * Enhanced router hook with automatic parameter preservation
 * @returns Router instance with wrapped push/replace methods
 */
type NextRouter = ReturnType<typeof useNextRouter>

let _router: NextRouter | null = null

function setRouter(router: NextRouter) {
  _router = router
}

export function useRouter() {
  const router = useNextRouter();

  const push = useCallback(
    (href: string, options?: any) => {
      const preservedHref = preserveParams(href);
      return router.push(preservedHref, options);
    },
    [router]
  );

  const replace = useCallback(
    (href: string, options?: any) => {
      const preservedHref = preserveParams(href);
      return router.replace(preservedHref, options);
    },
    [router]
  );

  const updatedRouter = {
    ...router,
    push,
    replace,
  };
  setRouter(updatedRouter)
  return updatedRouter
}

export function getRouter() {
  return _router
}