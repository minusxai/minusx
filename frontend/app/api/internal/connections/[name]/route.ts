import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api/api-responses';
import { ConnectionsAPI } from '@/lib/data/connections.server';
import { sessionTokenManager } from '@/lib/auth/session-tokens';

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

    // Use getRawByName — this is a trusted internal endpoint (JWT-protected, Python-only).
    // getSafeConfig() must NOT be applied here; Python needs the full credentials
    // (e.g. service_account_json for BigQuery) to execute queries.
    const { type, config } = await ConnectionsAPI.getRawByName(name, companyId, mode);

    // Return full connection config for Python backend
    return NextResponse.json({ type, config });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('not found')) {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    console.error('[Internal API] Error fetching connection config:', error);
    return handleApiError(error);
  }
}
