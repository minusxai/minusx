import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { listAllConnections, createConnection } from '@/lib/data/connections.server';
import { successResponse, handleApiError } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';

// GET /api/connections - List all connections
export const GET = withAuth(async (request: NextRequest, user) => {
  try {
    const includeSchemas = request.nextUrl.searchParams.get('includeSchemas') === 'true';
    const forceRefresh = request.nextUrl.searchParams.get('force_refresh') === 'true';

    // Bust schema cache if force_refresh requested
    if (forceRefresh) {
      revalidateTag('database-schema', 'default');
    }

    const result = await listAllConnections(user, includeSchemas);
    // Result already has correct structure { data: [...], schemas?: {...} }
    return successResponse(result);
  } catch (error) {
    return handleApiError(error);
  }
});

// POST /api/connections - Create connection
export const POST = withAuth(async (request: NextRequest, user) => {
  try {
    const input = await request.json();
    const result = await createConnection(input, user);
    // Unwrap the data layer result before wrapping with successResponse
    return successResponse(result.connection, 201);
  } catch (error) {
    return handleApiError(error);
  }
});
