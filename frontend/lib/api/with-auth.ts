/**
 * Auth middleware for Next.js API routes.
 * Extracts repetitive authentication and authorization logic into a reusable wrapper.
 *
 * User context (user ID, mode) is established by middleware before the request reaches any
 * API route via x-user-id and x-mode headers.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getEffectiveUser, type EffectiveUser } from '@/lib/auth/auth-helpers';
import { ApiErrors } from '@/lib/api/api-responses';
import { appEventRegistry, AppEvents } from '@/lib/app-event-registry';

type AuthHandler = (
  request: NextRequest,
  user: EffectiveUser,
  context?: any
) => Promise<NextResponse>;

/**
 * Type for cron route handlers — no user, just the raw request.
 * The route is responsible for constructing per-org EffectiveUsers itself.
 */
type CronHandler = (request: NextRequest) => Promise<NextResponse>;

/**
 * Auth middleware for cron endpoints.
 * Only accepts `Authorization: Bearer <CRON_SECRET>`. No session fallback.
 */
export function withCronAuth(handler: CronHandler) {
  return async (request: NextRequest) => {
    // eslint-disable-next-line no-restricted-syntax
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = request.headers.get('authorization');
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ ok: true });
    }
    return handler(request);
  };
}

export function withAuth(handler: AuthHandler) {
  return async (request: NextRequest, context?: any) => {
    const user = await getEffectiveUser();

    if (!user) {
      return ApiErrors.unauthorized();
    }

    try {
      return await handler(request, user, context);
    } catch (e) {
      appEventRegistry.publish(AppEvents.ERROR, {
        
        mode: user.mode ?? 'org',
        source: `server:${request.nextUrl.pathname}`,
        message: e instanceof Error ? e.message : String(e),
        context: { user: user.email },
      });
      throw e;
    }
  };
}
