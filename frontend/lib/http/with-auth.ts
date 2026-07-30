/**
 * Auth middleware for Next.js API routes.
 * Extracts repetitive authentication and authorization logic into a reusable wrapper.
 *
 * User context (user ID, mode) is established by middleware before the request reaches any
 * API route via x-user-id and x-mode headers.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getEffectiveUser, type EffectiveUser } from '@/lib/auth/auth-helpers';
import { ApiErrors, isClientAbortError } from '@/lib/http/api-responses';
import { appEventRegistry, AppEvents } from '@/lib/app-event-registry';
import { checkDataVersion, dataVersionMessage } from '@/lib/database/data-version-gate';

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
  return withAuthOptions(handler);
}

/**
 * `withAuth`, but exempt from the data-version gate.
 *
 * For the ONE route that has to work while the gate is refusing: the migration itself.
 * Migrations no longer run at boot, so the gate's refusal is escaped by calling
 * /api/admin/migrate-db — and if that call is gated too, the only way out is blocked by
 * the thing it exists to clear. A deadlock the browser found immediately and no unit test
 * would have: every request 503s, including the fix.
 *
 * Deliberately a separate, named export rather than a flag on `withAuth`, so exempting a
 * route is a visible decision at its definition and cannot be set by passing an object
 * through from somewhere else. Nothing else should use it: a route exempted from the gate
 * is a route allowed to read data this build may misread.
 */
export function withAuthSkippingDataVersionGate(handler: AuthHandler) {
  return withAuthOptions(handler, { skipDataVersionGate: true });
}

function withAuthOptions(
  handler: AuthHandler,
  { skipDataVersionGate = false }: { skipDataVersionGate?: boolean } = {},
) {
  return async (request: NextRequest, context?: any) => {
    const user = await getEffectiveUser();

    if (!user) {
      return ApiErrors.unauthorized();
    }

    // Refuse data this build cannot correctly read or write, rather than misreading it.
    // Checked per request because a workspace can be migrated (or a build rolled back)
    // while the process is running.
    if (!skipDataVersionGate) {
      const version = await checkDataVersion();
      if (!version.ok) {
        return NextResponse.json(
          { error: dataVersionMessage(version), code: version.reason },
          { status: 503 },
        );
      }
    }

    try {
      return await handler(request, user, context);
    } catch (e) {
      // Client disconnects are not server faults — rethrow without reporting
      if (!isClientAbortError(e)) {
        appEventRegistry.publish(AppEvents.ERROR, {
          mode: user.mode ?? 'org',
          source: `server:${request.nextUrl.pathname}`,
          message: e instanceof Error ? e.message : String(e),
          context: { user: user.email },
        });
      }
      throw e;
    }
  };
}
