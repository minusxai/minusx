/**
 * OAuth 2.1 Token Endpoint
 *
 * POST: Exchange authorization code (with PKCE) for an access token + refresh token,
 *       or exchange a refresh token for a new token pair (rotation).
 *
 * Supports:
 * - grant_type=authorization_code (with PKCE code_verifier)
 * - grant_type=refresh_token (single-use with rotation, 30-day lifetime)
 */

import { NextRequest, NextResponse } from 'next/server';
import { OAuthCodeDB, OAuthTokenDB, OAuthRefreshDB } from '@/lib/oauth/db';
import { getModules } from '@/lib/modules/registry';

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
  let body: Record<string, string>;

  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    body = await request.json();
  } else {
    const formData = await request.formData();
    body = Object.fromEntries(formData.entries()) as Record<string, string>;
  }

  const grantType = body.grant_type;

  // ------------------------------------------------------------------
  // grant_type=authorization_code
  // ------------------------------------------------------------------
  if (grantType === 'authorization_code') {
    const { code, code_verifier, redirect_uri } = body;

    if (!code) return oauthError('invalid_request', 'Missing code');
    if (!code_verifier) return oauthError('invalid_request', 'Missing code_verifier (PKCE required)');
    if (!redirect_uri) return oauthError('invalid_request', 'Missing redirect_uri');

    const result = await OAuthCodeDB.consume(code, redirect_uri, code_verifier);
    if (!result) {
      return oauthError('invalid_grant', 'Invalid, expired, or already-used authorization code');
    }

    const extra = await getModules().auth.getExtraTokenPayload?.(result.userId, result.scope) ?? {};
    const tokenPair = await OAuthTokenDB.create(result.userId, result.scope, extra);
    const refreshToken = await OAuthRefreshDB.create(result.userId, result.scope);

    return NextResponse.json({
      access_token: tokenPair.accessToken,
      token_type: tokenPair.tokenType,
      expires_in: tokenPair.expiresIn,
      refresh_token: refreshToken,
    }, { headers: CORS_HEADERS });
  }

  // ------------------------------------------------------------------
  // grant_type=refresh_token
  // ------------------------------------------------------------------
  if (grantType === 'refresh_token') {
    const { refresh_token } = body;
    if (!refresh_token) return oauthError('invalid_request', 'Missing refresh_token');

    const result = await OAuthRefreshDB.consume(refresh_token);
    if (!result) {
      return oauthError('invalid_grant', 'Invalid or expired refresh token');
    }

    const extra = await getModules().auth.getExtraTokenPayload?.(result.userId, result.scope) ?? {};
    const tokenPair = await OAuthTokenDB.create(result.userId, result.scope, extra);
    // Issue a new refresh token (rotation — old one is already consumed)
    const newRefreshToken = await OAuthRefreshDB.create(result.userId, result.scope);

    return NextResponse.json({
      access_token: tokenPair.accessToken,
      token_type: tokenPair.tokenType,
      expires_in: tokenPair.expiresIn,
      refresh_token: newRefreshToken,
    }, { headers: CORS_HEADERS });
  }

  return oauthError('unsupported_grant_type', `Grant type "${grantType}" is not supported`);
}
