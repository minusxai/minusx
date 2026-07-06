/**
 * URL utility functions for managing impersonation and mode parameters
 *
 * These functions handle:
 * - `as_user` query parameter which enables admin users to impersonate other users
 * - `mode` query parameter which enables file system isolation (org vs tutorial)
 */

/**
 * Preserve `as_user`, `mode`, and `view` parameters from current URL to
 * target URL (client-side). `view=file` strips app chrome for embedding.
 * Same machinery as as_user / mode.
 * @param targetUrl - The URL to navigate to
 * @returns URL with parameters preserved if they exist
 */
export function preserveParams(targetUrl: string): string {
  // Server-side: return as-is
  if (typeof window === 'undefined') {
    return targetUrl;
  }

  // Check current URL parameters
  const currentParams = new URLSearchParams(window.location.search);
  const asUser = currentParams.get('as_user');
  const mode = currentParams.get('mode');
  const view = currentParams.get('view');

  // If no parameters to preserve, return as-is
  if (!asUser && !mode && !view) {
    return targetUrl;
  }

  // Add parameters to target URL
  const targetURL = new URL(targetUrl, window.location.origin);

  if (asUser) {
    targetURL.searchParams.set('as_user', asUser);
  }

  // Don't add default mode to avoid cluttering URLs
  if (mode && mode !== 'org') {
    targetURL.searchParams.set('mode', mode);
  }

  // Don't add the default view ('full') — keeps URLs clean, like mode=org.
  if (view && view !== 'full') {
    targetURL.searchParams.set('view', view);
  }

  return targetURL.pathname + targetURL.search;
}

/**
 * Start impersonating a user by adding as_user parameter and reloading
 * @param userEmail - Email of the user to impersonate
 */
export function startImpersonation(userEmail: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set('as_user', userEmail);
  window.location.href = url.pathname + url.search;
}

/**
 * Exit impersonation by removing as_user parameter and reloading
 */
export function exitImpersonation(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete('as_user');
  window.location.href = url.pathname + url.search;
}

/**
 * Get current as_user parameter value (client-side)
 * @returns User email if impersonating, null otherwise
 */
export function getCurrentAsUser(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const params = new URLSearchParams(window.location.search);
  return params.get('as_user');
}

