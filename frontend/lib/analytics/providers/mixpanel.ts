import mixpanel from 'mixpanel-browser';
import type { AnalyticsProvider, UserProperties, EventProperties, SessionConfig } from '../types';

export class MixpanelProvider implements AnalyticsProvider {
  private initialized = false;

  init(token: string, config?: { debug?: boolean; sessionRecording?: { enabled: boolean; sampleRate: number } }): void {
    const mixpanelConfig: Record<string, any> = {
      debug: config?.debug || false,
      track_pageview: false,
      persistence: 'localStorage',
      ignore_dnt: false,
    };

    // Enable session recording if configured
    if (config?.sessionRecording?.enabled) {
      // Convert 0-1 range to 0-100 percentage (provider-specific)
      mixpanelConfig.record_sessions_percent = config.sessionRecording.sampleRate * 100;
      console.log('[Analytics] Session recording enabled:', mixpanelConfig.record_sessions_percent + '%');
    }

    mixpanel.init(token, mixpanelConfig);
    this.initialized = true;
  }

  identify(properties: UserProperties): void {
    if (!this.initialized) return;

    // Use composite key: companyId/email
    // - companyId: immutable, ensures company isolation
    // - email: human-readable, globally unique
    const distinctId = `${properties.companyId}/${properties.email}`;

    mixpanel.identify(distinctId);
    mixpanel.people.set({
      $email: properties.email,
      $name: properties.email, // Use email as display name
      userId: properties.userId,
      role: properties.role,
      companyId: properties.companyId,
      companyName: properties.companyName,
      mode: properties.mode,
      last_seen: new Date().toISOString(),
    });
  }

  captureEvent(eventName: string, properties?: EventProperties): void {
    if (!this.initialized) return;
    mixpanel.track(eventName, properties);
  }

  startSession(config?: SessionConfig): void {
    if (!this.initialized) return;
    const sampleRate = config?.sampleRate ?? 0.1;

    // Check if we should record based on sample rate
    if (Math.random() >= sampleRate) {
      return;
    }

    try {
      // Check if session recording is available (may require paid plan)
      if (typeof mixpanel.start_session_recording === 'function') {
        mixpanel.start_session_recording();
        console.log('[Analytics] Session recording started (sample rate:', sampleRate, ')');
      } else {
        console.warn('[Analytics] Session recording not available (may require paid plan)');
      }
    } catch (error) {
      console.error('[Analytics] Failed to start session recording:', error);
    }
  }

  stopSession(): void {
    if (!this.initialized) return;

    try {
      if (typeof mixpanel.stop_session_recording === 'function') {
        mixpanel.stop_session_recording();
        console.log('[Analytics] Session recording stopped');
      }
    } catch (error) {
      console.error('[Analytics] Failed to stop session recording:', error);
    }
  }

  reset(): void {
    if (!this.initialized) return;
    mixpanel.reset();
  }
}
