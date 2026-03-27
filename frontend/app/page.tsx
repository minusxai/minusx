'use client';

import { useEffect, useMemo } from 'react';
import { useRouter } from '@/lib/navigation/use-navigation';
import { useAppSelector } from '@/store/hooks';
import { isAdmin } from '@/lib/auth/role-helpers';
import { resolveHomeFolderSync } from '@/lib/mode/path-resolver';
import { useConnections } from '@/lib/hooks/useConnections';
import { useContexts } from '@/lib/hooks/useContexts';
import { detectOnboardingState } from '@/app/hello-world/onboarding-state';

/**
 * Home Page (/)
 *
 * Redirect logic exists in BOTH places:
 * 1. middleware.ts - Handles server-side/initial page loads (fast!)
 * 2. This component - Handles client-side navigation (router.push('/'), <Link href="/" />)
 *
 * Both are necessary because middleware doesn't run on client-side navigation.
 * Onboarding detection logic lives in onboarding-state.ts.
 */
export default function Home() {
  const router = useRouter();
  const user = useAppSelector(state => state.auth.user);
  const { connections, loading: connectionsLoading } = useConnections({ skip: false });
  const { contexts, loading: contextsLoading } = useContexts({ skip: false });

  // Adapt Redux connections shape to the { id, name }[] that detectOnboardingState expects
  const connectionList = useMemo(() =>
    Object.entries(connections).map(([name, conn]) => ({ id: 0, name })),
    [connections]
  );

  useEffect(() => {
    if (!user || connectionsLoading || contextsLoading) return;

    const effectiveMode = user.mode || 'org';

    // Onboarding check (org mode only)
    if (effectiveMode === 'org') {
      const { needsOnboarding, redirectPath } = detectOnboardingState(connectionList, contexts);
      if (needsOnboarding && redirectPath) {
        router.replace(redirectPath);
        return;
      }
    }

    // Normal home redirect
    let homeHref: string;
    if (user.role && isAdmin(user.role)) {
      homeHref = `/p/${effectiveMode}`;
    } else {
      const resolvedHomeFolder = resolveHomeFolderSync(user.mode, user.home_folder || '');
      homeHref = `/p${resolvedHomeFolder}`;
    }

    router.replace(homeHref);
  }, [user, router, connectionList, connectionsLoading, contexts, contextsLoading]);

  return null;
}
