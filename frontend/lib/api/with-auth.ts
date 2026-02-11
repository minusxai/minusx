/**
 * Auth middleware for Next.js API routes
 * Extracts repetitive authentication and authorization logic into reusable wrapper
 */

import { NextRequest, NextResponse } from 'next/server';
import { getEffectiveUser, type EffectiveUser } from '@/lib/auth/auth-helpers';
import { ApiErrors } from '@/lib/api/api-responses';

/**
 * Type for authenticated API route handlers
 * Handler receives the request, authenticated user, and optional route context
 */
type AuthHandler = (
  request: NextRequest,
  user: EffectiveUser,
  context?: any
) => Promise<NextResponse>;

/**
 * Middleware wrapper for API routes requiring authentication
 *
 * Usage:
 * ```typescript
 * export const GET = withAuth(async (request, user) => {
 *   // user is guaranteed to be authenticated and have a companyId
 *   const documents = await DocumentDB.listAll(user.companyId);
 *   return successResponse(documents);
 * });
 * ```
 *
 * @param handler - The actual route handler that receives authenticated user
 * @returns Wrapped handler that performs auth checks before calling the original handler
 */
export function withAuth(handler: AuthHandler) {
  return async (request: NextRequest, context?: any) => {
    const authStart = Date.now();
    console.log('[AUTH] Starting authentication check');

    // Check if user is authenticated (considering impersonation)
    const user = await getEffectiveUser();
    console.log(`[AUTH] getEffectiveUser took ${Date.now() - authStart}ms`);

    if (!user) {
      return ApiErrors.unauthorized();
    }

    // Check if user has a company assigned (required for multi-tenant security)
    if (!user.companyId) {
      return ApiErrors.forbidden('User does not have a company assigned');
    }

    console.log(`[AUTH] Total auth check took ${Date.now() - authStart}ms`);
    // User is authenticated and authorized, proceed to handler
    return handler(request, user, context);
  };
}
