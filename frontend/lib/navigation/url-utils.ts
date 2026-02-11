/**
 * URL utility functions for managing impersonation and mode parameters
 *
 * These functions handle:
 * - `as_user` query parameter which enables admin users to impersonate other users
 * - `mode` query parameter which enables file system isolation (org vs tutorial)
 */

/**
 * Extract `as_user` parameter from URL (server-side)
 * @param url - URL object to extract parameter from
 * @returns User email if present, null otherwise
 */
export function getAsUserFromUrl(url: URL): string | null {
  return url.searchParams.get('as_user');
}

/**
 * Preserve both `as_user` and `mode` parameters from current URL to target URL (client-side)
 * @param targetUrl - The URL to navigate to
 * @returns URL with both parameters preserved if they exist
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

  // If no parameters to preserve, return as-is
  if (!asUser && !mode) {
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

  return targetURL.pathname + targetURL.search;
}

/**
 * Preserve `as_user` parameter from current URL to target URL (client-side)
 * @deprecated Use preserveParams() instead for consistency
 * @param targetUrl - The URL to navigate to
 * @returns URL with `as_user` parameter preserved if it exists
 */
export function preserveAsUserParam(targetUrl: string): string {
  return preserveParams(targetUrl);
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
