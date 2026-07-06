'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { analytics } from '@/lib/analytics';
import { parseAnalyticsConfig } from '@/lib/constants';
import { useAppSelector } from '@/store/hooks';
import { selectConfig } from '@/store/configsSlice';
import type { AnalyticsConfig } from '@/lib/analytics/types';

const DISABLED_CONFIG: AnalyticsConfig = parseAnalyticsConfig(undefined);

export function AnalyticsProvider({ children, config }: { children: React.ReactNode; config?: AnalyticsConfig }) {
  const { status } = useSession();
  const user = useAppSelector(state => state.auth.user);
  const analyticsEnabled = useAppSelector(state => selectConfig(state).analytics?.enabled ?? true);

  useEffect(() => {
    const resolved = config ?? DISABLED_CONFIG;
    analytics.init(analyticsEnabled ? resolved : { ...resolved, enabled: false });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Identify user when authenticated
  useEffect(() => {
    if (status === 'authenticated' && user) {
      // Identify user
      // Session recording starts automatically based on config during init
      analytics.identify({
        userId: user.id,
        email: user.email,
        role: user.role,
        mode: user.mode,
      });
    } else if (status === 'unauthenticated') {
      // Reset analytics on sign out
      analytics.reset();
    }
  }, [status, user]);

  return <>{children}</>;
}
