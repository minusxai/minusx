import { NextRequest } from 'next/server';
import { successResponse, handleApiError, ApiErrors } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';
import { batchCreateFiles } from '@/lib/data/files.server';
import { BatchCreateInput } from '@/lib/data/types';

/**
 * POST /api/files/batch-create
 * Create multiple virtual files in a single round trip.
 *
 * Body: { files: BatchCreateInput[] }
 * Each item includes a virtualId (negative client-side ID) so the caller can
 * build a virtualId → realId map from the response.
 *
 * Response: { data: Array<{ virtualId: number; file: DbFile }> }
 */
export const POST = withAuth(async (
  request: NextRequest,
  user
) => {
  try {
    const body = await request.json();
    const { files } = body;

    if (!Array.isArray(files) || files.length === 0) {
      return ApiErrors.validationError('files must be a non-empty array');
    }

    const inputs = files as BatchCreateInput[];
    const result = await batchCreateFiles(inputs, user);

    return successResponse(result.data);
  } catch (error) {
    return handleApiError(error);
  }
});
