import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/http/with-auth';
import { successResponse, handleApiError, ApiErrors } from '@/lib/http/api-responses';
import { isAdmin } from '@/lib/auth/role-helpers';
import { updateGroup, deleteGroup, validateGroupInput } from '@/lib/data/groups.server';

/** PATCH /api/groups/[name] — replace a group's definition + membership (admin only). */
export const PATCH = withAuth(async (
  request: NextRequest,
  user,
  { params }: { params: Promise<{ name: string }> },
) => {
  if (!isAdmin(user.role)) return ApiErrors.forbidden('Only admins can manage groups');
  try {
    const name = decodeURIComponent((await params).name);
    const parsed = validateGroupInput({ ...(await request.json()), name });
    if ('error' in parsed) return ApiErrors.validationError(parsed.error);
    return successResponse({ group: await updateGroup(name, parsed.input, user) });
  } catch (error) {
    return handleApiError(error);
  }
});

/** DELETE /api/groups/[name] — delete a group (admin only; refused while assigned). */
export const DELETE = withAuth(async (
  _request: NextRequest,
  user,
  { params }: { params: Promise<{ name: string }> },
) => {
  if (!isAdmin(user.role)) return ApiErrors.forbidden('Only admins can manage groups');
  try {
    const name = decodeURIComponent((await params).name);
    await deleteGroup(name, user);
    return successResponse({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
});
