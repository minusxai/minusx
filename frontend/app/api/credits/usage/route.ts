import { NextRequest } from 'next/server';
import { successResponse, handleApiError } from '@/lib/http/api-responses';
import { withAuth } from '@/lib/http/with-auth';
import { isAdmin } from '@/lib/auth/role-helpers';
import { getCreditUsage } from '@/lib/analytics/credit-usage.server';

/**
 * GET /api/credits/usage — current calendar month credit usage.
 * Always returns the signed-in user's `individual` scope; `org` totals are
 * included only for admins (gated server-side — a non-admin can't obtain them).
 */
export const GET = withAuth(async (_req: NextRequest, user) => {
  try {
    const data = await getCreditUsage(user.userId, user.role, isAdmin(user.role));
    return await successResponse(data);
  } catch (error) {
    return handleApiError(error);
  }
});
