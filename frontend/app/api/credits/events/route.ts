import { NextRequest } from 'next/server';
import { successResponse, handleApiError, ApiErrors } from '@/lib/http/api-responses';
import { withAuth } from '@/lib/http/with-auth';
import { isAdmin } from '@/lib/auth/role-helpers';
import { getRecentCreditEvents } from '@/lib/analytics/credit-usage.server';

/**
 * GET /api/credits/events — recent credit lifecycle events (rate-limit hits +
 * manual/auto resets) from app_events, for the admin levers panel. Admin-only.
 */
export const GET = withAuth(async (_req: NextRequest, user) => {
  try {
    if (!isAdmin(user.role)) return ApiErrors.forbidden('Admin access required');
    return await successResponse({ events: await getRecentCreditEvents() });
  } catch (error) {
    return handleApiError(error);
  }
});
