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
 * Type for cron route handlers — no user, just the raw request.
 * The route is responsible for constructing per-company EffectiveUsers itself.
 */
type CronHandler = (request: NextRequest) => Promise<NextResponse>;

/**
 * Auth middleware for cron endpoints.
 *
 * Only accepts `Authorization: Bearer <CRON_SECRET>`. No session fallback.
 * The route receives the raw request and handles per-company logic itself.
 *
 * Required env var: CRON_SECRET
 */
export function withCronAuth(handler: CronHandler) {
  return async (request: NextRequest) => {
    // eslint-disable-next-line no-restricted-syntax
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = request.headers.get('authorization');
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      // Return 200 to avoid leaking that this endpoint exists or requires auth
      return NextResponse.json({ ok: true });
    }
    return handler(request);
  };
}

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
