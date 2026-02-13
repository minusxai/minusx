import type { AnalyticsProvider, AnalyticsConfig, UserProperties, EventProperties, SessionConfig } from './types';
import { MixpanelProvider } from './providers/mixpanel';
import { NoopProvider } from './providers/noop';

class Analytics {
  private provider: AnalyticsProvider | null = null;
  private initialized = false;

  init(config: AnalyticsConfig): void {
    if (this.initialized) return;
    if (typeof window === 'undefined') return; // Client-side only

    // Select provider based on config
    if (!config.enabled || config.provider === 'noop') {
      this.provider = new NoopProvider();
      this.initialized = true;
      return;
    }

    // Initialize provider-specific implementation
    if (config.provider === 'mixpanel') {
      if (!config.mixpanel?.token) {
        console.warn('[Analytics] Provider requires token, falling back to noop');
        this.provider = new NoopProvider();
        this.initialized = true;
        return;
      }

      this.provider = new MixpanelProvider();

      try {
        this.provider.init(config.mixpanel.token, {
          debug: config.debug,
          sessionRecording: config.mixpanel.sessionRecording,
        });
        this.initialized = true;
      } catch (error) {
        console.error('[Analytics] Provider init failed:', error);
        this.provider = new NoopProvider();
        this.initialized = true;
      }
    }
  }

  identify(properties: UserProperties): void {
    if (!this.provider) return;
    try {
      this.provider.identify(properties);
    } catch (error) {
      console.error('[Analytics] identify failed:', error);
    }
  }

  captureEvent(eventName: string, properties?: EventProperties): void {
    if (!this.provider) return;
    try {
      this.provider.captureEvent(eventName, properties);
    } catch (error) {
      console.error('[Analytics] captureEvent failed:', error);
    }
  }

  startSession(config?: SessionConfig): void {
    if (!this.provider?.startSession) return;
    try {
      this.provider.startSession(config);
    } catch (error) {
      console.error('[Analytics] startSession failed:', error);
    }
  }

  stopSession(): void {
    if (!this.provider?.stopSession) return;
    try {
      this.provider.stopSession();
    } catch (error) {
      console.error('[Analytics] stopSession failed:', error);
    }
  }

  reset(): void {
    if (!this.provider) return;
    try {
      this.provider.reset();
    } catch (error) {
      console.error('[Analytics] reset failed:', error);
    }
  }
}

export const analytics = new Analytics();
