import 'server-only';
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/http/with-auth';
import { ApiErrors, successResponse } from '@/lib/http/api-responses';
import { isAdmin } from '@/lib/auth/role-helpers';
import { isSlackOAuthConfigured, getSlackCapabilities } from '@/lib/integrations/slack/config';

// Reports BOTH ways to connect Slack, because a client that knows only about the first cannot
// render an honest state.
//
//   configured        — hosted OAuth: SLACK_CLIENT_ID + SLACK_CLIENT_SECRET are set here.
//   selfHostedEnabled — the admin can register their own Slack app instead. Needs only a public
//                       HTTPS base URL, and is what `manifest` and `manual-install` 403 without.
//
// Only the first was ever exposed. Settings consequently offered the whole manual guide on an
// instance with no public URL and revealed the truth as a 403 at "Generate manifest", and the
// onboarding Slack step could not tell "set one up yourself" apart from "Slack cannot work here".
export const GET = withAuth(async (_request: NextRequest, user) => {
  if (!isAdmin(user.role)) {
    return ApiErrors.forbidden('Only admins can manage Slack bots');
  }
  return successResponse({
    configured: isSlackOAuthConfigured(),
    selfHostedEnabled: getSlackCapabilities().selfHostedEnabled,
  });
});
