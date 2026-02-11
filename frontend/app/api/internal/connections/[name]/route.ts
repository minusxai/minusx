import { NextRequest, NextResponse } from 'next/server';
import { DocumentDB } from '@/lib/database/documents-db';
import type { ConnectionContent } from '@/lib/types';
import { sessionTokenManager } from '@/lib/auth/session-tokens';
import { resolvePath } from '@/lib/mode/path-resolver';

// Force Node.js runtime (required for better-sqlite3)
export const runtime = 'nodejs';

/**
 * Internal API: Get connection configuration by database name
 *
 * Called by Python backend to retrieve connection configs for idempotent initialization.
 * This endpoint is intended for internal use only (Python → Next.js).
 *
 * Security: Protected by session tokens generated per-request.
 * When Next.js calls Python, it generates a one-time token that Python echoes back.
 *
 * @returns Connection config: { type, config }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;

    // Security: Validate session token (JWT)
    const sessionToken = request.headers.get('x-session-token');

    if (!sessionToken) {
      // Return 404 to hide endpoint existence (don't reveal it exists)
      return NextResponse.json(
        { error: 'Not found' },
        { status: 404 }
      );
    }

    // Validate JWT and extract company ID and mode
    const tokenData = sessionTokenManager.validate(sessionToken);

    if (tokenData === null) {
      // Invalid or expired token - return 404
      return NextResponse.json(
        { error: 'Not found' },
        { status: 404 }
      );
    }

    const { companyId, mode } = tokenData;

    // Find connection by name with company_id filtering (multi-tenant isolation)
    const connectionPath = resolvePath(mode, `/database/${name}`);
    const connection = await DocumentDB.getByPath(connectionPath, companyId);

    if (!connection) {
      return NextResponse.json(
        { error: `Connection '${name}' not found for company ${companyId}` },
        { status: 404 }
      );
    }


    const connectionContent = connection.content as ConnectionContent;

    // Return connection config for Python backend
    return NextResponse.json({
      type: connectionContent.type,
      config: connectionContent.config
    });
  } catch (error) {
    console.error('[Internal API] Error fetching connection config:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
