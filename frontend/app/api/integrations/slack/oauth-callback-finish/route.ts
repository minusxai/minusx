import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/http/with-auth';
import { handleApiError, ApiErrors } from '@/lib/http/api-responses';
import { isAdmin } from '@/lib/auth/role-helpers';
import { isSlackOAuthConfigured, SLACK_BOT_SCOPES } from '@/lib/integrations/slack/config';
import { verifyState } from '@/lib/integrations/slack/oauth-state';
import { slackAuthTest } from '@/lib/integrations/slack/api';
import { upsertSlackBotConfig } from '@/lib/integrations/slack/store';
import { SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, AUTH_URL } from '@/lib/config';
import type { SlackBotConfig } from '@/lib/types';

interface SlackOAuthV2Response {
  ok: boolean;
  error?: string;
  access_token?: string;
  bot_user_id?: string;
  app_id?: string;
  team?: { id: string; name: string };
  enterprise?: { id: string; name: string } | null;
}

async function exchangeCode(code: string): Promise<SlackOAuthV2Response> {
  // redirect_uri must match the URI registered with Slack and used in the original
  // authorize request — always the root-domain callback, regardless of which host
  // is executing the exchange.
  const redirectUri = `${AUTH_URL}/api/integrations/slack/oauth-callback`;
  const body = new URLSearchParams({
    code,
    redirect_uri: redirectUri,
    client_id: SLACK_CLIENT_ID!,
    client_secret: SLACK_CLIENT_SECRET!,
  });
  const resp = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  return resp.json() as Promise<SlackOAuthV2Response>;
}

function buildBotConfig(
  oauthResp: SlackOAuthV2Response,
  authTest: Awaited<ReturnType<typeof slackAuthTest>>,
  installedBy: string,
): SlackBotConfig {
  return {
    type: 'slack',
    name: oauthResp.team?.name || authTest.team || 'Slack',
    install_mode: 'oauth',
    bot_token: oauthResp.access_token!,
    // signing_secret omitted — events route falls back to SLACK_SIGNING_SECRET env var
    team_id: oauthResp.team?.id || authTest.team_id,
    team_name: oauthResp.team?.name || authTest.team,
    bot_user_id: oauthResp.bot_user_id || authTest.user_id,
    app_id: oauthResp.app_id,
    enterprise_id: oauthResp.enterprise?.id,
    installed_at: new Date().toISOString(),
    installed_by: installedBy,
    enabled: true,
    scopes: [...SLACK_BOT_SCOPES],
  };
}

// ─── Main handler ─────────────────────────────────────────────────────────────

// Finalizes a Slack install. Unlike the root callback, this route is auth-gated, so
// the request carries the user's session cookie and runs in their authenticated
// context. We re-verify the HMAC state (don't trust forwarded params) and confirm the
// logged-in user is the admin who initiated the install (cookie-side proof), then
// exchange the code and write the bot config.

export const GET = withAuth(async (request: NextRequest, user) => {
  if (!isSlackOAuthConfigured()) {
    return ApiErrors.badRequest('Slack OAuth is not configured on this server');
  }

  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  if (!code || !state) {
    return ApiErrors.validationError('Missing code or state parameter');
  }

  const payload = verifyState(state);
  if (!payload) {
    return ApiErrors.validationError('Invalid or expired state parameter');
  }

  // Cookie-side proof: the person completing the install must be the admin who
  // started it — verified against the live session, not just the signed state.
  if (!isAdmin(user.role) || user.email !== payload.userEmail) {
    return ApiErrors.forbidden('This Slack installation must be completed by the admin who started it');
  }

  try {
    const oauthResp = await exchangeCode(code);
    if (!oauthResp.ok || !oauthResp.access_token) {
      throw new Error(`Slack OAuth exchange failed: ${oauthResp.error ?? 'unknown'}`);
    }

    const authTest = await slackAuthTest(oauthResp.access_token);
    const bot = buildBotConfig(oauthResp, authTest, payload.userEmail);

    await upsertSlackBotConfig('org', bot);

    return NextResponse.redirect(`${payload.returnUrl}&slack=installed`);
  } catch (error) {
    return handleApiError(error);
  }
});
