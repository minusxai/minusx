import { NextRequest } from 'next/server';
import { getConnection, updateConnection, deleteConnection } from '@/lib/data/connections.server';
import { successResponse, handleApiError } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';

interface RouteParams {
  params: Promise<{ name: string }>;
}

// GET /api/connections/{name}
export const GET = withAuth(async (request: NextRequest, user, { params }: RouteParams) => {
  try {
    const { name } = await params;
    const result = await getConnection(name, user);
    // Return the whole result { connection, schema? } to preserve optional schema
    return successResponse(result);
  } catch (error) {
    return handleApiError(error);
  }
});

// PUT /api/connections/{name}
export const PUT = withAuth(async (request: NextRequest, user, { params }: RouteParams) => {
  try {
    const { name } = await params;
    const { config } = await request.json();
    const result = await updateConnection(name, config, user);
    // Return the whole result { connection, schema? } to preserve optional schema
    return successResponse(result);
  } catch (error) {
    return handleApiError(error);
  }
});

// DELETE /api/connections/{name}
export const DELETE = withAuth(async (request: NextRequest, user, { params }: RouteParams) => {
  try {
    const { name } = await params;
    await deleteConnection(name, user);
    return successResponse({ message: 'Connection deleted successfully' });
  } catch (error) {
    return handleApiError(error);
  }
});
