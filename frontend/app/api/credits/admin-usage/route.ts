import { NextRequest } from 'next/server';
import { successResponse, handleApiError, ApiErrors } from '@/lib/http/api-responses';
import { withAuth } from '@/lib/http/with-auth';
import { isAdmin } from '@/lib/auth/role-helpers';
import { getAdminUsageBreakdown } from '@/lib/analytics/admin-usage.server';

/**
 * GET /api/credits/admin-usage — the org-wide usage "full picture" over the
 * current billing window, sliced by grade/provider/model/agent/user/role plus a
 * per-day timeseries. Admin-only (a non-admin gets 403).
 */
export const GET = withAuth(async (_req: NextRequest, user) => {
  try {
    if (!isAdmin(user.role)) return ApiErrors.forbidden('Admin access required');
    return await successResponse(await getAdminUsageBreakdown());
  } catch (error) {
    return handleApiError(error);
  }
});
