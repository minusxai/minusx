import { useCallback } from 'react';
import { analytics } from '@/lib/analytics';
import type { EventProperties } from '@/lib/analytics/types';

export function useAnalytics() {
  const trackEvent = useCallback((eventName: string, properties?: EventProperties) => {
    analytics.captureEvent(eventName, properties);
  }, []);

  const startSession = useCallback(() => {
    analytics.startSession();
  }, []);

  const stopSession = useCallback(() => {
    analytics.stopSession();
  }, []);

  return { trackEvent, startSession, stopSession };
}
