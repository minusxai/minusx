/**
 * Shared API URL helpers for the chat clients (XHR-based SSE bypasses the global fetch-patch, so we
 * replicate its param-forwarding here).
 */
import { getCurrentAsUser } from '@/lib/navigation/url-utils';
import { getCurrentMode } from '@/lib/mode/mode-utils';

export const API_BASE_URL = typeof window === 'undefined'
  ? 'http://localhost:3000'  // Node.js test environment
  : '';                      // Browser — relative URLs

/**
 * Mirror the global fetch-patch: append as_user and mode params to /api/ URLs.
 */
export function patchApiUrl(path: string): string {
  if (typeof window === 'undefined') return path;
  const asUser = getCurrentAsUser();
  const mode = getCurrentMode();
  if (!asUser && mode === 'org') return path;
  const url = new URL(path, window.location.origin);
  if (asUser) url.searchParams.set('as_user', asUser);
  if (mode !== 'org') url.searchParams.set('mode', mode);
  return url.pathname + url.search;
}
