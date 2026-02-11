/**
 * Mode URL utilities for managing mode parameter in URLs
 * Mirrors the pattern from url-utils.ts for as_user parameter
 */

import { Mode, DEFAULT_MODE, isValidMode } from './mode-types';

/**
 * Extract mode parameter from URL (server-side)
 */
export function getModeFromUrl(url: URL): Mode {
  const modeParam = url.searchParams.get('mode');
  if (modeParam && isValidMode(modeParam)) {
    return modeParam;
  }
  return DEFAULT_MODE;
}

/**
 * Preserve mode parameter from current URL to target URL (client-side)
 */
export function preserveModeParam(targetUrl: string): string {
  if (typeof window === 'undefined') {
    return targetUrl;
  }

  const currentParams = new URLSearchParams(window.location.search);
  const mode = currentParams.get('mode');

  if (!mode || mode === DEFAULT_MODE) {
    return targetUrl; // Don't add default mode to URLs
  }

  const targetURL = new URL(targetUrl, window.location.origin);
  targetURL.searchParams.set('mode', mode);
  return targetURL.pathname + targetURL.search;
}

/**
 * Get current mode parameter value (client-side)
 */
export function getCurrentMode(): Mode {
  if (typeof window === 'undefined') {
    return DEFAULT_MODE;
  }
  const params = new URLSearchParams(window.location.search);
  const modeParam = params.get('mode');
  return modeParam && isValidMode(modeParam) ? modeParam : DEFAULT_MODE;
}

/**
 * Switch to a different mode by redirecting to home with mode parameter
 * Always redirects to home because current path may not exist in new mode
 * (e.g., /p/org/database doesn't exist in tutorial mode)
 */
export function switchMode(mode: Mode): void {
  const url = new URL('/', window.location.origin);
  if (mode !== DEFAULT_MODE) {
    url.searchParams.set('mode', mode);
  }
  window.location.href = url.pathname + url.search;
}
