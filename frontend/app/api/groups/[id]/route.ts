import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/http/with-auth';
import { successResponse, handleApiError, ApiErrors } from '@/lib/http/api-responses';
import { isAdmin } from '@/lib/auth/role-helpers';
import { updateGroup, deleteGroup, validateGroupInput } from '@/lib/data/groups.server';

/** PATCH /api/groups/[id] — update a group (admin only; locked groups reject). */
export const PATCH = withAuth(async (
  request: NextRequest,
  user,
  { params }: { params: Promise<{ id: string }> },
) => {
  if (!isAdmin(user.role)) return ApiErrors.forbidden('Only admins can manage groups');
  try {
    const id = parseInt((await params).id, 10);
    if (!Number.isInteger(id)) return ApiErrors.validationError('Invalid group id');
    const parsed = validateGroupInput(await request.json(), user.mode);
    if ('error' in parsed) return ApiErrors.validationError(parsed.error);
    return successResponse({ group: await updateGroup(id, parsed.input) });
  } catch (error) {
    return handleApiError(error);
  }
});

/** DELETE /api/groups/[id] — delete a group (admin only; locked groups reject). */
export const DELETE = withAuth(async (
  _request: NextRequest,
  user,
  { params }: { params: Promise<{ id: string }> },
) => {
  if (!isAdmin(user.role)) return ApiErrors.forbidden('Only admins can manage groups');
  try {
    const id = parseInt((await params).id, 10);
    if (!Number.isInteger(id)) return ApiErrors.validationError('Invalid group id');
    await deleteGroup(id);
    return successResponse({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
});
