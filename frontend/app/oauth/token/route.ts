/**
 * OAuth 2.1 Token Endpoint
 *
 * POST: Exchange authorization code for tokens, or refresh tokens.
 *
 * Supports:
 * - grant_type=authorization_code (with PKCE code_verifier)
 * - grant_type=refresh_token
 */

import { NextRequest, NextResponse } from 'next/server';
import { OAuthCodeDB, OAuthTokenDB } from '@/lib/mcp/oauth-db';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function oauthError(error: string, description?: string, status = 400): NextResponse {
  return NextResponse.json(
    { error, ...(description ? { error_description: description } : {}) },
    { status, headers: CORS_HEADERS }
  );
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: NextRequest) {
  // Token endpoint accepts both application/x-www-form-urlencoded and application/json
  let body: Record<string, string>;

  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    body = await request.json();
  } else {
    const formData = await request.formData();
    body = Object.fromEntries(formData.entries()) as Record<string, string>;
  }

  const grantType = body.grant_type;

  if (grantType === 'authorization_code') {
    return handleAuthorizationCode(body);
  } else if (grantType === 'refresh_token') {
    return handleRefreshToken(body);
  } else {
    return oauthError('unsupported_grant_type', `Grant type "${grantType}" is not supported`);
  }
}

async function handleAuthorizationCode(body: Record<string, string>): Promise<NextResponse> {
  const { code, code_verifier, redirect_uri } = body;

  if (!code) {
    return oauthError('invalid_request', 'Missing code');
  }
  if (!code_verifier) {
    return oauthError('invalid_request', 'Missing code_verifier (PKCE required)');
  }
  if (!redirect_uri) {
    return oauthError('invalid_request', 'Missing redirect_uri');
  }

  const result = await OAuthCodeDB.consume(code, redirect_uri, code_verifier);
  if (!result) {
    return oauthError('invalid_grant', 'Invalid, expired, or already-used authorization code');
  }

  const tokenPair = await OAuthTokenDB.create(result.companyId, result.userId, result.scope);

  return NextResponse.json({
    access_token: tokenPair.accessToken,
    refresh_token: tokenPair.refreshToken,
    token_type: tokenPair.tokenType,
    expires_in: tokenPair.expiresIn,
  }, { headers: CORS_HEADERS });
}

async function handleRefreshToken(body: Record<string, string>): Promise<NextResponse> {
  const { refresh_token } = body;

  if (!refresh_token) {
    return oauthError('invalid_request', 'Missing refresh_token');
  }

  const tokenPair = await OAuthTokenDB.refresh(refresh_token);
  if (!tokenPair) {
    return oauthError('invalid_grant', 'Invalid, expired, or revoked refresh token');
  }

  return NextResponse.json({
    access_token: tokenPair.accessToken,
    refresh_token: tokenPair.refreshToken,
    token_type: tokenPair.tokenType,
    expires_in: tokenPair.expiresIn,
  }, { headers: CORS_HEADERS });
}
