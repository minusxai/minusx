/**
 * Client-safe environment constants (available in both browser and server).
 * Only NEXT_PUBLIC_* vars and NODE_ENV belong here.
 * For server-only secrets and server-side vars, use lib/config.ts instead.
 */
import type { AnalyticsConfig } from './analytics/types';

export const IS_DEV = process.env.NODE_ENV !== 'production';
export const IS_TEST = process.env.NODE_ENV === 'test';

export const APP_VERSION = '0.1.0';

/**
 * Git commit SHA — embedded at build time by next.config.ts (via env: { GIT_COMMIT_SHA }).
 * Available on both client and server. Falls back to 'unknown' if not set.
 */
export const GIT_COMMIT_SHA = process.env.GIT_COMMIT_SHA ?? 'unknown';

function parseAnalyticsConfig(jsonString: string | undefined): AnalyticsConfig {
  const defaultConfig: AnalyticsConfig = { enabled: false, debug: false, provider: 'noop' };

  if (!jsonString || jsonString.trim() === '') return defaultConfig;

  try {
    const parsed = JSON.parse(jsonString) as Partial<AnalyticsConfig>;

    if (typeof parsed.enabled !== 'boolean') {
      console.warn('[Config] ANALYTICS_CONFIG.enabled must be boolean, using default');
      return defaultConfig;
    }
    if (parsed.provider && !['mixpanel', 'noop'].includes(parsed.provider)) {
      console.warn(`[Config] Unknown analytics provider: ${parsed.provider}, using noop`);
      return { ...defaultConfig, enabled: parsed.enabled };
    }
    if (parsed.provider === 'mixpanel') {
      if (!parsed.mixpanel?.token) {
        console.warn('[Config] Analytics provider requires token, falling back to noop');
        return { ...defaultConfig, enabled: false };
      }
      const sessionRecordingConfig = parsed.mixpanel.sessionRecording
        ? {
            enabled: parsed.mixpanel.sessionRecording.enabled || false,
            sampleRate: parsed.mixpanel.sessionRecording.sampleRate ?? 0.1,
          }
        : { enabled: false, sampleRate: 0.1 };
      return {
        enabled: parsed.enabled,
        debug: parsed.debug || false,
        provider: 'mixpanel',
        mixpanel: { token: parsed.mixpanel.token, sessionRecording: sessionRecordingConfig },
      };
    }
    return { enabled: parsed.enabled, debug: parsed.debug || false, provider: parsed.provider || 'noop' };
  } catch (error) {
    console.error('[Config] Failed to parse ANALYTICS_CONFIG:', error);
    return defaultConfig;
  }
}

export const ANALYTICS_CONFIG = parseAnalyticsConfig(process.env.NEXT_PUBLIC_ANALYTICS_CONFIG);

export const SEND_ERRORS_IN_DEV = process.env.NEXT_PUBLIC_SEND_ERRORS_IN_DEV === 'true';

export const PROTECTED_FILE_PATHS = [
  '/config/users.yml',
] as const;

/**
 * Database adapter type — "sqlite" (default) or "postgres".
 * Not a secret; lives here so standalone scripts (create-empty-db, import-db)
 * can read it without hitting the server-only guard in lib/config.ts.
 */
export const DB_TYPE = (process.env.DB_TYPE as 'sqlite' | 'postgres') ?? 'sqlite';
