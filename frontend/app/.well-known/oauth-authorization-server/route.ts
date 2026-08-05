/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414)
 *
 * MCP clients discover OAuth endpoints by fetching this well-known URL.
 * Base URL is derived from the request Host header so it works behind
 * proxies, ngrok, and in production without configuration.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getRequestBaseUrl } from '@/lib/oauth/base-url';


export async function GET(request: NextRequest) {
  const baseUrl = getRequestBaseUrl(request);

  const metadata = {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/oauth/token`,
    registration_endpoint: `${baseUrl}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
  };

  return NextResponse.json(metadata, {
    headers: {
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
