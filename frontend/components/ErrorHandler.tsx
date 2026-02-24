'use client';

import { useEffect } from 'react';
import { showAdminToast } from '@/lib/utils/toast-helpers';

/**
 * Global error handler that catches browser-level errors that escape React error boundaries
 * - Unhandled exceptions (window.error)
 * - Unhandled promise rejections (window.unhandledrejection)
 *
 * Toast notifications are only shown to admin users.
 */
export function GlobalErrorHandler() {
  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      // ResizeObserver loop errors are benign (browser fires them during layout shifts)
      if (event.message?.includes('ResizeObserver')) return;

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
