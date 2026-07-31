import { NextRequest } from 'next/server';
import { getConnection, deleteConnection } from '@/lib/data/connections.server';
import { successResponse, handleApiError } from '@/lib/http/api-responses';
import { withAuth } from '@/lib/http/with-auth';

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

// DELETE /api/connections/{name}
// Removes the connection document only. Managed-warehouse data files (CSV /
// Google Sheets parquet) are NOT cleaned up — orphaned data files are a
// separate concern (see ConnectionsAPI.delete).
export const DELETE = withAuth(async (request: NextRequest, user, { params }: RouteParams) => {
  try {
    const { name } = await params;
    await deleteConnection(name, user);
    return successResponse({ message: 'Connection deleted successfully' });
  } catch (error) {
    return handleApiError(error);
  }
});
