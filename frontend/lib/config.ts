/**
 * Centralized environment configuration with validation
 */

import type { AnalyticsConfig } from './analytics/types';

// Determine environment directly to avoid circular imports
const IS_DEV = process.env.NODE_ENV !== 'production';
const IS_TEST = process.env.NODE_ENV === 'test';
const IS_BROWSER = typeof window !== 'undefined';

interface EnvironmentConfig {
  BACKEND_URL: string;
  AUTH_URL: string;
  BASE_DUCKDB_DATA_PATH: string;
  NEXTAUTH_SECRET: string;
  ADMIN_PWD: string | undefined;
  ANALYTICS_CONFIG: AnalyticsConfig;
}

const errors: string[] = [];

function requireSecret(name: string, value: string | undefined): string {
  // In test mode, provide dummy values to allow tests to run
  if (IS_TEST) {
    return value || 'test-secret';
  }

  // In browser (client-side), server-only secrets won't be available - that's expected
  if (IS_BROWSER) {
    return value || '';
  }

  if (!value || value.trim() === '') {
    errors.push(`${name} is required but not set. Add it to frontend/.env`);
    return '';
  }
  return value;
}

function getOptional(value: string | undefined, defaultValue: string): string {
  return value || defaultValue;
}

function parseAnalyticsConfig(jsonString: string | undefined): AnalyticsConfig {
  // Default config (analytics disabled)
  const defaultConfig: AnalyticsConfig = {
    enabled: false,
    debug: false,
    provider: 'noop',
  };

  if (!jsonString || jsonString.trim() === '') {
    return defaultConfig;
  }

  try {
    const parsed = JSON.parse(jsonString) as Partial<AnalyticsConfig>;

    // Validate required fields
    if (typeof parsed.enabled !== 'boolean') {
      console.warn('[Config] ANALYTICS_CONFIG.enabled must be boolean, using default');
      return defaultConfig;
    }

    // Validate provider
    if (parsed.provider && !['mixpanel', 'noop'].includes(parsed.provider)) {
      console.warn(`[Config] Unknown analytics provider: ${parsed.provider}, using noop`);
      return { ...defaultConfig, enabled: parsed.enabled };
    }

    // Validate provider-specific config
    if (parsed.provider === 'mixpanel') {
      if (!parsed.mixpanel?.token) {
        console.warn('[Config] Analytics provider requires token, falling back to noop');
        return { ...defaultConfig, enabled: false };
      }

      // Add session recording defaults
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
        mixpanel: {
          token: parsed.mixpanel.token,
          sessionRecording: sessionRecordingConfig,
        },
      };
    }

    return {
      enabled: parsed.enabled,
      debug: parsed.debug || false,
      provider: parsed.provider || 'noop',
    };
  } catch (error) {
    console.error('[Config] Failed to parse ANALYTICS_CONFIG:', error);
    return defaultConfig;
  }
}

const config: EnvironmentConfig = {
  BACKEND_URL: getOptional(process.env.NEXT_PUBLIC_BACKEND_URL, 'http://localhost:8001'),
  AUTH_URL: getOptional(process.env.AUTH_URL, 'http://localhost:3000'),
  BASE_DUCKDB_DATA_PATH: getOptional(process.env.BASE_DUCKDB_DATA_PATH, IS_DEV ? '..' : '.'),

  NEXTAUTH_SECRET: requireSecret('NEXTAUTH_SECRET', process.env.NEXTAUTH_SECRET),

  ADMIN_PWD: process.env.ADMIN_PWD,

  ANALYTICS_CONFIG: parseAnalyticsConfig(process.env.NEXT_PUBLIC_ANALYTICS_CONFIG),
};

// Skip validation in test mode or browser (client-side)
// Server-only secrets aren't available in browser - that's expected
if (errors.length > 0 && !IS_TEST && !IS_BROWSER) {
  const errorMessage = [
    '❌ Configuration Error: Missing required environment variables',
    '',
    ...errors,
    '',
    'To fix this:',
    '1. Copy frontend/.env.example to frontend/.env (if not already done)',
    '2. Generate secret:',
    '   - NEXTAUTH_SECRET: openssl rand -base64 32',
    '3. Add it to frontend/.env',
    '',
    'Example:',
    'NEXTAUTH_SECRET=<generated-secret-here>',
  ].join('\n');

  throw new Error(errorMessage);
}

export default config;

// Named exports for backwards compatibility
export const BACKEND_URL = config.BACKEND_URL;
export const AUTH_URL = config.AUTH_URL;
export const BASE_DUCKDB_DATA_PATH = config.BASE_DUCKDB_DATA_PATH;
export const NEXTAUTH_SECRET = config.NEXTAUTH_SECRET;
export const ADMIN_PWD = config.ADMIN_PWD;
export const ANALYTICS_CONFIG = config.ANALYTICS_CONFIG;
