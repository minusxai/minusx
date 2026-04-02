/**
 * OAuth 2.1 Authorization Endpoint
 *
 * GET: Validates params, checks session, redirects to login if needed,
 *      then shows consent page or auto-approves.
 * POST: User consents → generate auth code → redirect to client.
 *
 * Hardcoded public client: "minusx-mcp" (no client_secret).
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { OAuthCodeDB } from '@/lib/mcp/oauth-db';

const ALLOWED_CLIENT_ID = 'minusx-mcp';

function errorRedirect(redirectUri: string, error: string, state?: string): NextResponse {
  const url = new URL(redirectUri);
  url.searchParams.set('error', error);
  if (state) url.searchParams.set('state', state);
  return NextResponse.redirect(url);
}

function validateParams(params: URLSearchParams): {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  state?: string;
  scope?: string;
} | { error: string } {
  const clientId = params.get('client_id');
  const responseType = params.get('response_type');
  const redirectUri = params.get('redirect_uri');
  const codeChallenge = params.get('code_challenge');
  const codeChallengeMethod = params.get('code_challenge_method') || 'S256';
  const state = params.get('state') || undefined;
  const scope = params.get('scope') || undefined;

  if (!clientId || clientId !== ALLOWED_CLIENT_ID) {
    return { error: 'invalid_client' };
  }
  if (responseType !== 'code') {
    return { error: 'unsupported_response_type' };
  }
  if (!redirectUri) {
    return { error: 'invalid_request: missing redirect_uri' };
  }
  if (!codeChallenge) {
    return { error: 'invalid_request: missing code_challenge (PKCE required)' };
  }
  if (codeChallengeMethod !== 'S256') {
    return { error: 'invalid_request: only S256 code_challenge_method supported' };
  }

  return { clientId, redirectUri, codeChallenge, codeChallengeMethod, state, scope };
}

function getExternalOrigin(request: NextRequest): string {
  const proto = (request.headers.get('x-forwarded-proto') || 'https').split(',')[0].trim();
  const host = request.headers.get('host') || request.nextUrl.host;
  return `${proto}://${host}`;
}

/**
 * GET /oauth/authorize
 *
 * If the user is logged in, auto-approve and redirect with auth code.
 * If not logged in, redirect to /login with callbackUrl back here.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const validated = validateParams(params);

  if ('error' in validated) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const { redirectUri, codeChallenge, codeChallengeMethod, state, scope } = validated;

  // Check if user is authenticated
  const session = await auth();
  console.log('[OAuth Authorize] Session check:', {
    hasSession: !!session,
    hasUser: !!session?.user,
    companyId: session?.user?.companyId,
    userId: session?.user?.userId,
  });

  if (!session?.user?.companyId || !session?.user?.userId) {
    // Not logged in → redirect to login, come back after
    // Use external origin (respects x-forwarded-proto/host from ngrok/proxy)
    const origin = getExternalOrigin(request);
    const callbackUrl = `${origin}${request.nextUrl.pathname}${request.nextUrl.search}`;
    console.log('[OAuth Authorize] Not authenticated, redirecting to login. callbackUrl:', callbackUrl);
    const loginUrl = new URL('/login', origin);
    loginUrl.searchParams.set('callbackUrl', callbackUrl);
    return NextResponse.redirect(loginUrl);
  }

  // User is authenticated → issue authorization code immediately
  // (Auto-approve for our own client — no consent screen needed for v1)
  try {
    const code = await OAuthCodeDB.create(
      session.user.companyId,
      session.user.userId,
      redirectUri,
      codeChallenge,
      codeChallengeMethod,
      scope
    );

    const url = new URL(redirectUri);
    url.searchParams.set('code', code);
    if (state) url.searchParams.set('state', state);
    return NextResponse.redirect(url);
  } catch (error) {
    return errorRedirect(redirectUri, 'server_error', state);
  }
}
