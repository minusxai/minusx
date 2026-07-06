/**
 * URL utility functions for managing impersonation and mode parameters
 *
 * These functions handle:
 * - `as_user` query parameter which enables admin users to impersonate other users
 * - `mode` query parameter which enables file system isolation (org vs tutorial)
 * - `v` query parameter which selects the chat engine (see DEFAULT_CHAT_VERSION)
 */

import { DEFAULT_CHAT_VERSION, type ChatVersion } from '@/lib/chat-v2/chat-version';

/**
 * Preserve `as_user`, `mode`, `v`, and `view` parameters from current URL to
 * target URL (client-side). The `v` parameter gates chat-v2 surfaces (`v=2`
 * switches the sidebar from Conversations to Chats); `view=file` strips app
 * chrome for embedding. Same machinery as as_user / mode.
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
  const v = currentParams.get('v');
  const view = currentParams.get('view');

  // If no parameters to preserve, return as-is
  if (!asUser && !mode && !v && !view) {
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

  if (v) {
    targetURL.searchParams.set('v', v);
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

/**
 * Get current `v` parameter value (client-side). Mirrors `getCurrentAsUser`
 * for the chat-v2 toggle (`v=2` enables the new chat surface).
 * @returns The `v` value if set, null otherwise
 */
export function getCurrentV(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const params = new URLSearchParams(window.location.search);
  return params.get('v');
}

/**
 * Compute a `pathname + search` for the current location with the chat
 * version flipped, preserving every other query parameter and the pathname.
 * Used by the settings toggle to trigger a full reload that switches chat
 * engines.
 *
 * `enabled` means "use the new (v2) chat". Since v2 is the default
 * (`DEFAULT_CHAT_VERSION`), enabling it clears `v` to keep the URL clean
 * (like `mode=org` is omitted); disabling it opts into the legacy
 * surface via an explicit `?v=1`. The `v` param is only ever present when it
 * differs from the default.
 *
 * @param enabled - true to use v2 (clears `v`), false to use legacy v1 (sets `v=1`)
 * @returns The new `pathname + search` string. Server-side: returns '/'.
 */
export function setVInUrl(enabled: boolean): string {
  if (typeof window === 'undefined') {
    return '/';
  }
  const version: ChatVersion = enabled ? 2 : 1;
  const url = new URL(window.location.href);
  if (version === DEFAULT_CHAT_VERSION) {
    url.searchParams.delete('v');
  } else {
    url.searchParams.set('v', String(version));
  }
  return url.pathname + (url.search ? url.search : '');
}
