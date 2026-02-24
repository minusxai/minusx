import { NextRequest } from 'next/server';
import { successResponse, handleApiError, ApiErrors } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';
import { batchSaveFiles } from '@/lib/data/files.server';
import { BatchSaveFileInput } from '@/lib/data/types';

/**
 * POST /api/files/batch-save
 * Save multiple existing files in a single round trip.
 *
 * Body: { files: BatchSaveFileInput[] }
 *
 * Response: { data: DbFile[] }
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

    const inputs = files as BatchSaveFileInput[];
    const result = await batchSaveFiles(inputs, user);

    return successResponse(result.data);
  } catch (error) {
    return handleApiError(error);
  }
});
