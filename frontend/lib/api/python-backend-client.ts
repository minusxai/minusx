/**
 * Centralized client for Python backend API calls
 *
 * Automatically adds required headers (x-company-id) and session tokens for all Python backend requests.
 * Session tokens allow Python to securely call back to Next.js internal APIs without shared secrets.
 */

import { BACKEND_URL } from '@/lib/constants';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { sessionTokenManager } from '@/lib/auth/session-tokens';

/**
 * Fetch wrapper for Python backend API calls
 * Automatically adds x-company-id header and session token from current user's session
 *
 * @param endpoint - API endpoint path (e.g., '/api/chat', '/api/execute-query')
 * @param options - Standard fetch options (method, body, etc.)
 * @returns Response from Python backend
 *
 * @example
 * const response = await pythonBackendFetch('/api/execute-query', {
 *   method: 'POST',
 *   body: JSON.stringify({ query, database_name })
 * });
 */
export async function pythonBackendFetch(
  endpoint: string,
  options: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> } = {}
): Promise<Response> {
  // Auto-fetch effective user (server-side only)
  const user = await getEffectiveUser();

  // Build headers
  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers
  };

  // Add company ID header for multi-tenant isolation
  if (user?.companyId) {
    requestHeaders['x-company-id'] = user.companyId.toString();
  }

  // Add mode header for mode-based isolation
  if (user?.mode) {
    requestHeaders['x-mode'] = user.mode;
  }

  // Generate session token for this request
  // Python will echo this back when calling Next.js internal APIs
  const sessionToken = user?.companyId ? sessionTokenManager.generate(user.companyId, user.mode) : null;

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
