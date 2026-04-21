/**
 * Centralized client for Python backend API calls
 *
 * Automatically adds required headers and session tokens for all Python backend requests.
 * Session tokens allow Python to securely call back to Next.js internal APIs without shared secrets.
 */

import { BACKEND_URL } from '@/lib/config';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { sessionTokenManager } from '@/lib/auth/session-tokens';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

/**
 * Fetch wrapper for Python backend API calls
 * Automatically adds session token from current user's session
 *
 * @param endpoint - API endpoint path (e.g., '/api/chat', '/api/execute-query')
 * @param options - Standard fetch options (method, body, etc.)
 * @param userOverride - Optional user to use instead of reading from session (needed in cron/job contexts with no HTTP session)
 * @returns Response from Python backend
 *
 * @example
 * const response = await pythonBackendFetch('/api/execute-query', {
 *   method: 'POST',
 *   body: JSON.stringify({ query, connection_name })
 * });
 */
export async function pythonBackendFetch(
  endpoint: string,
  options: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> } = {},
  userOverride?: EffectiveUser | null
): Promise<Response> {
  // Use provided user or fall back to session-based user
  const user = userOverride ?? await getEffectiveUser();

  // Build headers
  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers
  };

  // Add mode header for mode-based isolation
  if (user?.mode) {
    requestHeaders['x-mode'] = user.mode;
  }

  // Generate session token for this request
  // Python will echo this back when calling Next.js internal APIs
  const sessionToken = user ? sessionTokenManager.generate(user.mode) : null;

  // Inject session token into request body (if body exists)
  let modifiedBody = options.body;
  if (sessionToken && options.body && typeof options.body === 'string') {
    try {
      const bodyObj = JSON.parse(options.body);
      bodyObj.session_token = sessionToken;
      modifiedBody = JSON.stringify(bodyObj);
    } catch (e) {
      // If body isn't JSON, skip token injection
      console.warn('[pythonBackendFetch] Could not inject session token - body is not JSON');
    }
  }

  // Make request
  return fetch(`${BACKEND_URL}${endpoint}`, {
    ...options,
    body: modifiedBody,
    headers: requestHeaders
  });
}
