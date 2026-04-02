/**
 * OAuth 2.0 Dynamic Client Registration (RFC 7591)
 *
 * Allows MCP clients to auto-register and obtain a client_id
 * without user interaction. Returns our hardcoded public client
 * for any registration request (single-client model for v1).
 */

import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    // Empty body is fine
  }

  const clientName = (body.client_name as string) || 'MCP Client';
  const redirectUris = (body.redirect_uris as string[]) || [];

  // Return our single public client — no secret needed (public client with PKCE)
  return NextResponse.json({
    client_id: 'minusx-mcp',
    client_name: clientName,
    redirect_uris: redirectUris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  }, { status: 201 });
}
