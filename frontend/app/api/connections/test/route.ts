import { NextRequest, NextResponse } from 'next/server';
import { handleApiError, ApiErrors } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';
import { validateDuckDbFilePath, validateConnectionType } from '@/lib/data/helpers/connections';
import { getNodeConnector } from '@/lib/connections';

interface TestConnectionRequest {
  name?: string | null;
  type: string;
  config: Record<string, any>;
  include_schema?: boolean;
}

/**
 * POST /api/connections/test
 * Test a connection configuration (existing or new). All connection types are
 * tested via their Node.js connector — no Python backend.
 */
export const POST = withAuth(async (request: NextRequest, _user) => {
  try {
    const body: TestConnectionRequest = await request.json();
    const { name, type, config, include_schema = false } = body;

    if (!type || !config) {
      return ApiErrors.badRequest('type and config are required');
    }

    validateConnectionType(type);
    validateDuckDbFilePath(type, config);

    const connector = getNodeConnector(name || '', type, config);
    if (!connector) {
      return ApiErrors.badRequest(`Unsupported connection type '${type}'`);
    }
    const result = await connector.testConnection(include_schema);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
});
