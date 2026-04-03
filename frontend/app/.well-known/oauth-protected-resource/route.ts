/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9470)
 *
 * MCP clients fetch this first to discover which authorization server
 * protects the MCP endpoint. Points to our authorization server metadata.
 */

import { NextRequest, NextResponse } from 'next/server';

function getBaseUrl(request: NextRequest): string {
  const protoHeader = request.headers.get('x-forwarded-proto') || 'http';
  const proto = protoHeader.split(',')[0].trim();
  const host = request.headers.get('host') || 'localhost:3000';
  return `${proto}://${host}`;
}

export async function GET(request: NextRequest) {
  const baseUrl = getBaseUrl(request);

  const metadata = {
    resource: `${baseUrl}/api/mcp`,
    authorization_servers: [baseUrl],
    bearer_methods_supported: ['header'],
  };

  return NextResponse.json(metadata, {
    headers: {
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
