import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api/api-responses';
import { ConnectionsAPI } from '@/lib/data/connections.server';
import { sessionTokenManager } from '@/lib/auth/session-tokens';
import { getNodeConnector } from '@/lib/connections';

// Force Node.js runtime (required for DuckDB)
export const runtime = 'nodejs';

/**
 * Internal API: Get connection schema by database name
 *
 * Called by Python backend to retrieve schema for connections managed by Node.js
 * (DuckDB, CSV, Google Sheets). Python calls this instead of opening DuckDB itself,
 * keeping all DuckDB management in one place (Node.js).
 *
 * Security: Protected by session tokens generated per-request.
 * When Next.js calls Python, it generates a one-time token that Python echoes back.
 *
 * @returns { schemas: SchemaEntry[] } for Node-handled types
 * @returns 422 Unprocessable Entity when the connection type is not handled by Node.js
 *          (BigQuery, PostgreSQL, Athena) — Python falls back to its own connector.
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
      // Return 404 to hide endpoint existence
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const tokenData = sessionTokenManager.validate(sessionToken);

    if (tokenData === null) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const { mode } = tokenData;

    const { type, config } = await ConnectionsAPI.getRawByName(name, mode);

    // Only handle types that Node.js manages (DuckDB, CSV, Google Sheets)
    const connector = getNodeConnector(name, type, config);
    if (!connector) {
      // Signal Python to fall back to its own connector for this type
      return NextResponse.json(
        { error: `Connection type '${type}' is not handled by Node.js` },
        { status: 422 }
      );
    }

    const schemas = await connector.getSchema();
    return NextResponse.json({ schemas });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('not found')) {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    console.error('[Internal API] Error fetching connection schema:', error);
    return handleApiError(error);
  }
}
