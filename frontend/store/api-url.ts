/**
 * Shared API URL helpers for the chat clients (XHR-based SSE bypasses the global fetch-patch, so we
 * replicate its param-forwarding here). Used by both the v2 chat listener and the v3 stream client.
 */
import { getCurrentAsUser, getCurrentV } from '@/lib/navigation/url-utils';
import { getCurrentMode } from '@/lib/mode/mode-utils';

export const API_BASE_URL = typeof window === 'undefined'
  ? 'http://localhost:3000'  // Node.js test environment
  : '';                      // Browser — relative URLs

/**
 * Mirror the global fetch-patch: append as_user, mode, and v params to /api/ URLs. `v` carries the
 * chat-surface selection (`?v=1` = legacy Conversations surface) through the streamed request.
 */
export function patchApiUrl(path: string): string {
  if (typeof window === 'undefined') return path;
  const asUser = getCurrentAsUser();
  const mode = getCurrentMode();
  const v = getCurrentV();
  if (!asUser && mode === 'org' && !v) return path;
  const url = new URL(path, window.location.origin);
  if (asUser) url.searchParams.set('as_user', asUser);
  if (mode !== 'org') url.searchParams.set('mode', mode);
  if (v) url.searchParams.set('v', v);
  return url.pathname + url.search;
}
