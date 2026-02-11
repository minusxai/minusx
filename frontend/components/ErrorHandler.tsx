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
      console.error('Unhandled error:', event.error);

      // Show toast notification (only to admins)
      showAdminToast({
        title: 'An unexpected error occurred',
        description: 'Please refresh the page if issues persist.',
        type: 'error',
        duration: 5000,
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
