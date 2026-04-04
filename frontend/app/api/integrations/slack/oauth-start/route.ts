import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { withAuth } from '@/lib/api/with-auth';
import { ApiErrors } from '@/lib/api/api-responses';
import { isAdmin } from '@/lib/auth/role-helpers';
import { isSlackOAuthConfigured, buildOAuthUrl } from '@/lib/integrations/slack/config';
import { NEXTAUTH_SECRET } from '@/lib/config';

function buildState(): string {
  const ts = Date.now().toString();
  const nonce = crypto.randomBytes(16).toString('hex');
  const payload = `${ts}.${nonce}`;
  const sig = crypto
    .createHmac('sha256', NEXTAUTH_SECRET)
    .update(payload)
    .digest('hex');
  return `${payload}.${sig}`;
}

export const GET = withAuth(async (_request: NextRequest, user) => {
  if (!isAdmin(user.role)) {
    return ApiErrors.forbidden('Only admins can manage Slack bots');
  }
  if (!isSlackOAuthConfigured()) {
    return ApiErrors.badRequest('Slack OAuth is not configured on this server');
  }
  const state = buildState();
  const oauthUrl = buildOAuthUrl(state);
  return NextResponse.redirect(oauthUrl);
});
