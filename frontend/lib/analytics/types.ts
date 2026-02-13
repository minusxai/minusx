export type EventProperties = Record<string, any>;

export interface UserProperties {
  userId: number;
  email: string;
  role: string;
  companyId: number;
  companyName?: string;
  mode: string;
}

export interface SessionConfig {
  sampleRate?: number;
}

/**
 * Session recording configuration
 */
export interface SessionRecordingConfig {
  enabled: boolean;
  sampleRate?: number; // 0.0 to 1.0 (default: 0.1 = 10%)
}

/**
 * Provider-specific configuration
 */
export interface MixpanelConfig {
  token: string;
  sessionRecording?: SessionRecordingConfig;
  // Future: Add more provider-specific options here
}

/**
 * Analytics configuration from environment
 */
export interface AnalyticsConfig {
  enabled: boolean;
  debug: boolean;
  provider: 'mixpanel' | 'noop';
  mixpanel?: MixpanelConfig;
  // Future: Add more providers here (e.g., posthog?: PostHogConfig)
}

/**
 * Analytics provider interface
 */
export interface AnalyticsProvider {
  init(token: string, config?: Record<string, any>): void;
  identify(properties: UserProperties): void;
  captureEvent(eventName: string, properties?: EventProperties): void;
  startSession?(config?: SessionConfig): void;
  stopSession?(): void;
  reset(): void;
}
