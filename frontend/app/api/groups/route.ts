import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/http/with-auth';
import { successResponse, handleApiError, ApiErrors } from '@/lib/http/api-responses';
import { isAdmin } from '@/lib/auth/role-helpers';
import { listGroups, createGroup, validateGroupInput } from '@/lib/data/groups.server';

/** GET /api/groups — list the workspace's groups for the caller's mode (admin only). */
export const GET = withAuth(async (_request: NextRequest, user) => {
  if (!isAdmin(user.role)) return ApiErrors.forbidden('Only admins can manage groups');
  try {
    return successResponse({ groups: await listGroups(user.mode) });
  } catch (error) {
    return handleApiError(error);
  }
});

/** POST /api/groups — create a group (admin only). */
export const POST = withAuth(async (request: NextRequest, user) => {
  if (!isAdmin(user.role)) return ApiErrors.forbidden('Only admins can manage groups');
  try {
    const parsed = validateGroupInput(await request.json(), user.mode);
    if ('error' in parsed) return ApiErrors.validationError(parsed.error);
    return successResponse({ group: await createGroup(parsed.input) });
  } catch (error) {
    return handleApiError(error);
  }
});
