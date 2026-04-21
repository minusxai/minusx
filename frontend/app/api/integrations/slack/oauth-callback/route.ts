import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { handleApiError, ApiErrors } from '@/lib/api/api-responses';
import { isSlackOAuthConfigured, SLACK_BOT_SCOPES } from '@/lib/integrations/slack/config';
import { slackAuthTest } from '@/lib/integrations/slack/api';
import { upsertSlackBotConfig } from '@/lib/integrations/slack/store';
import { NEXTAUTH_SECRET, SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, AUTH_URL } from '@/lib/config';
import type { SlackBotConfig } from '@/lib/types';

const STATE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

interface StatePayload {
  ts: number;
  nonce: string;
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
  // redirect_uri must match the URI registered with Slack and used in the
  // original authorize request — always the root domain, regardless of which
  // host is executing the exchange.
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

// ─── Direct install helper ────────────────────────────────────────────────────

const rootDomain = new URL(AUTH_URL).hostname;

function handleDirectInstall(): NextResponse {
  return new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Log in to MinusX</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:480px;margin:80px auto;padding:0 24px;color:#e2e8f0;background:#0d1117;}
  h1{font-size:1.25rem;font-weight:600;margin-bottom:12px;}
  p{color:#94a3b8;font-size:.9rem;margin-bottom:20px;line-height:1.6;}
  a{display:inline-block;padding:8px 16px;background:#0d9488;color:#fff;border-radius:6px;text-decoration:none;font-size:.875rem;}
  a:hover{background:#0f766e;}
</style>
</head><body>
<h1>Almost there</h1>
<p>Please log in to your MinusX workspace first, then go to
<strong>Settings → Integrations → Slack</strong> and click
<strong>Add to Slack</strong> from there.</p>
<a href="https://${rootDomain}">Go to MinusX</a>
</body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  if (!isSlackOAuthConfigured()) {
    return ApiErrors.badRequest('Slack OAuth is not configured on this server');
  }

  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  // Use verified returnUrl for the denied redirect — reading unverified state here
  // would be an open redirect (attacker crafts state with arbitrary returnUrl).
  const deniedReturn = (() => {
    if (!state) return `${AUTH_URL}/settings?tab=integrations&slack=denied`;
    const verified = verifyState(state);
    if (verified?.returnUrl) return `${verified.returnUrl}&slack=denied`;
    return `${AUTH_URL}/settings?tab=integrations&slack=denied`;
  })();

  if (error) {
    return NextResponse.redirect(deniedReturn);
  }

  // Direct install path — no signed state.
  // User arrived from Slack App Directory or a manually constructed install URL,
  // not via our oauth-start route. Show login page directing them to install via settings.
  if (!state && code) {
    return handleDirectInstall();
  }

  if (!code || !state) {
    return ApiErrors.validationError('Missing code or state parameter');
  }

  const payload = verifyState(state);
  if (!payload) {
    return ApiErrors.validationError('Invalid or expired state parameter');
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
}
