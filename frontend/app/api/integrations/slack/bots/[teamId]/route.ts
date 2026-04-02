import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { ApiErrors, handleApiError, successResponse } from '@/lib/api/api-responses';
import { isAdmin } from '@/lib/auth/role-helpers';
import { removeSlackBotConfig } from '@/lib/integrations/slack/store';

export const DELETE = withAuth(async (
  _request: NextRequest,
  user,
  context?: { params?: Promise<{ teamId: string }> }
) => {
  if (!isAdmin(user.role)) {
    return ApiErrors.forbidden('Only admins can manage Slack bots');
  }

  try {
    const params = await context?.params;
    const teamId = params?.teamId?.trim();
    if (!teamId) {
      return ApiErrors.validationError('teamId is required');
    }

    await removeSlackBotConfig(user.companyId, user.mode, teamId);
    return successResponse({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
});
