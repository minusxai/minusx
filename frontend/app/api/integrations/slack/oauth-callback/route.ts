import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { ApiErrors } from '@/lib/api/api-responses';
import { isSlackOAuthConfigured } from '@/lib/integrations/slack/config';
import { verifyState } from '@/lib/integrations/slack/oauth-state';
import { getModules } from '@/lib/modules/registry';
import { AUTH_URL } from '@/lib/config';

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

// This callback always lands on the root domain — Slack's redirect_uri is fixed
// there. It stays a thin, HMAC-verifying forwarder: it confirms the install was
// admin-initiated, then hands off to the host that finalizes the install
// (`oauth-callback-finish`), where the request carries the user's session cookie
// and the token exchange + bot-config write happen. It performs no DB writes itself.

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

  // The auth module decides which host finalizes the install — letting a deployment
  // route the finish step to the host where the user's session applies. When it
  // returns nothing, the install finishes on the same host. The route itself only
  // verifies the signed state and forwards.
  const finishBase =
    getModules().auth.getSlackInstallFinishUrl?.(payload.returnUrl) ??
    `${AUTH_URL}/api/integrations/slack/oauth-callback-finish`;
  const finishUrl = new URL(finishBase);
  finishUrl.searchParams.set('code', code);
  finishUrl.searchParams.set('state', state);
  return NextResponse.redirect(finishUrl);
}
