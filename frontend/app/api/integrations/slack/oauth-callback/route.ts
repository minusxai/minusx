import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { handleApiError, ApiErrors } from '@/lib/api/api-responses';
import { isAdmin } from '@/lib/auth/role-helpers';
import { isSlackOAuthConfigured, SLACK_BOT_SCOPES } from '@/lib/integrations/slack/config';
import { slackAuthTest } from '@/lib/integrations/slack/api';
import { upsertSlackBotConfig } from '@/lib/integrations/slack/store';
import { NEXTAUTH_SECRET, SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, AUTH_URL } from '@/lib/config';
import type { SlackBotConfig } from '@/lib/types';

const STATE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

function verifyState(state: string): boolean {
  const lastDot = state.lastIndexOf('.');
  if (lastDot < 0) return false;
  const payload = state.slice(0, lastDot);
  const sig = state.slice(lastDot + 1);

  const expectedSig = crypto
    .createHmac('sha256', NEXTAUTH_SECRET)
    .update(payload)
    .digest('hex');

  const sigBuf = Buffer.from(sig, 'hex');
  const expectedBuf = Buffer.from(expectedSig, 'hex');
  if (sigBuf.length !== expectedBuf.length) return false;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return false;

  const ts = parseInt(payload.split('.')[0], 10);
  if (!Number.isFinite(ts)) return false;
  if (Date.now() - ts > STATE_EXPIRY_MS) return false;

  return true;
}

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

export async function GET(request: NextRequest) {
  if (!isSlackOAuthConfigured()) {
    return ApiErrors.badRequest('Slack OAuth is not configured on this server');
  }

  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  if (error) {
    return NextResponse.redirect(`${AUTH_URL}/settings?tab=integrations&slack=denied`);
  }

  if (!code || !state) {
    return ApiErrors.validationError('Missing code or state parameter');
  }

  if (!verifyState(state)) {
    return ApiErrors.validationError('Invalid or expired state parameter');
  }

  const user = await getEffectiveUser();
  if (!user) {
    return NextResponse.redirect(`${AUTH_URL}/settings?tab=integrations&slack=auth_required`);
  }
  if (!isAdmin(user.role)) {
    return ApiErrors.forbidden('Only admins can manage Slack bots');
  }

  try {
    const oauthResp = await exchangeCode(code);
    if (!oauthResp.ok || !oauthResp.access_token) {
      throw new Error(`Slack OAuth exchange failed: ${oauthResp.error ?? 'unknown'}`);
    }

    const authTest = await slackAuthTest(oauthResp.access_token);

    const bot: SlackBotConfig = {
      type: 'slack',
      name: oauthResp.team?.name || authTest.team || 'Slack',
      install_mode: 'oauth',
      bot_token: oauthResp.access_token,
      // signing_secret omitted — events route falls back to SLACK_SIGNING_SECRET env var
      team_id: oauthResp.team?.id || authTest.team_id,
      team_name: oauthResp.team?.name || authTest.team,
      bot_user_id: oauthResp.bot_user_id || authTest.user_id,
      app_id: oauthResp.app_id,
      enterprise_id: oauthResp.enterprise?.id,
      installed_at: new Date().toISOString(),
      installed_by: user.email,
      enabled: true,
      scopes: [...SLACK_BOT_SCOPES],
    };

    await upsertSlackBotConfig(user.companyId, user.mode, bot);

    return NextResponse.redirect(`${AUTH_URL}/settings?tab=integrations&slack=installed`);
  } catch (error) {
    return handleApiError(error);
  }
}
