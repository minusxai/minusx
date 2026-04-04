import 'server-only';
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { ApiErrors, successResponse } from '@/lib/api/api-responses';
import { isAdmin } from '@/lib/auth/role-helpers';
import { isSlackOAuthConfigured } from '@/lib/integrations/slack/config';

export const GET = withAuth(async (_request: NextRequest, user) => {
  if (!isAdmin(user.role)) {
    return ApiErrors.forbidden('Only admins can manage Slack bots');
  }
  return successResponse({ configured: isSlackOAuthConfigured() });
});
