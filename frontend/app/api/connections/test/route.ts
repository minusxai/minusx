import { NextRequest, NextResponse } from 'next/server';
import { handleApiError, ApiErrors } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';
import { pythonBackendFetch } from '@/lib/api/python-backend-client';
import { validateDuckDbFilePath } from '@/lib/data/helpers/connections';
import { getNodeConnector } from '@/lib/connections';

interface TestConnectionRequest {
  name?: string | null;
  type: string;
  config: Record<string, any>;
  include_schema?: boolean;
}

/**
 * POST /api/connections/test
 * Test a connection configuration (can be used for both existing and new connections).
 * DuckDB connections are handled entirely in Node.js to avoid Python's exclusive file lock.
 */
export const POST = withAuth(async (request: NextRequest, user) => {
  try {
    const body: TestConnectionRequest = await request.json();
    const { name, type, config, include_schema = false } = body;

    if (!type || !config) {
      return ApiErrors.badRequest('type and config are required');
    }

    validateDuckDbFilePath(type, config, user.companyId);

    // Handle DuckDB (and csv/google-sheets which are DuckDB-backed) in Node.js.
    // This bypasses Python entirely, avoiding the exclusive file lock conflict.
    const connector = getNodeConnector(name || '', type, config);
    if (connector) {
      const result = await connector.testConnection(include_schema);
      return NextResponse.json(result, { status: 200 });
    }

    // Forward all other connection types (postgresql, bigquery, etc.) to Python backend
    const response = await pythonBackendFetch('/api/connections/test', {
      method: 'POST',
      body: JSON.stringify({
        name: name || null,
        type,
        config,
        include_schema
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return ApiErrors.externalApiError(data.message || 'Connection test failed');
    }

    // Pass through Python response directly (already has success field)
    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
});
