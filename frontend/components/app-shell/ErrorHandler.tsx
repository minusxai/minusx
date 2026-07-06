'use client';

import { useEffect } from 'react';
import { showAdminToast } from '@/lib/utils/toast-helpers';
import { isHydrationError } from '@/lib/utils/error-utils';
import { getStore } from '@/store/store';
import { selectDevMode } from '@/store/uiSlice';

/**
 * Global error handler that catches browser-level errors that escape React error boundaries
 * - Unhandled exceptions (window.error)
 * - Unhandled promise rejections (window.unhandledrejection)
 *
 * Toast notifications are only shown to admin users.
 * Hydration errors are suppressed when the "Show all error toasts" setting is OFF.
 */
export function GlobalErrorHandler() {
  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      // ResizeObserver loop errors are benign (browser fires them during layout shifts)
      if (event.message?.includes('ResizeObserver')) return;

      // Ignore errors thrown by browser extensions — they're not our code
      if (event.filename?.startsWith('chrome-extension://') || event.filename?.startsWith('moz-extension://')) return;

      const msg = event.error?.message || event.message || '';

      // React hydration errors are recoverable — React automatically re-renders on the client.
      // Suppress them unless the admin has opted into seeing all error toasts.
      const showAll = selectDevMode(getStore().getState());
      if (!showAll && isHydrationError(msg)) return;

      const errorDetail = event.error
        ? (event.error instanceof Error ? event.error.stack || event.error.message : String(event.error))
        : `${event.message || 'Unknown error'} at ${event.filename || 'unknown'}:${event.lineno}:${event.colno}`;
      console.error('Unhandled error:', errorDetail);

      // Show toast notification (only to admins)
      showAdminToast({
        title: 'An unexpected error occurred',
        description: errorDetail.slice(0, 200),
        type: 'error',
        duration: 8000,
      });
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      const msg = event.reason instanceof Error ? event.reason.message : String(event.reason ?? '');

      // Suppress hydration-related rejections unless the admin opted in
      const showAll = selectDevMode(getStore().getState());
      if (!showAll && isHydrationError(msg)) return;

      console.error('Unhandled promise rejection:', event.reason);

      // Show toast notification (only to admins)
      showAdminToast({
        title: 'An unexpected error occurred',
        description: 'Please refresh the page if issues persist.',
        type: 'error',
        duration: 5000,
      });
    };

    // Add event listeners
    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);

    // Cleanup on unmount
    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, []);

  // This component doesn't render anything
  return null;
}
