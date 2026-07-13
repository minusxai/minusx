/**
 * Client-safe environment constants (available in both browser and server).
 * Only NEXT_PUBLIC_* vars and NODE_ENV belong here.
 * For server-only secrets and server-side vars, use lib/config.ts instead.
 */
import type { AnalyticsConfig } from './analytics/types';

export const IS_DEV = process.env.NODE_ENV !== 'production';
export const IS_TEST = process.env.NODE_ENV === 'test';

export const DEFAULT_CONVERSATION_NAME = 'New Conversation';

export const APP_VERSION = '0.1.0';

/**
 * Git commit SHA — embedded at build time by next.config.ts (via env: { GIT_COMMIT_SHA }).
 * Available on both client and server. Falls back to 'unknown' if not set.
 */
export const GIT_COMMIT_SHA = process.env.GIT_COMMIT_SHA ?? 'unknown';
export const BUILD_TIME = process.env.NEXT_PUBLIC_BUILD_TIME ?? '';
export const DISABLE_UPDATE_BANNER = process.env.NEXT_PUBLIC_DISABLE_UPDATE_BANNER === 'true';

export function parseAnalyticsConfig(jsonString: string | undefined): AnalyticsConfig {
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
      const sessionRecording = parsed.mixpanel.sessionRecording
        ? {
            enabled: parsed.mixpanel.sessionRecording.enabled || false,
            sampleRate: parsed.mixpanel.sessionRecording.sampleRate ?? 0.1,
          }
        : { enabled: false, sampleRate: 0.1 };
      return {
        enabled: parsed.enabled,
        debug: parsed.debug || false,
        provider: 'mixpanel',
        mixpanel: { ...parsed.mixpanel, sessionRecording },
      };
    }
    return { enabled: parsed.enabled, debug: parsed.debug || false, provider: parsed.provider || 'noop' };
  } catch (error) {
    console.error('[Config] Failed to parse ANALYTICS_CONFIG:', error);
    return defaultConfig;
  }
}

export const SEND_ERRORS_IN_DEV = process.env.NEXT_PUBLIC_SEND_ERRORS_IN_DEV === 'true';

/**
 * E2E test mode (Tests/QA/Evals Arch V2). When set, the client exposes the Redux
 * store on `window.__MX_STORE__` and charts render as SVG (DOM-assertable). Drives
 * Playwright local/CI runs; never enabled in normal production builds.
 */
export const E2E_MODE = process.env.NEXT_PUBLIC_E2E === 'true';

/**
 * Base URL of the managed MinusX LLM gateway (OpenAI-compatible) — the DEFAULT
 * model provider when a workspace has configured nothing else. Non-secret;
 * overridable per deploy (server runtime env) for staging gateways. Client
 * bundles just see the default — the browser never calls the gateway.
 */
export const MINUSX_GATEWAY_URL: string = process.env.MINUSX_GATEWAY_URL || 'https://llm.minusx.ai/v1';

export const PROTECTED_FILE_PATHS = [
  // System-managed internals DuckDB connection — read-only, cannot be modified or deleted
  '/internals/database/internals',
] as const;
