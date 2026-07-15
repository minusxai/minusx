import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/http/with-auth';
import { successResponse, handleApiError, ApiErrors } from '@/lib/http/api-responses';
import { isAdmin } from '@/lib/auth/role-helpers';
import { folderAccessReport, userAccessReport } from '@/lib/data/access-report.server';

/**
 * GET /api/access-report?path=/finance — who can access a folder, and via what.
 * GET /api/access-report?userId=7    — why a user has the access they have.
 * Admin-only explainability over users + groups.
 */
export const GET = withAuth(async (request: NextRequest, user) => {
  if (!isAdmin(user.role)) return ApiErrors.forbidden('Only admins can view access reports');
  try {
    const path = request.nextUrl.searchParams.get('path');
    const userIdStr = request.nextUrl.searchParams.get('userId');
    if (path) {
      return successResponse({ entries: await folderAccessReport(path, user.mode) });
    }
    if (userIdStr) {
      const userId = parseInt(userIdStr, 10);
      if (!Number.isInteger(userId)) return ApiErrors.validationError('Invalid userId');
      return successResponse({ entries: await userAccessReport(userId, user.mode) });
    }
    return ApiErrors.validationError('Provide ?path= or ?userId=');
  } catch (error) {
    return handleApiError(error);
  }
});
