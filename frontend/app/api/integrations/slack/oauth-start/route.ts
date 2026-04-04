import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { withAuth } from '@/lib/api/with-auth';
import { ApiErrors } from '@/lib/api/api-responses';
import { isAdmin } from '@/lib/auth/role-helpers';
import { isSlackOAuthConfigured, buildOAuthUrl } from '@/lib/integrations/slack/config';
import { NEXTAUTH_SECRET } from '@/lib/config';
import { extractSubdomain } from '@/lib/utils/subdomain';

interface StatePayload {
  ts: number;
  nonce: string;
  subdomain: string | null;
  returnUrl: string;
  userEmail: string;
}

export function buildState(payload: StatePayload): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', NEXTAUTH_SECRET)
    .update(encoded)
    .digest('hex');
  return `${encoded}.${sig}`;
}

export const GET = withAuth(async (request: NextRequest, user) => {
  if (!isAdmin(user.role)) {
    return ApiErrors.forbidden('Only admins can manage Slack bots');
  }
  if (!isSlackOAuthConfigured()) {
    return ApiErrors.badRequest('Slack OAuth is not configured on this server');
  }

  const host = request.headers.get('host') ?? '';
  const subdomain = extractSubdomain(host);
  // Build return URL using the originating host so we redirect back to the right subdomain
  const protocol = host.includes('localhost') ? 'http' : 'https';
  const returnUrl = `${protocol}://${host}/settings?tab=integrations`;

  const state = buildState({
    ts: Date.now(),
    nonce: crypto.randomBytes(16).toString('hex'),
    subdomain,
    returnUrl,
    userEmail: user.email,
  });

  return NextResponse.redirect(buildOAuthUrl(state));
});
