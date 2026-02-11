'use client';

import { useEffect } from 'react';
import { useRouter } from '@/lib/navigation/use-navigation';
import { useAppSelector } from '@/store/hooks';
import { isAdmin } from '@/lib/auth/role-helpers';
import { resolveHomeFolderSync } from '@/lib/mode/path-resolver';

/**
 * Home Page (/)
 *
 * Redirect logic exists in BOTH places:
 * 1. middleware.ts - Handles server-side/initial page loads (fast!)
 * 2. This component - Handles client-side navigation (router.push('/'), <Link href="/" />)
 *
 * Both are necessary because middleware doesn't run on client-side navigation.
 */
export default function Home() {
  const router = useRouter();
  const user = useAppSelector(state => state.auth.user);

  useEffect(() => {
    if (!user) return;

    // Redirect to home page based on user role
    let homeHref: string;
    if (user.role && isAdmin(user.role)) {
      homeHref = `/p/${user.mode || 'org'}`;
    } else {
      const resolvedHomeFolder = resolveHomeFolderSync(user.mode, user.home_folder || '');
      homeHref = `/p${resolvedHomeFolder}`;
    }

    router.replace(homeHref);
  }, [user, router]);

  // Don't render anything while redirecting
  return null;
}
