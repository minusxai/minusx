/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728)
 *
 * MCP clients fetch this first to discover which authorization server
 * protects the MCP endpoint. Points to our authorization server metadata.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getRequestBaseUrl } from '@/lib/oauth/base-url';


export async function GET(request: NextRequest) {
  const baseUrl = getRequestBaseUrl(request);

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
