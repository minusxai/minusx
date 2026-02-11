/**
 * Global fetch patch to automatically append as_user and mode parameters to API calls
 * This ensures impersonation and mode are preserved across all client-side API requests
 *
 * This module auto-initializes on import in browser environment
 */

'use client';

import { getCurrentAsUser } from '@/lib/navigation/url-utils';
import { getCurrentMode } from '@/lib/mode/mode-utils';

// Store original fetch (only in browser)
const originalFetch = typeof window !== 'undefined' ? window.fetch : undefined;

let isPatched = false;

// Auto-initialize patch when module loads (browser-only)
if (typeof window !== 'undefined') {
  installPatch();
}

/**
 * Internal function to install the fetch patch
 * Auto-called on module initialization in browser environment
 */
function installPatch() {
  // Only patch in browser environment
  if (typeof window === 'undefined' || !originalFetch) {
    console.log('[Fetch Patch] Skipped - not in browser environment');
    return;
  }
  if (isPatched) {
    return;
  }

  window.fetch = function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    // Get the URL string
    let urlString: string;
    if (typeof input === 'string') {
      urlString = input;
    } else if (input instanceof URL) {
      urlString = input.href;
    } else if (input instanceof Request) {
      urlString = input.url;
    } else {
      urlString = '';
    }

    // Only patch API routes
    if (urlString.startsWith('/api/') || urlString.includes('/api/')) {
      const asUser = getCurrentAsUser();
      const mode = getCurrentMode();

      if (asUser || mode !== 'org') {
        // Parse and modify URL
        const url = new URL(urlString, window.location.origin);

        if (asUser) {
          url.searchParams.set('as_user', asUser);
        }

        // Don't add default mode to avoid cluttering URLs
        if (mode !== 'org') {
          url.searchParams.set('mode', mode);
        }

        const patchedUrl = url.pathname + url.search;

        console.log('[Fetch Patch] Patched URL:', {
          from: urlString,
          to: patchedUrl
        });

        // Update input with modified URL
        if (typeof input === 'string') {
          input = patchedUrl;
        } else if (input instanceof URL) {
          input = new URL(patchedUrl, window.location.origin);
        } else if (input instanceof Request) {
          // For Request objects, create new request with modified URL
          input = new Request(patchedUrl, input);
        }
      }
    }

    // Call original fetch
    return originalFetch.call(window, input, init);
  };

  isPatched = true;
}

/**
 * Restore original fetch (for testing)
 */
export function unpatchFetch() {
  if (typeof window === 'undefined' || !originalFetch || !isPatched) return;
  window.fetch = originalFetch;
  isPatched = false;
}
