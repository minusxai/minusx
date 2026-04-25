import { NextRequest } from 'next/server';
import { ConnectionsAPI } from '@/lib/data/connections.server';
import { successResponse, handleApiError } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';
import { getNodeConnector } from '@/lib/connections';
import { profileDatabase } from '@/lib/connections/statistics-engine';

interface RouteParams {
  params: Promise<{ name: string }>;
}

// POST /api/connections/{name}/statistics
export const POST = withAuth(async (request: NextRequest, user, { params }: RouteParams) => {
  try {
    const { name } = await params;
    const { type, config } = await ConnectionsAPI.getRawByName(name, user.mode);

    const connector = getNodeConnector(name, type, config);
    if (!connector) {
      return handleApiError(new Error(`Connector type '${type}' is not supported for statistics`));
    }

    const schema = await connector.getSchema();
    const statistics = await profileDatabase(
      type,
      schema,
      (sql) => connector.query(sql),
    );

    return successResponse(statistics);
  } catch (error) {
    return handleApiError(error);
  }
});
