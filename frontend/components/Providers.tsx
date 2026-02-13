'use client';

import { ChakraProvider } from '@chakra-ui/react';
import { SessionProvider } from 'next-auth/react';
import { system } from '@/lib/ui/theme';
import { AuthProvider } from './AuthProvider';
import ReduxProvider from './ReduxProvider';
import { DataLoader } from './DataLoader';
import { ColorModeSync } from './ColorModeSync';
import { NavigationGuardProvider } from '@/lib/navigation/NavigationGuardProvider';
import { AnalyticsProvider } from './AnalyticsProvider';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { CompanyConfig } from '@/lib/branding/whitelabel';
import { DEFAULT_CONFIG } from '@/lib/branding/whitelabel';

// Import fetch patch to auto-initialize (don't remove - needed for side effect)
import '@/lib/api/fetch-patch';

interface ProvidersProps {
  children: React.ReactNode;
  initialData?: {
    user: EffectiveUser | null;
    config: CompanyConfig;  // Always present (from SSR or defaults)
  };
}

export function Providers({ children, initialData }: ProvidersProps) {

  // Transform initial data to preloaded Redux state
  const preloadedState = {
    // Configs (ALWAYS present - from SSR or defaults)
    configs: {
      config: initialData?.config || DEFAULT_CONFIG,
      loadedAt: initialData?.config ? Date.now() : null,
    },

    // Auth (if user present)
    ...(initialData?.user && {
      auth: {
        user: {
          id: initialData.user.userId,
          email: initialData.user.email,
          name: initialData.user.name,
          role: initialData.user.role,
          home_folder: initialData.user.home_folder,
          companyId: initialData.user.companyId,
          companyName: initialData.user.companyName,
          mode: initialData.user.mode,
        },
        loading: false,
      }
    }),

    // Contexts and connections are now loaded client-side via hooks
  };

  return (
    <ReduxProvider preloadedState={preloadedState}>
      <SessionProvider refetchOnWindowFocus={false}>
        <ChakraProvider value={system}>
          <AuthProvider>
            <AnalyticsProvider>
              <ColorModeSync />
              <DataLoader />
              <NavigationGuardProvider>
                {children}
              </NavigationGuardProvider>
            </AnalyticsProvider>
          </AuthProvider>
        </ChakraProvider>
      </SessionProvider>
    </ReduxProvider>
  );
}
