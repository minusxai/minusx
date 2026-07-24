import { NextRequest } from 'next/server';
import { successResponse, handleApiError, ApiErrors } from '@/lib/http/api-responses';
import { withAuth } from '@/lib/http/with-auth';
import { isAdmin } from '@/lib/auth/role-helpers';
import { appEventRegistry } from '@/lib/app-event-registry';
import { AppEvents } from '@/lib/app-event-registry/events';
import { immutableSet } from '@/lib/utils/immutable-collections';

const SCOPES = immutableSet(['user', 'role', 'company']);

/**
 * POST /api/credits/reset — admin manually resets a credit window for a scope.
 * Body: { scope: 'user'|'role'|'company', target: string }. Emits a CREDIT_RESET
 * app event (auto-persisted to app_events); usage aggregation floors at the
 * latest such event, so a reset zeroes the affected users immediately.
 */
export const POST = withAuth(async (req: NextRequest, user) => {
  try {
    if (!isAdmin(user.role)) return ApiErrors.forbidden('Admin access required');
    const body = await req.json().catch(() => ({}));
    const scope = String(body?.scope ?? '');
    const target = scope === 'company' ? 'company' : String(body?.target ?? '');
    if (!SCOPES.has(scope)) return ApiErrors.validationError("scope must be 'user', 'role', or 'company'");
    if (scope !== 'company' && !target) return ApiErrors.validationError('target is required for a user/role reset');

    appEventRegistry.publish(AppEvents.CREDIT_RESET, {
      mode: user.mode,
      scope: scope as 'user' | 'role' | 'company',
      target,
      actorUserId: typeof user.userId === 'number' ? user.userId : undefined,
      actorEmail: user.email,
    });
    return successResponse({ ok: true, scope, target });
  } catch (error) {
    return handleApiError(error);
  }
});
