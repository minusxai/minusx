import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { handleApiError, ApiErrors } from '@/lib/api/api-responses';
import { isSlackOAuthConfigured, SLACK_BOT_SCOPES } from '@/lib/integrations/slack/config';
import { slackAuthTest } from '@/lib/integrations/slack/api';
import { upsertSlackBotConfig } from '@/lib/integrations/slack/store';
import { NEXTAUTH_SECRET, SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, AUTH_URL } from '@/lib/config';
import { CompanyDB } from '@/lib/database/company-db';
import type { SlackBotConfig } from '@/lib/types';

const STATE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

interface StatePayload {
  ts: number;
  nonce: string;
  subdomain: string | null;
  returnUrl: string;
  userEmail: string;
}

function verifyState(state: string): StatePayload | null {
  const lastDot = state.lastIndexOf('.');
  if (lastDot < 0) return null;
  const encoded = state.slice(0, lastDot);
  const sig = state.slice(lastDot + 1);

  const expectedSig = crypto
    .createHmac('sha256', NEXTAUTH_SECRET)
    .update(encoded)
    .digest('hex');

  const sigBuf = Buffer.from(sig, 'hex');
  const expectedBuf = Buffer.from(expectedSig, 'hex');
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

  let payload: StatePayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString()) as StatePayload;
  } catch {
    return null;
  }

  if (!Number.isFinite(payload.ts)) return null;
  if (Date.now() - payload.ts > STATE_EXPIRY_MS) return null;

  return payload;
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

  // Extract returnUrl from state before verifying (for denied redirect)
  // Safe to read unverified here — we only use it for a redirect, not for trust decisions
  const deniedReturn = (() => {
    try {
      const lastDot = (state ?? '').lastIndexOf('.');
      if (lastDot < 0) return `${AUTH_URL}/settings?tab=integrations&slack=denied`;
      const raw = JSON.parse(Buffer.from((state ?? '').slice(0, lastDot), 'base64url').toString()) as Partial<StatePayload>;
      return `${raw.returnUrl ?? `${AUTH_URL}/settings?tab=integrations`}&slack=denied`;
    } catch {
      return `${AUTH_URL}/settings?tab=integrations&slack=denied`;
    }
  })();

  if (error) {
    return NextResponse.redirect(deniedReturn);
  }

  if (!code || !state) {
    return ApiErrors.validationError('Missing code or state parameter');
  }

  const payload = verifyState(state);
  if (!payload) {
    return ApiErrors.validationError('Invalid or expired state parameter');
  }

  // Look up company from subdomain encoded in the signed state.
  // We don't use a session cookie here — the callback lands on the root domain
  // (minusx.app) while the user's session is scoped to their company subdomain.
  // Security: the state is HMAC-signed, so subdomain can't be tampered with.
  const company = payload.subdomain
    ? await CompanyDB.getBySubdomain(payload.subdomain)
    : await CompanyDB.getDefaultCompany();

  if (!company) {
    return ApiErrors.notFound('Company not found for this workspace');
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
      installed_by: payload.userEmail,
      enabled: true,
      scopes: [...SLACK_BOT_SCOPES],
    };

    await upsertSlackBotConfig(company.id, 'org', bot);

    return NextResponse.redirect(`${payload.returnUrl}&slack=installed`);
  } catch (error) {
    return handleApiError(error);
  }
}
