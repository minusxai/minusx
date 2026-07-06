'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useDispatch } from 'react-redux';
import { setAuthLoading, clearUser } from '@/store/authSlice';
import { CURRENT_TOKEN_VERSION } from '@/lib/auth/auth-constants';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { data: session, status, update: updateSession } = useSession();
  const dispatch = useDispatch();

  // Handle auth loading state and token refresh
  useEffect(() => {
    const handleAuthState = async () => {
      // Set loading state
      if (status === 'loading') {
        dispatch(setAuthLoading(true));
        return;
      }

      // Clear user if not authenticated
      if (status !== 'authenticated' || !session?.user) {
        dispatch(clearUser());
        return;
      }

      // Auto-refresh token if outdated
      if (!session.user.tokenVersion || session.user.tokenVersion < CURRENT_TOKEN_VERSION) {
        console.log('[AuthProvider] Token outdated, triggering refresh...');
        try {
          await updateSession({ refreshToken: true });
          console.log('[AuthProvider] Token refresh triggered');
          // After refresh, this effect will re-run with updated session
          return;
        } catch (error) {
          console.error('[AuthProvider] Failed to refresh token:', error);
        }
      }

      // User data is always preloaded from layout.tsx after page reload
      // (login, impersonation start/stop all trigger page reload)
      console.log('[AuthProvider] Session active, user preloaded from server');
    };

    handleAuthState();
  }, [session, status, dispatch, updateSession]);

  return <>{children}</>;
}
