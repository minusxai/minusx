import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { withAuth } from '@/lib/api/with-auth';
import { ApiErrors } from '@/lib/api/api-responses';
import { isAdmin } from '@/lib/auth/role-helpers';
import { isSlackOAuthConfigured, buildOAuthUrl } from '@/lib/integrations/slack/config';
import { buildState } from '@/lib/integrations/slack/oauth-state';

// Re-exported for tests that drive the OAuth flow end to end.
export { buildState };

export const GET = withAuth(async (request: NextRequest, user) => {
  if (!isAdmin(user.role)) {
    return ApiErrors.forbidden('Only admins can manage Slack bots');
  }
  if (!isSlackOAuthConfigured()) {
    return ApiErrors.badRequest('Slack OAuth is not configured on this server');
  }

  const host = request.headers.get('host') ?? '';
  const protocol = host.includes('localhost') ? 'http' : 'https';
  const returnUrl = `${protocol}://${host}/settings?tab=integrations`;

  const state = buildState({
    ts: Date.now(),
    nonce: crypto.randomBytes(16).toString('hex'),
    returnUrl,
    userEmail: user.email,
  });

  return NextResponse.redirect(buildOAuthUrl(state));
});
