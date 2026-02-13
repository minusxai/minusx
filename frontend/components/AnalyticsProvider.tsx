'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { analytics } from '@/lib/analytics';
import { ANALYTICS_CONFIG } from '@/lib/config';
import { useAppSelector } from '@/store/hooks';

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const user = useAppSelector(state => state.auth.user);

  // Initialize once on mount
  useEffect(() => {
    analytics.init(ANALYTICS_CONFIG);
  }, []);

  // Identify user when authenticated
  useEffect(() => {
    if (status === 'authenticated' && user) {
      // Identify user
      // Session recording starts automatically based on config during init
      analytics.identify({
        userId: user.id,
        email: user.email,
        role: user.role,
        companyId: user.companyId,
        companyName: user.companyName,
        mode: user.mode,
      });
    } else if (status === 'unauthenticated') {
      // Reset analytics on sign out
      analytics.reset();
    }
  }, [status, user]);

  return <>{children}</>;
}
