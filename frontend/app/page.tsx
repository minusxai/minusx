'use client';

import { useEffect } from 'react';
import { useRouter } from '@/lib/navigation/use-navigation';
import { useAppSelector } from '@/store/hooks';
import { isAdmin } from '@/lib/auth/role-helpers';
import { resolveHomeFolderSync } from '@/lib/mode/path-resolver';
import { useConfigs } from '@/lib/hooks/useConfigs';

/**
 * Home Page (/)
 *
 * Redirect logic exists in BOTH places:
 * 1. middleware.ts - Handles server-side/initial page loads (fast!)
 * 2. This component - Handles client-side navigation (router.push('/'), <Link href="/" />)
 *
 * Both are necessary because middleware doesn't run on client-side navigation.
 * Onboarding completion state is read from the config document (setupWizard.status).
 */
export default function Home() {
  const router = useRouter();
  const user = useAppSelector(state => state.auth.user);
  const { config, loading: configLoading } = useConfigs();

  const homeFolder = user ? resolveHomeFolderSync(user.mode, user.home_folder || '') : '/org';

  useEffect(() => {
    if (!user || configLoading) return;

    const effectiveMode = user.mode || 'org';

    // Onboarding check — config-driven, applies to any mode.
    // Tutorial/internals default to 'complete' so they never redirect.
    if (config.setupWizard?.status !== 'complete') {
      router.replace('/hello-world');
      return;
    }

    // Normal home redirect
    const homeHref = user.role && isAdmin(user.role)
      ? `/p/${effectiveMode}`
      : `/p${homeFolder}`;

    router.replace(homeHref);
  }, [user, router, config, configLoading, homeFolder]);

  return null;
}
