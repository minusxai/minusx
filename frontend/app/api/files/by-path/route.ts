import { NextRequest } from 'next/server';
import { successResponse, handleApiError, ApiErrors } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';
import { loadFileByPath } from '@/lib/data/files.server';

/**
 * GET /api/files/by-path?path=/logs/llm_calls/user/abc123.json
 * Load a single file by its path (without references)
 *
 * Query params:
 * - path: string - Full file path (e.g., /logs/llm_calls/user@example.com/abc123.json)
 *
 * Returns:
 * - data: DbFile - The file with its content
 * - metadata.references: [] - Empty array (references not loaded for path-based access)
 */
export const GET = withAuth(async (
  request: NextRequest,
  user
) => {
  try {
    const searchParams = request.nextUrl.searchParams;
    const path = searchParams.get('path');

    if (!path) {
      return ApiErrors.validationError('path query parameter is required');
    }

    const result = await loadFileByPath(path, user);

    return successResponse(result);
  } catch (error) {
    return handleApiError(error);
  }
});
