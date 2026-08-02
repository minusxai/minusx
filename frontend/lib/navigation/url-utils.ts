/**
 * URL utility functions for managing impersonation and mode parameters
 *
 * These functions handle:
 * - `as_user` query parameter which enables admin users to impersonate other users
 * - `mode` query parameter which enables file system isolation (org vs tutorial)
 * - `view` query parameter which strips app chrome for embedding
 */

/**
 * Preserve `as_user`, `mode`, and `view` parameters from current URL to
 * target URL (client-side). `view=file` strips app chrome for embedding.
 * Same machinery as as_user / mode.
 * @param targetUrl - The URL to navigate to
 * @returns URL with parameters preserved if they exist
 */
export function preserveParams(targetUrl: string, search?: string): string {
  // `search` lets a RENDERING caller supply the query string from a source both the server and the
  // client can see (Next's `useSearchParams`). Without it this function falls back to
  // `window.location`, which is absent during SSR — so a rendered <a> got a bare href on the server
  // and a mode-carrying one on the client, and React reported "some attributes of the server
  // rendered HTML didn't match … This won't be patched up". Imperative callers (navigate, redirect)
  // run only in the browser and can keep omitting it.
  const rawSearch = search ?? (typeof window === 'undefined' ? undefined : window.location.search);
  if (rawSearch === undefined) {
    return targetUrl;
  }

  // Check current URL parameters
  const currentParams = new URLSearchParams(rawSearch);
  const asUser = currentParams.get('as_user');
  const mode = currentParams.get('mode');
  const view = currentParams.get('view');

  // If no parameters to preserve, return as-is
  if (!asUser && !mode && !view) {
    return targetUrl;
  }

  // Add parameters to target URL
  // Base only matters for resolving a relative target; the origin is dropped by the
  // pathname+search return below, and `window` may not exist here.
  const base = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
  const targetURL = new URL(targetUrl, base);

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

